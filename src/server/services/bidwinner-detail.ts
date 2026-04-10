import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";

import { env } from "~/env";
import { db } from "~/server/db";
import { packageDetailsCache } from "~/server/db/schema";

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  Referer: env.BIDWINNER_BASE_URL,
};

const PRODUCT_HINTS = [
  "san pham",
  "sản phẩm",
  "hang hoa",
  "hàng hóa",
  "vat tu",
  "vật tư",
  "thiet bi",
  "thiết bị",
  "quy cach",
  "quy cách",
  "so luong",
  "số lượng",
  "model",
  "xuat xu",
  "xuất xứ",
  "item",
  "ma hang",
  "mã hàng",
  "danh muc",
  "danh mục",
];

export type BidWinnerDetailProduct = {
  text: string;
  source: "table" | "list" | "paragraph" | "fallback";
};

export type BidWinnerDetailLink = {
  text: string;
  href: string;
  host: string;
  isExternal: boolean;
  kind: "page" | "file";
};

export type BidWinnerDetailResult = {
  externalId: string;
  sourceUrl: string;
  pageTitle: string;
  products: BidWinnerDetailProduct[];
  links: BidWinnerDetailLink[];
  requiredTables: {
    commodityCategories: string[];
    tenderNoticeContents: string[];
    invitationDocuments: BidWinnerDetailLink[];
    lotList: string[];
  };
  requiredTablesEvidence: {
    commodityCategories: string[];
    tenderNoticeContents: string[];
    invitationDocuments: string[];
    lotList: string[];
  };
  extractionMeta: {
    fromCache: boolean;
    cacheAgeMs: number | null;
    sectionsDetected: string[];
    warnings: string[];
  };
  fetchedAt: string;
};

type BidWinnerDetailExtractionDiagnostics = Omit<
  BidWinnerDetailResult["extractionMeta"],
  "fromCache" | "cacheAgeMs"
>;

type BidWinnerDetailCoreResult = Omit<BidWinnerDetailResult, "extractionMeta"> & {
  extractionMeta: BidWinnerDetailExtractionDiagnostics;
};

type BidWinnerTableSections = {
  commoditySections: HtmlSection[];
  tenderNoticeSections: HtmlSection[];
  invitationSections: HtmlSection[];
  lotSections: HtmlSection[];
};

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const SECTION_EVIDENCE_LIMIT = 20;
const BIDWINNER_ALLOWED_HOSTS = new Set(["bidwinner.info", "www.bidwinner.info"]);

const COMMODITY_TABLE_KEYWORDS = [
  "danh muc hang hoa",
  "hang hoa",
  "vat tu",
  "san pham",
  "thiet bi",
  "quy cach",
];

const TBMT_CONTENT_KEYWORDS = [
  "noi dung tbmt",
  "thong bao moi thau",
  "tbmt",
  "hinh thuc lua chon",
  "thoi diem dong thau",
  "thoi gian phat hanh",
  "gia goi thau",
  "nguon von",
  "phuong thuc lua chon",
];

const INVITATION_DOCUMENT_KEYWORDS = [
  "ho so moi thau",
  "hsmt",
  "e-hsmt",
  "tai ho so",
  "tai xuong",
  "moi thau",
];

const LOT_TABLE_KEYWORDS = [
  "danh sach cac lo",
  "danh sach lo",
  "cac lo",
  "chi tiet lo",
  "lot",
];

function decodeHtmlEntities(input: string): string {
  return input
    .replaceAll("&quot;", '"')
    .replaceAll("&#34;", '"')
    .replaceAll("&amp;", "&")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&nbsp;", " ");
}

