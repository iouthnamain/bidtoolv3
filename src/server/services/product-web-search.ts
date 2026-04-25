import { env } from "~/env";

export type ProductSearchRequirement = {
  productName: string;
  unit?: string | null;
  specText?: string | null;
  searchKeywords?: string[];
  vendorHint?: string | null;
  originHint?: string | null;
  targetPrice?: number | null;
  currency?: string | null;
};

export type ExtractedProductSpec = {
  productName: string;
  brand: string | null;
  model: string | null;
  specSummary: string;
  unit: string | null;
  priceText: string | null;
  priceVnd: number | null;
  originCountry: string | null;
  vendorName: string | null;
  vendorDomain: string;
  sourceUrl: string;
  imageUrl: string | null;
  evidenceText: string;
};

export type ProductSearchProvider = "searxng";

export type ProductCandidate = {
  provider: ProductSearchProvider;
  query: string;
  title: string;
  url: string;
  domain: string;
  snippet: string;
  rawEvidence: string;
  imageUrl: string | null;
  extractedSpec: ExtractedProductSpec;
  confidenceScore: number;
  matchReasons: string[];
};

export type ProductWebSearchResult = {
  query: string;
  candidates: ProductCandidate[];
  warning?: string;
};

type SearxngSearchResult = {
  title?: string;
  url?: string;
  content?: string;
  img_src?: string | null;
  thumbnail?: string | null;
  engine?: string;
  engines?: string[];
};

type SearxngResponse = {
  results?: SearxngSearchResult[];
};

const TOKEN_MIN_LENGTH = 2;
const PRODUCT_WORD_LIMIT = 420;

function normalizeText(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(input: string): string[] {
  return normalizeText(input)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= TOKEN_MIN_LENGTH);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  );
}

function safeDomain(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

function buildSearxngSearchUrl(query: string): URL {
  const baseUrl = env.SEARXNG_BASE_URL;
  if (!baseUrl) {
    throw new Error("SEARXNG_BASE_URL is not configured");
  }

  const normalizedBase = new URL(baseUrl);
  if (!normalizedBase.pathname.endsWith("/")) {
    normalizedBase.pathname = `${normalizedBase.pathname}/`;
  }

  const searchUrl = new URL("search", normalizedBase);
  searchUrl.searchParams.set("q", query);
  searchUrl.searchParams.set("format", "json");
  searchUrl.searchParams.set("categories", "general");
  searchUrl.searchParams.set("language", env.SEARXNG_LANGUAGE);
  searchUrl.searchParams.set("safesearch", "1");
  searchUrl.searchParams.set("pageno", "1");

  if (env.SEARXNG_ENGINES) {
    searchUrl.searchParams.set("engines", env.SEARXNG_ENGINES);
  }

  return searchUrl;
}

function normalizeCandidateUrl(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }

  try {
    return new URL(url).toString();
  } catch {
    if (!env.SEARXNG_BASE_URL) {
      return null;
    }

    try {
      return new URL(url, env.SEARXNG_BASE_URL).toString();
    } catch {
      return null;
    }
  }
}

export function buildProductSearchQuery(
  input: ProductSearchRequirement,
): string {
  return uniqueStrings([
    input.productName,
    input.unit ?? "",
    input.specText ?? "",
    ...(input.searchKeywords ?? []),
    input.vendorHint ?? "",
    input.originHint ?? "",
    input.targetPrice ? `${input.targetPrice} ${input.currency ?? "VND"}` : "",
    "gia",
    "thong so",
    "Viet Nam",
  ]).join(" ");
}

function compactEvidence(...parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => part?.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, PRODUCT_WORD_LIMIT);
}

function findPrice(text: string): {
  priceText: string | null;
  priceVnd: number | null;
} {
  const match =
    /((?:\d{1,3}(?:[.,]\d{3})+|\d+)(?:\s*(?:vnd|vnđ|₫|dong|đồng)))/i.exec(
      text,
    ) ??
    /(?:gia|giá)\s*:?\s*((?:\d{1,3}(?:[.,]\d{3})+|\d+)(?:\s*(?:vnd|vnđ|₫|dong|đồng))?)/i.exec(
      text,
    );

  if (!match?.[1]) {
    return { priceText: null, priceVnd: null };
  }

  const priceText = match[1].trim();
  const numeric = Number(priceText.replace(/[^\d]/g, ""));
  return {
    priceText,
    priceVnd: Number.isFinite(numeric) && numeric > 0 ? numeric : null,
  };
}

