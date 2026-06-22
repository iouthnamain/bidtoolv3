import { createHash } from "node:crypto";

import { eq, sql } from "drizzle-orm";

import type { db as appDb } from "~/server/db";
import { materialMatchDecisions } from "~/server/db/schema";
import type { materials } from "~/server/db/schema";
import type { ScrapedShopProduct } from "~/server/services/shop-material-scraper";
import { stripShopPromoBadgePrefix } from "~/lib/materials/shop-promo-badges";
import { createLogger, traceFn } from "~/server/lib/logger";
const log = createLogger("services-ai-product-matcher");

type AppDb = typeof appDb;
type MaterialRow = typeof materials.$inferSelect;

export type MatchCandidate = {
  materialId: number;
  name: string;
  unit: string;
  score: number;
  breakdown: ScoreBreakdown;
};

export type ScoreBreakdown = {
  nameSimilarity: number;
  unitMatch: number;
  manufacturerMatch: number;
  originMatch: number;
  specMatch: number;
  dimensionMatch: number;
};

export type MatchDecision = {
  id: number;
  scrapedProductHash: string;
  matchedMaterialId: number | null;
  matchMethod: string;
  confidence: number;
  reasoning: string;
  candidatesJson: MatchCandidate[];
  status: string;
  scrapedName: string;
  scrapedUnit: string;
  scrapedSourceUrl: string;
  scrapeJobId: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

// Weights reflect the four priority fields: name, specs, manufacturer, origin.
const WEIGHTS = {
  nameSimilarity: 0.3,
  unitMatch: 0.1,
  manufacturerMatch: 0.2,
  originMatch: 0.1,
  specMatch: 0.2,
  dimensionMatch: 0.1,
};

function _hashScrapedProduct(product: ScrapedShopProduct): string {
  const input = `${product.sourceUrl}|${product.name}|${product.unit ?? ""}`;
  return createHash("sha256").update(input).digest("hex").slice(0, 40);
}

async function _getCachedDecision(
  db: AppDb,
  hash: string,
): Promise<MatchDecision | null> {
  const rows = await db
    .select()
    .from(materialMatchDecisions)
    .where(eq(materialMatchDecisions.scrapedProductHash, hash))
    .limit(1);

  if (rows.length === 0) return null;

  const row = rows[0]!;
  return {
    ...row,
    confidence: Number(row.confidence),
    candidatesJson: row.candidatesJson as MatchCandidate[],
  };
}

async function _findFuzzyCandidates(
  db: AppDb,
  product: ScrapedShopProduct,
  minSimilarity = 0.1,
  limit = 10,
): Promise<MatchCandidate[]> {
  const productName = product.name.trim();
  if (!productName) return [];

  // Use a lightly normalized name (promo stripped, dimensions canonicalized)
  // for retrieval so recall isn't hurt by badge prefixes or Ø/phi notation.
  const searchName = normalizeSearchName(productName);

  const rows = await db.execute<MaterialRow & { name_sim: number }>(sql`
    SELECT m.*,
           similarity(m.name, ${searchName}) AS name_sim
    FROM materials m
    WHERE m.deleted_at IS NULL
      AND similarity(m.name, ${searchName}) > ${minSimilarity}
    ORDER BY name_sim DESC
    LIMIT ${limit}
  `);

  if (!rows.length) return [];

  const candidates: MatchCandidate[] = rows.map((row) => {
    const breakdown = computeScoreBreakdown(product, row);
    const score = computeWeightedScore(breakdown);
    return {
      materialId: row.id,
      name: row.name,
      unit: row.unit,
      score,
      breakdown,
    };
  });

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

function _computeScoreBreakdown(
  product: ScrapedShopProduct,
  candidate: MaterialRow,
): ScoreBreakdown {
  // Compare names with brand removed so the manufacturer signal isn't
  // double-counted and trigrams aren't dominated by the shared brand.
  const normalizedProductName = normalizeProductName(
    product.name,
    product.manufacturer,
  );
  const normalizedCandidateName = normalizeProductName(
    candidate.name,
    candidate.manufacturer,
  );

  const productText = `${product.name} ${product.specText ?? ""}`;
  const candidateText = `${candidate.name} ${candidate.specText ?? ""}`;

  return {
    nameSimilarity: trigramSimilarity(
      normalizedProductName,
      normalizedCandidateName,
    ),
    unitMatch: computeUnitMatch(product.unit, candidate.unit),
    manufacturerMatch: computeManufacturerMatch(
      product.manufacturer,
      candidate.manufacturer,
    ),
    originMatch: computeOriginMatch(
      product.originCountry,
      candidate.originCountry,
    ),
    specMatch: computeSpecMatch(product, candidate),
    dimensionMatch: computeDimensionMatch(productText, candidateText),
  };
}

function _computeWeightedScore(breakdown: ScoreBreakdown): number {
  let score = 0;
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    score += (breakdown[key as keyof ScoreBreakdown] ?? 0) * weight;
  }
  return Math.round(score * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Text normalization helpers
// ---------------------------------------------------------------------------

function stripAccents(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Dimension notation → canonical "<n>mm": Ø21, Φ21, phi 21 → 21mm.
const DIMENSION_NOTATION = /(?:ø|φ|phi)\s*(\d+(?:[.,]\d+)?)/gi;

/** Light normalization for SQL retrieval: keep accents and brand. */
function normalizeSearchName(name: string): string {
  let s = stripShopPromoBadgePrefix(name);
  s = s.replace(DIMENSION_NOTATION, "$1mm");
  s = s.replace(/\s+/g, " ").trim();
  return s || name;
}

/**
 * Full normalization for name scoring: strip promo prefix, canonicalize
 * dimension notation and connector/filler words, drop accents, and remove the
 * brand so it isn't double-counted against the manufacturer signal.
 */
function normalizeProductName(
  name: string,
  brand: string | null | undefined,
): string {
  let s = stripShopPromoBadgePrefix(name ?? "").toLowerCase();
  s = s.replace(DIMENSION_NOTATION, "$1mm");
  // Connector phrase: "ống luồn dây điện" and "ống luồn dây" → "ống luồn".
  s = s.replace(/ống luồn dây(?:\s*điện)?/g, "ống luồn");
  // Filler words that add no discriminating value.
  s = s.replace(
    /\b(loại|kiểu|chính hãng|hàng|sản phẩm|cao cấp|giá rẻ)\b/g,
    " ",
  );
  s = stripAccents(s);

  if (brand) {
    const normalizedBrand = stripAccents(brand.toLowerCase());
    for (const token of normalizedBrand.split(/\s+/).filter((t) => t.length > 1)) {
      s = s.replace(new RegExp(`\\b${escapeRegExp(token)}\\b`, "g"), " ");
    }
  }

  return s
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** pg_trgm-style trigram Jaccard similarity over normalized strings. */
function trigramSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0;

  let intersection = 0;
  for (const gram of ta) {
    if (tb.has(gram)) intersection++;
  }
  const union = ta.size + tb.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function trigrams(value: string): Set<string> {
  const padded = `  ${value.replace(/\s+/g, " ").trim()} `;
  const set = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) {
    set.add(padded.slice(i, i + 3));
  }
  return set;
}

// ---------------------------------------------------------------------------
// Unit matching
// ---------------------------------------------------------------------------

function computeUnitMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  const na = normalizeUnit(a);
  const nb = normalizeUnit(b);
  if (!na && !nb) return 0.5;
  if (!na || !nb) return 0;
  return na === nb ? 1.0 : 0;
}

function normalizeUnit(unit: string | null | undefined): string {
  if (!unit) return "";
  return unit
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/chiếc|cái|c$/i, "cái")
    .replace(/mét|m$/i, "m")
    .replace(/bộ$/i, "bộ")
    .replace(/hộp$/i, "hộp")
    .replace(/cuộn$/i, "cuộn")
    .replace(/tấm$/i, "tấm")
    .trim();
}

// ---------------------------------------------------------------------------
// Manufacturer matching (alias dictionary + fuzzy)
// ---------------------------------------------------------------------------

// Keys and aliases are accent-stripped, lowercase.
const BRAND_ALIASES: Record<string, string[]> = {
  "binh minh": ["bm", "nhua binh minh"],
  "hoa sen": ["hsg", "hoa sen group", "ton hoa sen"],
  schneider: ["schneider electric", "se"],
  panasonic: ["pana"],
  sino: ["sino vanlock", "sinovina"],
  "tien phong": ["tp", "nhua tien phong"],
  "dat hoa": ["dh"],
  nanoco: ["nanoco group"],
  "rang dong": ["rd"],
  "dien quang": ["dq"],
  legrand: [],
  ls: ["ls vina"],
};

function normalizeBrand(value: string | null | undefined): string {
  if (!value) return "";
  return stripAccents(value.toLowerCase())
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalBrand(normalized: string): string | null {
  if (!normalized) return null;
  for (const [canon, aliases] of Object.entries(BRAND_ALIASES)) {
    if (normalized === canon || aliases.includes(normalized)) return canon;
  }
  // Containment on canonical keys (longest first), skipping short/ambiguous ones.
  const keys = Object.keys(BRAND_ALIASES).sort((a, b) => b.length - a.length);
  for (const canon of keys) {
    if (canon.length >= 4 && new RegExp(`\\b${escapeRegExp(canon)}\\b`).test(normalized)) {
      return canon;
    }
  }
  return null;
}

function _computeManufacturerMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  const na = normalizeBrand(a);
  const nb = normalizeBrand(b);
  if (!na || !nb) return 0.5; // missing info: stay neutral, don't penalize
  if (na === nb) return 1.0;

  const ca = canonicalBrand(na);
  const cb = canonicalBrand(nb);
  if (ca && cb && ca === cb) return 1.0;

  if (na.includes(nb) || nb.includes(na)) return 0.9;

  return computeTokenOverlap(na, nb);
}

// ---------------------------------------------------------------------------
// Origin matching (normalize + lookup table)
// ---------------------------------------------------------------------------

const ORIGIN_TERMS: Array<[string, string[]]> = [
  ["vietnam", ["viet nam", "vn", "vietnam"]],
  ["china", ["trung quoc", "tq", "china"]],
  ["japan", ["nhat ban", "nhat", "japan"]],
  ["korea", ["han quoc", "korea", "south korea"]],
  ["taiwan", ["dai loan", "taiwan"]],
  ["thailand", ["thai lan", "thailand"]],
  ["germany", ["duc", "germany"]],
  ["france", ["phap", "france"]],
  ["italy", ["y", "italy", "italia"]],
  ["usa", ["my", "usa", "us", "united states"]],
  ["malaysia", ["malaysia"]],
  ["indonesia", ["indonesia"]],
];

const ORIGIN_EXACT = new Map<string, string>();
for (const [canon, terms] of ORIGIN_TERMS) {
  for (const term of terms) ORIGIN_EXACT.set(term, canon);
}

function normalizeOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = stripAccents(value.toLowerCase())
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;

  const exact = ORIGIN_EXACT.get(normalized);
  if (exact) return exact;

  // Containment for multi-char terms, e.g. "made in vietnam".
  for (const [canon, terms] of ORIGIN_TERMS) {
    for (const term of terms) {
      if (term.length >= 4 && new RegExp(`\\b${escapeRegExp(term)}\\b`).test(normalized)) {
        return canon;
      }
    }
  }
  return normalized; // unknown country: compare the normalized string directly
}

function _computeOriginMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  const na = normalizeOrigin(a);
  const nb = normalizeOrigin(b);
  if (!na || !nb) return 0.5; // missing info: neutral
  return na === nb ? 1.0 : 0;
}