function normalizeText(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function hasAnyKeyword(text: string, keywords: string[]): boolean {
  const normalized = normalizeText(text);
  return keywords.some((keyword) => normalized.includes(keyword));
}

function stripTags(input: string): string {
  const normalizedBreaks = input
    .replaceAll(/<br\s*\/?>(\n)?/gi, "\n")
    .replaceAll(/<\/p>/gi, "\n")
    .replaceAll(/<\/div>/gi, "\n");

  const withoutTags = normalizedBreaks.replaceAll(/<[^>]+>/g, " ");
  return decodeHtmlEntities(withoutTags).replace(/\s+/g, " ").trim();
}

function stripTagsKeepLines(input: string): string {
  const withBreaks = input
    .replaceAll(/<br\s*\/?>/gi, "\n")
    .replaceAll(/<\/p>/gi, "\n")
    .replaceAll(/<\/div>/gi, "\n")
    .replaceAll(/<\/li>/gi, "\n")
    .replaceAll(/<\/tr>/gi, "\n")
    .replaceAll(/<\/?h[1-6][^>]*>/gi, "\n");

  const withoutTags = withBreaks.replaceAll(/<[^>]+>/g, " ");
  return decodeHtmlEntities(withoutTags)
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function looksLikeProductText(text: string): boolean {
  if (text.length < 12 || text.length > 280) {
    return false;
  }

  const normalized = normalizeText(text);
  if (PRODUCT_HINTS.some((hint) => normalized.includes(hint))) {
    return true;
  }

  if (/\b\d+\s?(cai|bo|kg|m2|m3|lit|chai|thung|goi|cap)\b/i.test(normalized)) {
    return true;
  }

  if (/\b(model|spec|sku|part|code)\b/i.test(normalized)) {
    return true;
  }

  return false;
}

function extractTitle(html: string): string {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!match?.[1]) {
    return "Chi tiết gói thầu";
  }

  const title = stripTags(match[1]);
  return title || "Chi tiết gói thầu";
}

function dedupeProducts(items: BidWinnerDetailProduct[]): BidWinnerDetailProduct[] {
  const seen = new Set<string>();
  const deduped: BidWinnerDetailProduct[] = [];

  for (const item of items) {
    const key = normalizeText(item.text);
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(item);
  }

  return deduped.slice(0, 120);
}

function dedupeLinks(items: BidWinnerDetailLink[], limit = 150): BidWinnerDetailLink[] {
  const seen = new Set<string>();
  const deduped: BidWinnerDetailLink[] = [];

  for (const item of items) {
    const key = `${item.href}::${normalizeText(item.text)}`;
    if (!item.href || seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(item);
  }

  return deduped.slice(0, limit);
}

function dedupeStrings(items: string[], limit = 120): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const item of items) {
    const normalized = normalizeText(item);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    deduped.push(item.trim());
  }

  return deduped.slice(0, limit);
}

type TextCandidate = {
  text: string;
  source: "table" | "list" | "paragraph";
};

type HtmlSection = {
  heading: string;
  headingNormalized: string;
  contentHtml: string;
  lines: string[];
};

function extractTextCandidates(html: string): TextCandidate[] {
  const candidates: TextCandidate[] = [];

  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  for (const row of rows) {
    const cells = Array.from(row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi))
      .map((match) => stripTags(match[1] ?? ""))
      .filter(Boolean);

    if (cells.length > 0) {
      const text = cells.join(" | ").trim();
      if (text.length >= 8 && text.length <= 420) {
        candidates.push({ text, source: "table" });
      }
    }
  }

  const listItems = Array.from(html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi))
    .map((match) => stripTags(match[1] ?? ""))
    .filter(Boolean);
  for (const text of listItems) {
    if (text.length >= 8 && text.length <= 420) {
      candidates.push({ text, source: "list" });
    }
  }

  const paragraphs = Array.from(html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi))
    .map((match) => stripTags(match[1] ?? ""))
    .filter(Boolean);
  for (const text of paragraphs) {
    if (text.length >= 8 && text.length <= 420) {
      candidates.push({ text, source: "paragraph" });
    }
  }

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = normalizeText(candidate.text);
    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function parseHtmlSections(html: string): HtmlSection[] {
  const matches = Array.from(html.matchAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi));
  const sections: HtmlSection[] = [];

  for (let index = 0; index < matches.length; index += 1) {
    const headingMatch = matches[index];
    const headingInnerHtml = headingMatch?.[2] ?? "";
    const heading = stripTags(headingInnerHtml);

    if (!heading) {
      continue;
    }

    const start = (headingMatch?.index ?? 0) + (headingMatch?.[0]?.length ?? 0);
    const end = matches[index + 1]?.index ?? html.length;
    const contentHtml = html.slice(start, end);
    const lines = stripTagsKeepLines(contentHtml)
      .split(/\n+/)
      .map((line) => line.trim())
      .filter((line) => line.length >= 8 && line.length <= 420);

    sections.push({
      heading,
      headingNormalized: normalizeText(heading),
      contentHtml,
      lines,
    });
  }

  return sections;
}

