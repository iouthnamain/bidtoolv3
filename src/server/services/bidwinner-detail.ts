import { env } from "~/env";

const DEFAULT_HEADERS = {
  "User-Agent": "BidToolV3/1.0 (+https://localhost)",
  Accept: "text/html,application/xhtml+xml",
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
  fetchedAt: string;
};

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

function extractHeadingSectionLines(html: string, keywords: string[]): string[] {
  const matches = Array.from(html.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi));
  const lines: string[] = [];

  for (let index = 0; index < matches.length; index += 1) {
    const heading = matches[index];
    if (!heading?.[1]) {
      continue;
    }

    const headingText = stripTags(heading[1]);
    if (!hasAnyKeyword(headingText, keywords)) {
      continue;
    }

    const start = (heading.index ?? 0) + heading[0].length;
    const end = matches[index + 1]?.index ?? html.length;
    const sectionHtml = html.slice(start, end);
    const sectionLines = stripTagsKeepLines(sectionHtml)
      .split(/\n+/)
      .map((line) => line.trim())
      .filter((line) => line.length >= 8 && line.length <= 420);

    lines.push(...sectionLines);
  }

  return dedupeStrings(lines, 120);
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

function extractRequiredTables(
  html: string,
  products: BidWinnerDetailProduct[],
  links: BidWinnerDetailLink[],
) {
  const candidates = extractTextCandidates(html);

  const commodityCategories = dedupeStrings(
    [
      ...products.map((item) => item.text),
      ...candidates
        .filter(
          (candidate) =>
            looksLikeProductText(candidate.text) ||
            hasAnyKeyword(candidate.text, COMMODITY_TABLE_KEYWORDS),
        )
        .map((candidate) => candidate.text),
      ...extractHeadingSectionLines(html, COMMODITY_TABLE_KEYWORDS),
    ],
    120,
  );

  const tenderNoticeContents = dedupeStrings(
    [
      ...extractHeadingSectionLines(html, TBMT_CONTENT_KEYWORDS),
      ...candidates
        .filter((candidate) => hasAnyKeyword(candidate.text, TBMT_CONTENT_KEYWORDS))
        .map((candidate) => candidate.text),
    ],
    120,
  );

  const invitationDocuments = links
    .filter(
      (link) =>
        hasAnyKeyword(`${link.text} ${link.href}`, INVITATION_DOCUMENT_KEYWORDS) ||
        (link.kind === "file" && hasAnyKeyword(`${link.text} ${link.href}`, ["thau", "hsmt", "ho so"])),
    )
    .slice(0, 150);

  const lotList = dedupeStrings(
    [
      ...extractHeadingSectionLines(html, LOT_TABLE_KEYWORDS),
      ...candidates
        .filter((candidate) => looksLikeLotText(candidate.text))
        .map((candidate) => candidate.text),
    ],
    120,
  );

  return {
    commodityCategories,
    tenderNoticeContents,
    invitationDocuments,
    lotList,
  };
}

function buildSourceUrl(externalId: string, sourceUrl?: string): string {
  const maybeSource = sourceUrl?.trim();
  if (maybeSource) {
    const parsed = new URL(maybeSource);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Source URL không hợp lệ (chỉ hỗ trợ http/https).");
    }

    return parsed.toString();
  }

  const id = externalId.trim();
  if (!id) {
    throw new Error("Thiếu externalId để tạo source URL chi tiết.");
  }

  return `https://bidwinner.info/4.0/chi-tiet-goi-thau/${encodeURIComponent(id)}`;
}

async function fetchDetailHtml(sourceUrl: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.BIDWINNER_TIMEOUT_MS);

  try {
    const response = await fetch(sourceUrl, {
      headers: DEFAULT_HEADERS,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Trang nguồn trả về mã lỗi ${response.status}.`);
    }

    return response.text();
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchBidWinnerDetail(input: {
  externalId: string;
  sourceUrl?: string;
}): Promise<BidWinnerDetailResult> {
  const resolvedSourceUrl = buildSourceUrl(input.externalId, input.sourceUrl);
  const html = await fetchDetailHtml(resolvedSourceUrl);
  const products = extractProducts(html);
  const links = extractLinks(html, resolvedSourceUrl);

  return {
    externalId: input.externalId,
    sourceUrl: resolvedSourceUrl,
    pageTitle: extractTitle(html),
    products,
    links,
    requiredTables: extractRequiredTables(html, products, links),
    fetchedAt: new Date().toISOString(),
  };
}