// ---------------------------------------------------------------------------
// Spec matching (structured extraction + comparison)
// ---------------------------------------------------------------------------

type SpecFeatures = {
  voltage: number[];
  wattage: number[];
  amperage: number[];
  weight: number[]; // kg
  capacity: number[]; // litres
  temperature: number[];
  materials: Set<string>;
};

const MATERIAL_TOKENS = [
  "pvc",
  "upvc",
  "cpvc",
  "ppr",
  "hdpe",
  "pe",
  "pp",
  "abs",
  "thep",
  "dong",
  "nhom",
  "inox",
  "gang",
  "nhua",
  "composite",
];

const SPEC_PATTERNS = {
  voltage: /(\d+(?:[.,]\d+)?)\s*v(?:ac|dc)?\b/gi,
  wattage: /(\d+(?:[.,]\d+)?)\s*w\b/gi,
  amperage: /(\d+(?:[.,]\d+)?)\s*a(?:h|mp)?\b/gi,
  temperature: /(\d+(?:[.,]\d+)?)\s*°?\s*c\b/gi,
};

function parseNumber(raw: string): number {
  return parseFloat(raw.replace(",", "."));
}

function extractMatches(text: string, pattern: RegExp): number[] {
  const out: number[] = [];
  const re = new RegExp(pattern.source, pattern.flags);
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const num = parseNumber(match[1] ?? "");
    if (!isNaN(num) && num > 0) out.push(num);
  }
  return out;
}