function filterSectionsByKeywords(
  sections: HtmlSection[],
  keywords: string[],
): HtmlSection[] {
  return sections.filter((section) => hasAnyKeyword(section.headingNormalized, keywords));
}

function collectSectionLines(
  sections: HtmlSection[],
  predicate: (line: string) => boolean,
  limit = 120,
): string[] {
  const lines = sections.flatMap((section) => section.lines.filter((line) => predicate(line)));
  return dedupeStrings(lines, limit);
}

function collectSectionEvidence(sections: HtmlSection[]): string[] {
  return dedupeStrings(sections.flatMap((section) => section.lines), SECTION_EVIDENCE_LIMIT);
}

function collectFallbackEvidence(
  lines: string[],
  existingEvidence: string[],
  limit = SECTION_EVIDENCE_LIMIT,
): string[] {
  return dedupeStrings([...existingEvidence, ...lines], limit);
}

function looksLikeLotText(text: string): boolean {
  const normalized = normalizeText(text);
  return /(^|\s)(lo\s*\d+|lot\s*\d+|danh sach lo|cac lo|chi tiet lo)(\s|$)/i.test(
    normalized,
  );
}

function extractProductsFromTable(html: string): BidWinnerDetailProduct[] {
  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  const products: BidWinnerDetailProduct[] = [];

  for (const row of rows) {
    const cells = Array.from(row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi))
      .map((match) => stripTags(match[1] ?? ""))
      .filter(Boolean);

    if (cells.length === 0) {
      continue;
    }

    const line = cells.join(" | ");
    if (looksLikeProductText(line)) {
      products.push({ text: line, source: "table" });
    }
  }

  return products;
}

function extractProductsFromList(html: string): BidWinnerDetailProduct[] {
  const items = Array.from(html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi))
    .map((match) => stripTags(match[1] ?? ""))
    .filter(Boolean);

  const products: BidWinnerDetailProduct[] = [];
  for (const item of items) {
    if (looksLikeProductText(item)) {
      products.push({ text: item, source: "list" });
    }
  }

  return products;
}

function extractProductsFromParagraph(html: string): BidWinnerDetailProduct[] {
  const paragraphs = Array.from(html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi))
    .map((match) => stripTags(match[1] ?? ""))
    .filter(Boolean);

  const products: BidWinnerDetailProduct[] = [];
  for (const paragraph of paragraphs) {
    if (looksLikeProductText(paragraph)) {
      products.push({ text: paragraph, source: "paragraph" });
    }
  }

  return products;
}

