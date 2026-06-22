import type { RawSearchHit } from "~/server/services/excel-research/web-search";
import { createLogger, traceFn } from "~/server/lib/logger";
const log = createLogger("services-excel-research-source-ranker");

const MARKETPLACE_DOMAINS = new Set([
  "shopee.vn",
  "lazada.vn",
  "tiki.vn",
  "sendo.vn",
  "amazon.com",
  "amazon.co.uk",
]);

const DISTRIBUTOR_HINTS = [
  "dienmayxanh",
  "thegioiic",
  "hoasen",
  "phucanh",
  "fptshop",
];

export type SourceTier =
  | "manufacturer_official"
  | "authorized_distributor"
  | "supplier_shop"
  | "marketplace"
  | "aggregator";

export type RankedSource = RawSearchHit & {
  sourceTier: SourceTier;
  rankScore: number;
  rankReasons: string[];
};

function detectTier(
  domain: string,
  title: string,
  manufacturer?: string,
): SourceTier {
  const lower = `${domain} ${title}`.toLowerCase();
  const brand = manufacturer?.trim().toLowerCase();
  if (brand && brand.length > 2 && domain.toLowerCase().includes(brand)) {
    return "manufacturer_official";
  }
  if (MARKETPLACE_DOMAINS.has(domain)) return "marketplace";
  if (DISTRIBUTOR_HINTS.some((hint) => domain.includes(hint))) {
    return "authorized_distributor";
  }
  if (
    lower.includes("catalog") ||
    lower.includes("datasheet") ||
    domain.endsWith(".com.vn")
  ) {
    return "supplier_shop";
  }
  if (lower.includes("wiki") || lower.includes("review")) {
    return "aggregator";
  }
  return "supplier_shop";
}

function tierScore(tier: SourceTier) {
  switch (tier) {
    case "manufacturer_official":
      return 40;
    case "authorized_distributor":
      return 32;
    case "supplier_shop":
      return 24;
    case "aggregator":
      return 8;
    case "marketplace":
      return 4;
  }
}

function _rankSearchHits(
  hits: RawSearchHit[],
  productName: string,
  manufacturer?: string,
): RankedSource[] {
  const nameTokens = productName.toLowerCase().split(/\s+/).filter(Boolean);

  return hits
    .map((hit) => {
      const sourceTier = detectTier(hit.domain, hit.title, manufacturer);
      const reasons: string[] = [sourceTier];
      let score = tierScore(sourceTier);

      const titleLower = hit.title.toLowerCase();
      const matchedTokens = nameTokens.filter((t) => titleLower.includes(t));
      if (matchedTokens.length > 0) {
        score += Math.min(15, matchedTokens.length * 5);
        reasons.push(`tên khớp ${matchedTokens.length} từ`);
      }

      if (/\.pdf($|\?)/i.test(hit.url)) {
        score += 10;
        reasons.push("PDF trực tiếp");
      }

      if (hit.providerScore != null) {
        score += Math.min(5, hit.providerScore);
      }

      return { ...hit, sourceTier, rankScore: score, rankReasons: reasons };
    })
    .sort((a, b) => b.rankScore - a.rankScore);
}

export const rankSearchHits = traceFn(log, "rankSearchHits", _rankSearchHits);