function extractSpecFeatures(text: string): SpecFeatures {
  const voltage = extractMatches(text, SPEC_PATTERNS.voltage);
  const wattage = extractMatches(text, SPEC_PATTERNS.wattage);
  const amperage = extractMatches(text, SPEC_PATTERNS.amperage);
  const temperature = extractMatches(text, SPEC_PATTERNS.temperature);

  // Weight → kg, capacity → litres (normalize sub-units).
  const weight: number[] = [];
  const weightRe = /(\d+(?:[.,]\d+)?)\s*(kg|g)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = weightRe.exec(text)) !== null) {
    const num = parseNumber(m[1] ?? "");
    if (!isNaN(num) && num > 0) {
      weight.push(m[2]!.toLowerCase() === "g" ? num / 1000 : num);
    }
  }

  const capacity: number[] = [];
  const capacityRe = /(\d+(?:[.,]\d+)?)\s*(lít|lit|ml|l)\b/gi;
  while ((m = capacityRe.exec(text)) !== null) {
    const num = parseNumber(m[1] ?? "");
    if (!isNaN(num) && num > 0) {
      capacity.push(m[2]!.toLowerCase() === "ml" ? num / 1000 : num);
    }
  }

  const normalized = stripAccents(text.toLowerCase());
  const found = new Set<string>();
  for (const token of MATERIAL_TOKENS) {
    if (new RegExp(`\\b${token}\\b`).test(normalized)) found.add(token);
  }

  return {
    voltage,
    wattage,
    amperage,
    weight,
    capacity,
    temperature,
    materials: found,
  };
}