function extractFallbackProducts(html: string): BidWinnerDetailProduct[] {
  const body = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? html;
  const lines = stripTags(body)
    .split(/[.;\n]/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines
    .filter((line) => looksLikeProductText(line))
    .slice(0, 40)
    .map((line) => ({ text: line, source: "fallback" as const }));
}

function extractProducts(html: string): BidWinnerDetailProduct[] {
  const products = [
    ...extractProductsFromTable(html),
    ...extractProductsFromList(html),
    ...extractProductsFromParagraph(html),
  ];

  const deduped = dedupeProducts(products);
  if (deduped.length > 0) {
    return deduped;
  }

  return dedupeProducts(extractFallbackProducts(html));
}

function isFileLink(href: string): boolean {
  return /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar|7z)(\?|#|$)/i.test(href);
}

function extractLinks(html: string, sourceUrl: string): BidWinnerDetailLink[] {
  const sourceHost = new URL(sourceUrl).host;
  const links: BidWinnerDetailLink[] = [];
  const seen = new Set<string>();

  const anchorRegex = /<a\b([^>]*?)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = anchorRegex.exec(html)) !== null) {
    const attrs = match[1] ?? "";
    const inner = match[2] ?? "";
    const hrefMatch = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
    const rawHref = decodeHtmlEntities(
      (hrefMatch?.[1] ?? hrefMatch?.[2] ?? hrefMatch?.[3] ?? "").trim(),
    );

    if (!rawHref) {
      continue;
    }

    const normalizedHref = rawHref.toLowerCase();
    if (
      normalizedHref.startsWith("#") ||
      normalizedHref.startsWith("javascript:") ||
      normalizedHref.startsWith("mailto:") ||
      normalizedHref.startsWith("tel:")
    ) {
      continue;
    }

    let resolvedUrl: URL;
    try {
      resolvedUrl = new URL(rawHref, sourceUrl);
    } catch {
      continue;
    }

    const href = resolvedUrl.toString();
    const text = stripTags(inner) || href;
    const key = `${href}::${normalizeText(text)}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    links.push({
      text,
      href,
      host: resolvedUrl.host,
      isExternal: resolvedUrl.host !== sourceHost,
      kind: isFileLink(href) ? "file" : "page",
    });
  }

  return links.slice(0, 250);
}

function formatLinkEvidence(link: BidWinnerDetailLink): string {
  return `${link.text} | ${link.href}`;
}

function buildTableSections(sections: HtmlSection[]): BidWinnerTableSections {
  return {
    commoditySections: filterSectionsByKeywords(sections, COMMODITY_TABLE_KEYWORDS),
    tenderNoticeSections: filterSectionsByKeywords(sections, TBMT_CONTENT_KEYWORDS),
    invitationSections: filterSectionsByKeywords(sections, INVITATION_DOCUMENT_KEYWORDS),
    lotSections: filterSectionsByKeywords(sections, LOT_TABLE_KEYWORDS),
  };
}

function extractRequiredTables(
  html: string,
  sourceUrl: string,
  products: BidWinnerDetailProduct[],
  links: BidWinnerDetailLink[],
): Pick<
  BidWinnerDetailCoreResult,
  "requiredTables" | "requiredTablesEvidence" | "extractionMeta"
> {
  const warnings: string[] = [];
  const candidates = extractTextCandidates(html);
  const sections = parseHtmlSections(html);
  const tableSections = buildTableSections(sections);

  const commodityFromSections = collectSectionLines(
    tableSections.commoditySections,
    (line) => looksLikeProductText(line) || hasAnyKeyword(line, COMMODITY_TABLE_KEYWORDS),
  );
  const commodityFallback = dedupeStrings(
    [
      ...products.map((item) => item.text),
      ...candidates
        .filter(
          (candidate) =>
            looksLikeProductText(candidate.text) ||
            hasAnyKeyword(candidate.text, COMMODITY_TABLE_KEYWORDS),
        )
        .map((candidate) => candidate.text),
    ],
  );
  const commodityCategories =
    commodityFromSections.length > 0 ? commodityFromSections : commodityFallback;
  if (tableSections.commoditySections.length === 0) {
    warnings.push(
      "Không tìm thấy section Danh mục hàng hóa theo heading, đã dùng heuristic toàn trang.",
    );
  } else if (commodityFromSections.length === 0) {
    warnings.push("Section Danh mục hàng hóa không đủ dữ liệu, đã dùng fallback heuristic.");
  }

  const tenderFromSections = collectSectionLines(
    tableSections.tenderNoticeSections,
    (line) => hasAnyKeyword(line, TBMT_CONTENT_KEYWORDS),
  );
  const tenderFallback = dedupeStrings(
    candidates
      .filter((candidate) => hasAnyKeyword(candidate.text, TBMT_CONTENT_KEYWORDS))
      .map((candidate) => candidate.text),
  );
  const tenderNoticeContents =
    tenderFromSections.length > 0 ? tenderFromSections : tenderFallback;
  if (tableSections.tenderNoticeSections.length === 0) {
    warnings.push(
      "Không tìm thấy section Nội dung TBMT theo heading, đã dùng heuristic toàn trang.",
    );
  } else if (tenderFromSections.length === 0) {
    warnings.push("Section Nội dung TBMT không đủ dữ liệu, đã dùng fallback heuristic.");
  }

  const invitationFromSections = dedupeLinks(
    tableSections.invitationSections
      .flatMap((section) => extractLinks(section.contentHtml, sourceUrl))
      .filter((link) =>
        hasAnyKeyword(`${link.text} ${link.href}`, INVITATION_DOCUMENT_KEYWORDS),
      ),
  );
  const invitationFallback = links
    .filter(
      (link) =>
        hasAnyKeyword(`${link.text} ${link.href}`, INVITATION_DOCUMENT_KEYWORDS) ||
        (link.kind === "file" &&
          hasAnyKeyword(`${link.text} ${link.href}`, ["thau", "hsmt", "ho so"])),
    )
    .slice(0, 150);
  const invitationDocuments =
    invitationFromSections.length > 0 ? invitationFromSections : invitationFallback;
  if (tableSections.invitationSections.length === 0) {
    warnings.push(
      "Không tìm thấy section Hồ sơ mời thầu theo heading, đã dùng heuristic toàn trang.",
    );
  } else if (invitationFromSections.length === 0) {
    warnings.push("Section Hồ sơ mời thầu không đủ dữ liệu, đã dùng fallback heuristic.");
  }

  const lotFromSections = collectSectionLines(
    tableSections.lotSections,
    (line) => looksLikeLotText(line),
  );
  const lotFallback = dedupeStrings(
    candidates
      .filter((candidate) => looksLikeLotText(candidate.text))
      .map((candidate) => candidate.text),
  );
  const lotList = lotFromSections.length > 0 ? lotFromSections : lotFallback;
  if (tableSections.lotSections.length === 0) {
    warnings.push(
      "Không tìm thấy section Danh sách các lô theo heading, đã dùng heuristic toàn trang.",
    );
  } else if (lotFromSections.length === 0) {
    warnings.push("Section Danh sách các lô không đủ dữ liệu, đã dùng fallback heuristic.");
  }

  const commodityEvidence = collectFallbackEvidence(
    commodityFallback,
    collectSectionEvidence(tableSections.commoditySections),
  );
  const tenderEvidence = collectFallbackEvidence(
    tenderFallback,
    collectSectionEvidence(tableSections.tenderNoticeSections),
  );
  const invitationEvidence = collectFallbackEvidence(
    invitationFallback.map((link) => formatLinkEvidence(link)),
    collectSectionEvidence(tableSections.invitationSections),
  );
  const lotEvidence = collectFallbackEvidence(
    lotFallback,
    collectSectionEvidence(tableSections.lotSections),
  );

  const sectionsDetected = dedupeStrings(
    [
      ...tableSections.commoditySections.map((section) => section.heading),
      ...tableSections.tenderNoticeSections.map((section) => section.heading),
      ...tableSections.invitationSections.map((section) => section.heading),
      ...tableSections.lotSections.map((section) => section.heading),
    ],
    80,
  );

  return {
    requiredTables: {
      commodityCategories,
      tenderNoticeContents,
      invitationDocuments,
      lotList,
    },
    requiredTablesEvidence: {
      commodityCategories: commodityEvidence,
      tenderNoticeContents: tenderEvidence,
      invitationDocuments: invitationEvidence,
      lotList: lotEvidence,
    },
    extractionMeta: {
      sectionsDetected,
      warnings: dedupeStrings(warnings, 40),
    },
  };
}

export class InvalidSourceUrlError extends Error {}

function isAllowedBidWinnerHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return (
    BIDWINNER_ALLOWED_HOSTS.has(normalized) || normalized.endsWith(".bidwinner.info")
  );
}

function assertAllowedSourceUrl(url: URL): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new InvalidSourceUrlError("Source URL không hợp lệ (chỉ hỗ trợ http/https).");
  }

  if (!isAllowedBidWinnerHost(url.host)) {
    throw new InvalidSourceUrlError(
      "Source URL không hợp lệ: chỉ cho phép domain BidWinner và subdomain liên quan.",
    );
  }
}

function buildSourceUrl(externalId: string, sourceUrl?: string): string {
  const maybeSource = sourceUrl?.trim();
  if (maybeSource) {
    const parsed = new URL(maybeSource);
    assertAllowedSourceUrl(parsed);
    return parsed.toString();
  }

  const id = externalId.trim();
  if (!id) {
    throw new InvalidSourceUrlError("Thiếu externalId để tạo source URL chi tiết.");
  }

  const fallbackUrl = new URL(
    `/4.0/chi-tiet-goi-thau/${encodeURIComponent(id)}`,
    "https://bidwinner.info",
  );
  assertAllowedSourceUrl(fallbackUrl);
  return fallbackUrl.toString();
}

function computeCacheKey(externalId: string, sourceUrl: string): string {
  return createHash("sha256")
    .update(`${externalId.trim()}::${sourceUrl.trim().toLowerCase()}`)
    .digest("hex");
}

function toEpochMs(value: string): number | null {
  const epoch = new Date(value).getTime();
  return Number.isFinite(epoch) ? epoch : null;
}

function toCachePayload(core: BidWinnerDetailCoreResult): Record<string, unknown> {
  return core as unknown as Record<string, unknown>;
}

function parseCachePayload(value: unknown): BidWinnerDetailCoreResult | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const payload = value as Partial<BidWinnerDetailCoreResult>;
  if (
    typeof payload.externalId !== "string" ||
    typeof payload.sourceUrl !== "string" ||
    typeof payload.pageTitle !== "string" ||
    !Array.isArray(payload.products) ||
    !Array.isArray(payload.links) ||
    !payload.requiredTables ||
    !payload.requiredTablesEvidence ||
    !payload.extractionMeta ||
    typeof payload.fetchedAt !== "string"
  ) {
    return null;
  }

  return payload as BidWinnerDetailCoreResult;
}

function hydrateDetailResult(
  core: BidWinnerDetailCoreResult,
  options: {
    fromCache: boolean;
    cacheAgeMs: number | null;
    extraWarnings?: string[];
  },
): BidWinnerDetailResult {
  return {
    ...core,
    extractionMeta: {
      fromCache: options.fromCache,
      cacheAgeMs: options.cacheAgeMs,
      sectionsDetected: core.extractionMeta.sectionsDetected,
      warnings: dedupeStrings(
        [...core.extractionMeta.warnings, ...(options.extraWarnings ?? [])],
        40,
      ),
    },
  };
}

async function fetchDetailHtml(sourceUrl: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.BIDWINNER_TIMEOUT_MS);

  try {
    const response = await fetch(sourceUrl, {
      headers: DEFAULT_HEADERS,
      signal: controller.signal,
      cache: "no-store",
      redirect: "follow",
    });

    if (!response.ok) {
      throw new Error(`Trang nguồn trả về mã lỗi ${response.status}.`);
    }

    return response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function extractLiveDetails(input: {
  externalId: string;
  sourceUrl: string;
}): Promise<BidWinnerDetailCoreResult> {
  const html = await fetchDetailHtml(input.sourceUrl);
  const products = extractProducts(html);
  const links = extractLinks(html, input.sourceUrl);
  const requiredTableResult = extractRequiredTables(
    html,
    input.sourceUrl,
    products,
    links,
  );

  return {
    externalId: input.externalId,
    sourceUrl: input.sourceUrl,
    pageTitle: extractTitle(html),
    products,
    links,
    requiredTables: requiredTableResult.requiredTables,
    requiredTablesEvidence: requiredTableResult.requiredTablesEvidence,
    extractionMeta: requiredTableResult.extractionMeta,
    fetchedAt: new Date().toISOString(),
  };
}

export async function fetchBidWinnerDetail(input: {
  externalId: string;
  sourceUrl?: string;
}): Promise<BidWinnerDetailResult> {
  const resolvedSourceUrl = buildSourceUrl(input.externalId, input.sourceUrl);
  const cacheKey = computeCacheKey(input.externalId, resolvedSourceUrl);

  let cacheRow: typeof packageDetailsCache.$inferSelect | undefined;
  try {
    const [row] = await db
      .select()
      .from(packageDetailsCache)
      .where(eq(packageDetailsCache.cacheKey, cacheKey))
      .limit(1);
    cacheRow = row;
  } catch (error) {
    console.warn("Package details cache read failed, continue without cache", {
      externalId: input.externalId,
      sourceUrl: resolvedSourceUrl,
      error,
    });
  }

  const cachedCore = parseCachePayload(cacheRow?.payloadJson);
  const cachedAgeMs =
    cacheRow?.updatedAt != null ? (() => {
      const updatedAtMs = toEpochMs(cacheRow.updatedAt);
      if (updatedAtMs === null) {
        return null;
      }

      return Date.now() - updatedAtMs;
    })() : null;

  if (cachedCore && cachedAgeMs !== null && cachedAgeMs <= CACHE_TTL_MS) {
    console.info("Package details cache hit", {
      externalId: input.externalId,
      sourceUrl: resolvedSourceUrl,
      cacheAgeMs: cachedAgeMs,
    });

    return hydrateDetailResult(cachedCore, {
      fromCache: true,
      cacheAgeMs: cachedAgeMs,
    });
  }

  try {
    const freshCore = await extractLiveDetails({
      externalId: input.externalId,
      sourceUrl: resolvedSourceUrl,
    });
    const nowIso = new Date().toISOString();

    try {
      await db
        .insert(packageDetailsCache)
        .values({
          externalId: input.externalId,
          sourceUrl: resolvedSourceUrl,
          cacheKey,
          payloadJson: toCachePayload(freshCore),
          fetchedAt: freshCore.fetchedAt,
          updatedAt: nowIso,
        })
        .onConflictDoUpdate({
          target: packageDetailsCache.cacheKey,
          set: {
            externalId: input.externalId,
            sourceUrl: resolvedSourceUrl,
            payloadJson: toCachePayload(freshCore),
            fetchedAt: freshCore.fetchedAt,
            updatedAt: nowIso,
          },
        });

      console.info("Package details cache refreshed", {
        externalId: input.externalId,
        sourceUrl: resolvedSourceUrl,
      });
    } catch (error) {
      console.warn("Package details cache write failed, continue with live data", {
        externalId: input.externalId,
        sourceUrl: resolvedSourceUrl,
        error,
      });
    }

    return hydrateDetailResult(freshCore, {
      fromCache: false,
      cacheAgeMs: null,
    });
  } catch (error) {
    if (cachedCore) {
      console.warn("Package details upstream failed, serving stale cache", {
        externalId: input.externalId,
        sourceUrl: resolvedSourceUrl,
        cacheAgeMs: cachedAgeMs,
        error,
      });

      return hydrateDetailResult(cachedCore, {
        fromCache: true,
        cacheAgeMs: cachedAgeMs,
        extraWarnings: [
          "Nguồn trang chi tiết tạm thời lỗi, đang dùng dữ liệu cache đã lưu trước đó.",
        ],
      });
    }

    throw error;
  }
}