function findModel(text: string): string | null {
  const match =
    /\b(?:model|ma|mã|sku|part(?:\s*number)?)\s*[:#-]?\s*([A-Z0-9][A-Z0-9._/-]{2,})/i.exec(
      text,
    ) ?? /\b([A-Z]{1,5}[-_/]?\d{2,}[A-Z0-9._/-]*)\b/.exec(text);

  return match?.[1]?.trim() ?? null;
}

function findOrigin(text: string): string | null {
  const match =
    /(?:xuat xu|xuất xứ|origin|made in)\s*:?\s*([A-Za-zÀ-ỹ\s]{2,32})/i.exec(
      text,
    ) ??
    /\b(Viet Nam|Việt Nam|Japan|Nhật Bản|China|Trung Quốc|Korea|Hàn Quốc|Germany|Đức|USA|Mỹ|Taiwan|Đài Loan)\b/i.exec(
      text,
    );

  return match?.[1]?.replace(/[.;,].*$/, "").trim() ?? null;
}

function findUnit(text: string, preferredUnit: string): string | null {
  const normalized = normalizeText(text);
  const preferred = normalizeText(preferredUnit);
  if (preferred && normalized.includes(preferred)) {
    return preferredUnit;
  }

  const match =
    /\b(cai|cái|bo|bộ|chiec|chiếc|kg|m|m2|m3|lit|lít|cuon|cuộn|hop|hộp|binh|bình|cay|cây|vien|viên|con)\b/i.exec(
      text,
    );
  return match?.[1] ?? null;
}

function vendorNameFromDomain(domain: string): string | null {
  const clean = domain.replace(/^www\./, "").split(".")[0];
  if (!clean) {
    return null;
  }
  return clean.replace(/[-_]+/g, " ");
}

function guessBrand(title: string): string | null {
  const words = title
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}-]/gu, ""))
    .filter(Boolean);

  const candidate = words.find((word) => /^[A-Z0-9-]{3,}$/.test(word));
  return candidate ?? null;
}

export function extractProductSpec(input: {
  title: string;
  url: string;
  snippet: string;
  rawContent?: string | null;
  imageUrl?: string | null;
  requirement: ProductSearchRequirement;
}): ExtractedProductSpec {
  const domain = safeDomain(input.url);
  const evidenceText = compactEvidence(
    input.title,
    input.snippet,
    input.rawContent,
  );
  const price = findPrice(evidenceText);
  const model = findModel(evidenceText);
  const originCountry = findOrigin(evidenceText);
  const unit = input.requirement.unit
    ? findUnit(evidenceText, input.requirement.unit)
    : null;

  return {
    productName: input.title || input.requirement.productName,
    brand: guessBrand(input.title),
    model,
    specSummary: evidenceText || input.snippet || input.title,
    unit,
    priceText: price.priceText,
    priceVnd: price.priceVnd,
    originCountry,
    vendorName: vendorNameFromDomain(domain),
    vendorDomain: domain,
    sourceUrl: input.url,
    imageUrl: input.imageUrl ?? null,
    evidenceText,
  };
}