function numericTypeScore(a: number[], b: number[]): number {
  let best = 0;
  for (const va of a) {
    for (const vb of b) {
      const diff = Math.abs(va - vb);
      let s = 0;
      if (diff < 0.001) s = 1.0;
      else if (diff <= 0.1 * Math.max(va, vb)) s = 0.7;
      if (s > best) best = s;
    }
  }
  return best;
}

function jaccardSet(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const x of a) if (b.has(x)) intersection++;
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function computeSpecMatch(
  product: ScrapedShopProduct,
  candidate: MaterialRow,
): number {
  const aText = `${product.name} ${product.specText ?? ""}`;
  const bText = `${candidate.name} ${candidate.specText ?? ""}`;
  const fa = extractSpecFeatures(aText);
  const fb = extractSpecFeatures(bText);

  const aDims = extractDimensions(aText);
  const bDims = extractDimensions(bText);

  const scores: number[] = [];
  const numericTypes: Array<keyof SpecFeatures> = [
    "voltage",
    "wattage",
    "amperage",
    "weight",
    "capacity",
    "temperature",
  ];
  for (const type of numericTypes) {
    const va = fa[type] as number[];
    const vb = fb[type] as number[];
    if (va.length && vb.length) scores.push(numericTypeScore(va, vb));
  }
  if (aDims.length && bDims.length) {
    scores.push(numericTypeScore(aDims, bDims));
  }
  if (fa.materials.size && fb.materials.size) {
    scores.push(jaccardSet(fa.materials, fb.materials));
  }

  if (scores.length > 0) {
    return scores.reduce((sum, s) => sum + s, 0) / scores.length;
  }

  // No shared structured spec types: fall back to token overlap of specText.
  const hasSpecText =
    Boolean(product.specText?.trim()) || Boolean(candidate.specText?.trim());
  if (!hasSpecText) return 0.5; // no signal either way
  return computeTokenOverlap(product.specText, candidate.specText);
}

// ---------------------------------------------------------------------------
// Dimension matching (name + specText)
// ---------------------------------------------------------------------------

const DIMENSION_PATTERN =
  /(?:ø|Ø|phi|φ|d)\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*(?:mm|cm|m|inch|")/gi;

function computeDimensionMatch(textA: string, textB: string): number {
  const dimsA = dedupeDimensions(extractDimensions(textA));
  const dimsB = dedupeDimensions(extractDimensions(textB));

  if (dimsA.length === 0 && dimsB.length === 0) return 0.5;
  if (dimsA.length === 0 || dimsB.length === 0) return 0;

  let matches = 0;
  for (const dim of dimsA) {
    if (dimsB.some((d) => Math.abs(d - dim) < 0.01)) matches++;
  }

  const total = Math.max(dimsA.length, dimsB.length);
  return total > 0 ? matches / total : 0;
}

function dedupeDimensions(dims: number[]): number[] {
  const out: number[] = [];
  for (const dim of dims) {
    if (!out.some((d) => Math.abs(d - dim) < 0.01)) out.push(dim);
  }
  return out;
}

function extractDimensions(text: string): number[] {
  const dims: number[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(DIMENSION_PATTERN.source, DIMENSION_PATTERN.flags);

  while ((match = re.exec(text)) !== null) {
    const raw = (match[1] ?? match[2] ?? "").replace(",", ".");
    const num = parseFloat(raw);
    if (!isNaN(num) && num > 0 && num < 10000) {
      dims.push(num);
    }
  }

  return dims;
}

// ---------------------------------------------------------------------------
// Shared token overlap (fallback)
// ---------------------------------------------------------------------------

function computeTokenOverlap(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  if (!a || !b) return 0;

  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection++;
  }

  const union = new Set([...tokensA, ...tokensB]).size;
  return union > 0 ? intersection / union : 0;
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize("NFC")
      .replace(/[^\p{L}\p{N}]/gu, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1),
  );
}

async function _saveMatchDecision(
  db: AppDb,
  product: ScrapedShopProduct,
  candidates: MatchCandidate[],
  opts: {
    candidateThreshold: number;
    scrapeJobId?: string;
  },
): Promise<{
  action: "auto_matched" | "no_match";
  matchedMaterialId?: number;
  confidence: number;
}> {
  const hash = hashScrapedProduct(product);
  const topCandidate = candidates[0];

  if (!topCandidate || topCandidate.score < opts.candidateThreshold) {
    return { action: "no_match", confidence: 0 };
  }

  const confidence = topCandidate.score;
  const reasoning = buildReasoning(topCandidate);
  const reviewedAt = new Date().toISOString();

  const storedCandidates = candidates.slice(0, 5).map((c) => ({
    materialId: c.materialId,
    name: c.name,
    unit: c.unit,
    score: c.score,
  }));

  await db
    .insert(materialMatchDecisions)
    .values({
      scrapedProductHash: hash,
      matchedMaterialId: topCandidate.materialId,
      matchMethod: "hybrid",
      confidence: confidence.toFixed(3),
      reasoning,
      candidatesJson: storedCandidates,
      status: "accepted",
      scrapedName: product.name,
      scrapedUnit: product.unit ?? "",
      scrapedSourceUrl: product.sourceUrl,
      scrapeJobId: opts.scrapeJobId ?? null,
      reviewedAt,
    })
    .onConflictDoUpdate({
      target: materialMatchDecisions.scrapedProductHash,
      set: {
        matchedMaterialId: topCandidate.materialId,
        matchMethod: "hybrid",
        confidence: confidence.toFixed(3),
        reasoning,
        candidatesJson: storedCandidates,
        status: "accepted",
        scrapedName: product.name,
        scrapedUnit: product.unit ?? "",
        scrapedSourceUrl: product.sourceUrl,
        scrapeJobId: opts.scrapeJobId ?? null,
        reviewedAt,
      },
    });

  return {
    action: "auto_matched",
    matchedMaterialId: topCandidate.materialId,
    confidence,
  };
}

function buildReasoning(candidate: MatchCandidate): string {
  const { breakdown } = candidate;
  const parts: string[] = [];

  if (breakdown.nameSimilarity >= 0.6) {
    parts.push(`tên tương tự ${(breakdown.nameSimilarity * 100).toFixed(0)}%`);
  }
  if (breakdown.unitMatch === 1.0) {
    parts.push("cùng đơn vị");
  }
  if (breakdown.manufacturerMatch >= 0.9) {
    parts.push("cùng nhà sản xuất");
  }
  if (breakdown.originMatch === 1.0) {
    parts.push("cùng xuất xứ");
  }
  if (breakdown.specMatch >= 0.7) {
    parts.push("thông số kỹ thuật khớp");
  }
  if (breakdown.dimensionMatch > 0.5) {
    parts.push("kích thước trùng khớp");
  }

  return parts.length > 0 ? parts.join(", ") : "điểm tổng hợp đạt ngưỡng";
}

export const hashScrapedProduct = traceFn(log, "hashScrapedProduct", _hashScrapedProduct);
export const getCachedDecision = traceFn(log, "getCachedDecision", _getCachedDecision);
export const findFuzzyCandidates = traceFn(log, "findFuzzyCandidates", _findFuzzyCandidates);
export const computeScoreBreakdown = traceFn(log, "computeScoreBreakdown", _computeScoreBreakdown);
export const computeWeightedScore = traceFn(log, "computeWeightedScore", _computeWeightedScore);
export const computeManufacturerMatch = traceFn(log, "computeManufacturerMatch", _computeManufacturerMatch);
export const computeOriginMatch = traceFn(log, "computeOriginMatch", _computeOriginMatch);
export const saveMatchDecision = traceFn(log, "saveMatchDecision", _saveMatchDecision);