export function scoreProductCandidate(input: {
  requirement: ProductSearchRequirement;
  spec: ExtractedProductSpec;
}): { confidenceScore: number; reasons: string[] } {
  const reasons: string[] = [];
  const targetTokens = uniqueStrings([
    ...tokenize(input.requirement.productName),
    ...(input.requirement.searchKeywords ?? []).flatMap((keyword) =>
      tokenize(keyword),
    ),
    ...tokenize(input.requirement.specText ?? ""),
  ]);
  const haystack = normalizeText(
    `${input.spec.productName} ${input.spec.specSummary} ${input.spec.vendorDomain}`,
  );

  const matchedTokens = targetTokens.filter((token) =>
    haystack.includes(token),
  );
  let score = 0;

  if (targetTokens.length > 0) {
    const overlapScore = Math.round(
      (matchedTokens.length / targetTokens.length) * 35,
    );
    score += overlapScore;
    if (matchedTokens.length > 0) {
      reasons.push(
        `Khớp ${matchedTokens.length}/${targetTokens.length} từ khóa`,
      );
    }
  }

  if (
    input.spec.unit &&
    input.requirement.unit &&
    normalizeText(input.spec.unit).includes(
      normalizeText(input.requirement.unit),
    )
  ) {
    score += 15;
    reasons.push("ĐVT/spec gần với yêu cầu");
  }

  if (input.spec.priceVnd) {
    score += 10;
    reasons.push("Có thông tin giá");
    if (
      input.requirement.targetPrice &&
      input.spec.priceVnd <= input.requirement.targetPrice
    ) {
      score += 5;
      reasons.push("Giá không vượt trần");
    }
  }

  if (
    input.requirement.originHint &&
    input.spec.originCountry &&
    normalizeText(input.spec.originCountry).includes(
      normalizeText(input.requirement.originHint),
    )
  ) {
    score += 10;
    reasons.push("Khớp xuất xứ ưu tiên");
  }

  if (
    /(\.vn\b|viet|việt|vietnam|việt nam)/i.test(
      `${input.spec.vendorDomain} ${input.spec.evidenceText}`,
    )
  ) {
    score += 10;
    reasons.push("Nguồn có ngữ cảnh Việt Nam");
  }

  if (input.spec.model) {
    score += 5;
    reasons.push("Có mã mẫu");
  }

  if (reasons.length === 0) {
    reasons.push("Cần kiểm tra thủ công");
  }

  return {
    confidenceScore: Math.max(0, Math.min(100, score)),
    reasons,
  };
}

async function searchSearxngProductCandidates(
  requirement: ProductSearchRequirement,
): Promise<ProductWebSearchResult> {
  const query = buildProductSearchQuery(requirement);
  if (!env.SEARXNG_BASE_URL) {
    return {
      query,
      candidates: [],
      warning:
        "Chưa cấu hình SEARXNG_BASE_URL. Có thể nhập kết quả thủ công để lưu nguồn.",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.SEARXNG_TIMEOUT_MS);

  try {
    const response = await fetch(buildSearxngSearchUrl(query), {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    if (!response.ok) {
      const hint =
        response.status === 403
          ? " Kiểm tra `search.formats` của SearXNG đã bật `json`."
          : "";
      return {
        query,
        candidates: [],
        warning: `SearXNG trả về lỗi ${response.status}.${hint} Có thể thử lại hoặc nhập kết quả thủ công.`,
      };
    }

    const payload = (await response.json()) as SearxngResponse;
    const candidates = (payload.results ?? [])
      .slice(0, env.SEARXNG_MAX_RESULTS)
      .map((result): ProductCandidate | null => {
        const url = normalizeCandidateUrl(result.url);
        const imageUrl = normalizeCandidateUrl(
          result.img_src ?? result.thumbnail,
        );
        if (!url || !result.title) {
          return null;
        }

        const snippet = compactEvidence(
          result.content,
          result.engine,
          result.engines?.join(", "),
        );
        const spec = extractProductSpec({
          title: result.title,
          url,
          snippet,
          rawContent: result.content,
          imageUrl,
          requirement,
        });
        const scored = scoreProductCandidate({ requirement, spec });

        return {
          provider: "searxng" as const,
          query,
          title: result.title,
          url,
          domain: safeDomain(url),
          snippet,
          rawEvidence: snippet,
          imageUrl,
          extractedSpec: spec,
          confidenceScore: scored.confidenceScore,
          matchReasons: scored.reasons,
        };
      })
      .filter((candidate): candidate is ProductCandidate => candidate !== null)
      .sort((a, b) => b.confidenceScore - a.confidenceScore);

    return { query, candidates };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Lỗi không xác định";
    return {
      query,
      candidates: [],
      warning: `Không thể tìm gợi ý qua SearXNG: ${message}. Có thể thử lại hoặc nhập kết quả thủ công.`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function searchProductCandidates(
  requirement: ProductSearchRequirement,
): Promise<ProductWebSearchResult> {
  return searchSearxngProductCandidates(requirement);
}
