import {
  CATEGORY_OPTIONS,
  KEYWORD_OPTIONS,
  PROVINCE_OPTIONS,
  type SortBy,
  type SortOrder,
} from "~/constants/search-options";
import { env } from "~/env";

type SearchOptions = {
  keyword?: string;
  provinces: string[];
  categories: string[];
  budgetMin?: number;
  budgetMax?: number;
  minMatchScore: number;
  sortBy: SortBy;
  sortOrder: SortOrder;
  offset: number;
  limit: number;
};

type BidWinnerRawItem = {
  id: number;
  so_tbmt?: number | string;
  ten_goi_thau?: string;
  owner?: string | null;
  bmt?: string | null;
  city?: string | null;
  dt_goi_thau_vnd?: number | null;
  thoi_diem_dang_tai?: string;
  td_dong_thau?: string | null;
  competitive_score?: number | null;
};

type BidWinnerPayload = {
  current_page?: number;
  per_page?: number;
  last_page?: number;
  total?: number;
  data: BidWinnerRawItem[];
};

type BidWinnerProvinceEntry = {
  matp?: number | string;
  ten_tinh?: string;
  name?: string;
  ten?: string;
};

export type LivePackageItem = {
  id: number;
  externalId: string;
  title: string;
  inviter: string;
  province: string;
  category: string;
  budget: number;
  publishedAt: string;
  closingAt: string | null;
  matchScore: number;
  sourceUrl: string;
};

export type LocalRefinementField =
  | "keyword"
  | "categories"
  | "budget"
  | "minMatchScore";

export type LocalRefinementMeta = {
  active: boolean;
  fields: LocalRefinementField[];
};

export type LiveSearchResult = {
  items: LivePackageItem[];
  total: number;
  visibleCount: number;
  offset: number;
  limit: number;
  source: "bidwinner_live";
  fetchedAt: string;
  warning?: string;
  localRefinement: LocalRefinementMeta;
  options: {
    provinces: string[];
    categories: string[];
    keywords: string[];
  };
};

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

const SEARCH_PAYLOAD_REGEX = /<bid-search[^>]*:hsmts="([^"]+)"/i;
const PROVINCE_PAYLOAD_REGEX = /<bid-search[^>]*:ttp="([^"]+)"/i;
const MAX_FETCH_ATTEMPTS = 3;
const BIDWINNER_PER_PAGE = 20;

const STOP_WORDS = new Set([
  "goi",
  "gói",
  "thau",
  "thầu",
  "so",
  "số",
  "nam",
  "năm",
  "cho",
  "cua",
  "của",
  "tai",
  "tại",
  "va",
  "và",
  "theo",
  "dot",
  "đợt",
  "phuc",
  "phục",
  "vu",
  "vụ",
  "mua",
  "sam",
  "sắm",
]);

function normalizeText(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeProvince(input: string): string {
  return normalizeText(input)
    .replace(/^thanh pho\s+/, "")
    .replace(/^tinh\s+/, "")
    .replace(/^tp\.?\s*/, "")
    .trim();
}

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

function inferCategory(title: string): string {
  const text = normalizeText(title);

  if (/(benh vien|y te|thuoc|xet nghiem|hoa chat y)/.test(text)) {
    return "Y tế";
  }
  if (
    /(phan mem|may tinh|mang|cntt|viễn thong|vien thong|an ninh mang)/.test(
      text,
    )
  ) {
    return "Công nghệ thông tin";
  }
  if (/(xay dung|thi cong|xay lap|ha tang|cong trinh)/.test(text)) {
    return "Xây dựng";
  }
  if (/(truong|giao duc|dao tao|hoc)/.test(text)) {
    return "Giáo dục";
  }
  if (/(nong nghiep|thuy san|phan bon|giong)/.test(text)) {
    return "Nông nghiệp";
  }
  if (/(dien luc|cap dien|tu dien|dien)/.test(text)) {
    return "Điện lực";
  }
  if (/(giao thong|duong|cau|van tai)/.test(text)) {
    return "Giao thông";
  }
  if (/(moi truong|xu ly rac|nuoc thai)/.test(text)) {
    return "Môi trường";
  }
  if (/(may in|ban ghe|van phong|phong hop)/.test(text)) {
    return "Thiết bị văn phòng";
  }
  if (/(tu van|giam sat|lap bao cao|tham dinh)/.test(text)) {
    return "Dịch vụ tư vấn";
  }
  if (/(bao ve|camera|phong chay|an ninh)/.test(text)) {
    return "An ninh";
  }

  return "Khác";
}

function extractDynamicKeywords(items: LivePackageItem[]): string[] {
  const counter = new Map<string, number>();

  for (const item of items) {
    const tokens = `${item.title} ${item.inviter}`
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .map((token) => token.trim())
      .filter((token) => token.length >= 4 && !STOP_WORDS.has(token));

    for (const token of tokens) {
      counter.set(token, (counter.get(token) ?? 0) + 1);
    }
  }

  return Array.from(counter.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([token]) => token);
}

function parseBidSearchPayload(html: string): BidWinnerPayload {
  const match = SEARCH_PAYLOAD_REGEX.exec(html);
  if (!match?.[1]) {
    throw new Error("Không tìm thấy payload dữ liệu BidWinner trong HTML.");
  }

  const payloadJson = decodeHtmlEntities(match[1]);
  const parsed = JSON.parse(payloadJson) as BidWinnerPayload;
  if (!Array.isArray(parsed.data)) {
    throw new Error("Payload BidWinner không đúng định dạng mong đợi.");
  }

  return parsed;
}

function parseProvincePayload(
  html: string,
): Map<string, string> {
  const map = new Map<string, string>();
  const match = PROVINCE_PAYLOAD_REGEX.exec(html);
  if (!match?.[1]) {
    return map;
  }

  try {
    const payloadJson = decodeHtmlEntities(match[1]);
    const parsed = JSON.parse(payloadJson) as
      | BidWinnerProvinceEntry[]
      | { data?: BidWinnerProvinceEntry[] };
    const entries: BidWinnerProvinceEntry[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.data)
        ? parsed.data
        : [];

    for (const entry of entries) {
      const code =
        entry.matp !== undefined && entry.matp !== null
          ? String(entry.matp).trim()
          : "";
      const name = entry.ten_tinh ?? entry.name ?? entry.ten ?? "";
      if (!code || !name) {
        continue;
      }
      map.set(normalizeProvince(name), code);
    }
  } catch {
    // ignore malformed ttp payload
  }

  return map;
}

let cachedProvinceCodeMap: Map<string, string> | null = null;

function rememberProvinceCodeMap(map: Map<string, string>) {
  if (map.size === 0) {
    return;
  }
  cachedProvinceCodeMap = map;
}

function resolveProvinceCodes(
  selected: string[],
  map: Map<string, string>,
): string[] {
  const codes: string[] = [];
  for (const value of selected) {
    const key = normalizeProvince(value);
    const code = map.get(key) ?? cachedProvinceCodeMap?.get(key);
    if (code) {
      codes.push(code);
    }
  }
  return Array.from(new Set(codes));
}

function toLivePackageItem(raw: BidWinnerRawItem): LivePackageItem | null {
  if (!raw.id || !raw.ten_goi_thau) {
    return null;
  }

  const inviter = raw.owner ?? raw.bmt ?? "Chưa xác định";
  const province = raw.city ?? "Chưa xác định";
  const publishedAt = raw.thoi_diem_dang_tai ?? new Date().toISOString();
  const closingAt = raw.td_dong_thau ?? null;
  const budget = Number(raw.dt_goi_thau_vnd ?? 0);
  const category = inferCategory(raw.ten_goi_thau);
  const matchScore = Number(raw.competitive_score ?? 65);
  const soTbmt = String(raw.so_tbmt ?? "").trim();
  const sourceUrl = raw.id
    ? `https://bidwinner.info/4.0/chi-tiet-goi-thau/${raw.id}`
    : soTbmt
      ? `https://bidwinner.info/4.0/search-tbmt/?so_tbmt=${encodeURIComponent(soTbmt)}`
      : "https://bidwinner.info/4.0/tim-kiem-goi-thau";

  return {
    id: raw.id,
    externalId: String(raw.id),
    title: raw.ten_goi_thau,
    inviter,
    province,
    category,
    budget: Number.isFinite(budget) ? budget : 0,
    publishedAt,
    closingAt,
    matchScore: Number.isFinite(matchScore)
      ? Math.max(0, Math.min(100, matchScore))
      : 0,
    sourceUrl,
  };
}

function applyLocalRefinement(
  items: LivePackageItem[],
  input: SearchOptions,
): { items: LivePackageItem[]; fields: LocalRefinementField[] } {
  const keywords = (input.keyword ?? "")
    .split(",")
    .map((term) => normalizeText(term))
    .filter(Boolean);
  const categories = input.categories.map((value) => normalizeText(value));

  const fields: LocalRefinementField[] = [];
  if (keywords.length > 0) fields.push("keyword");
  if (categories.length > 0) fields.push("categories");
  if (
    typeof input.budgetMin === "number" ||
    typeof input.budgetMax === "number"
  )
    fields.push("budget");
  if (input.minMatchScore > 0) fields.push("minMatchScore");

  const filtered = items.filter((item) => {
    if (keywords.length > 0) {
      const haystack = normalizeText(`${item.title} ${item.inviter}`);
      if (!keywords.some((term) => haystack.includes(term))) return false;
    }

    if (categories.length > 0) {
      const itemCategory = normalizeText(item.category);
      if (!categories.includes(itemCategory)) return false;
    }

    if (typeof input.budgetMin === "number" && item.budget < input.budgetMin) {
      return false;
    }

    if (typeof input.budgetMax === "number" && item.budget > input.budgetMax) {
      return false;
    }

    if (item.matchScore < input.minMatchScore) return false;

    return true;
  });

  return { items: filtered, fields };
}

function sortItems(
  items: LivePackageItem[],
  sortBy: SortBy,
  sortOrder: SortOrder,
) {
  const direction = sortOrder === "asc" ? 1 : -1;

  return [...items].sort((a, b) => {
    if (sortBy === "publishedAt") {
      return (
        (new Date(a.publishedAt).getTime() -
          new Date(b.publishedAt).getTime()) *
        direction
      );
    }

    if (sortBy === "budget") {
      return (a.budget - b.budget) * direction;
    }

    if (sortBy === "matchScore") {
      return (a.matchScore - b.matchScore) * direction;
    }

    if (sortBy === "title") {
      return a.title.localeCompare(b.title, "vi") * direction;
    }

    return a.inviter.localeCompare(b.inviter, "vi") * direction;
  });
}

function buildOptions(items: LivePackageItem[]) {
  const dynamicProvinces = new Set(
    items.map((item) => item.province).filter(Boolean),
  );
  const dynamicCategories = new Set(
    items.map((item) => item.category).filter(Boolean),
  );
  const dynamicKeywords = extractDynamicKeywords(items);

  const provinces = Array.from(
    new Set([...PROVINCE_OPTIONS, ...dynamicProvinces]),
  ).sort((a, b) => a.localeCompare(b, "vi"));
  const categories = Array.from(
    new Set([...CATEGORY_OPTIONS, ...dynamicCategories]),
  ).sort((a, b) => a.localeCompare(b, "vi"));
  const keywords = Array.from(
    new Set([...KEYWORD_OPTIONS, ...dynamicKeywords]),
  ).sort((a, b) => a.localeCompare(b, "vi"));

  return { provinces, categories, keywords };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summarizeHtmlFailure(html: string): string {
  const normalized = html.replace(/\s+/g, " ").trim().slice(0, 220);

  if (/just a moment/i.test(html)) {
    return "Cloudflare challenge";
  }

  if (/attention required/i.test(html)) {
    return "Cloudflare access page";
  }

  if (/captcha/i.test(html)) {
    return "captcha challenge";
  }

  if (/access denied/i.test(html)) {
    return "access denied";
  }

  if (/login/i.test(html) && /bidwinner/i.test(html)) {
    return "unexpected login page";
  }

  if (!normalized) {
    return "empty HTML response";
  }

  return `unexpected HTML: ${normalized}`;
}

async function fetchBidWinnerPage(
  page: number,
  provinceCodes: string[] = [],
): Promise<string> {
  const url = new URL("/4.0/tim-kiem-goi-thau", env.BIDWINNER_BASE_URL);
  url.searchParams.set("page", String(page));
  for (const code of provinceCodes) {
    url.searchParams.append("matp", code);
  }

  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      env.BIDWINNER_TIMEOUT_MS + (attempt - 1) * 5_000,
    );

    try {
      const response = await fetch(url, {
        headers: DEFAULT_HEADERS,
        signal: controller.signal,
        cache: "no-store",
        redirect: "follow",
      });
      const html = await response.text();

      if (!response.ok) {
        throw new Error(`BidWinner trả về mã lỗi ${response.status}.`);
      }

      if (!SEARCH_PAYLOAD_REGEX.test(html)) {
        throw new Error(
          `BidWinner trả về HTML không chứa payload tìm kiếm (${summarizeHtmlFailure(html)}).`,
        );
      }

      return html;
    } catch (error) {
      lastError = error;

      if (attempt < MAX_FETCH_ATTEMPTS) {
        await sleep(attempt * 500);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  const message =
    lastError instanceof Error
      ? lastError.message
      : "Lỗi không xác định khi gọi BidWinner.";
  throw new Error(
    `Không thể lấy dữ liệu BidWinner cho page=${page} sau ${MAX_FETCH_ATTEMPTS} lần thử. ${message}`,
  );
}

export async function searchBidWinnerLive(
  input: SearchOptions,
): Promise<LiveSearchResult> {
  // Sort is downgraded to publishedAt at the API boundary; only sortOrder is honored.
  const sortBy: SortBy = "publishedAt";

  // Compute the remote page window required for the requested local offset/limit
  // against BidWinner's fixed per_page=20.
  const limit = Math.max(input.limit, 1);
  const startRemotePage =
    Math.floor(input.offset / BIDWINNER_PER_PAGE) + 1;
  const endRemotePage =
    Math.floor((input.offset + limit - 1) / BIDWINNER_PER_PAGE) + 1;
  const pageNumbers: number[] = [];
  for (let p = startRemotePage; p <= endRemotePage; p += 1) {
    pageNumbers.push(p);
  }

  // Resolve province → matp using cached map first; fetch page 1 once if needed.
  let provinceCodeMap = cachedProvinceCodeMap ?? new Map<string, string>();
  if (provinceCodeMap.size === 0 && input.provinces.length > 0) {
    try {
      const html = await fetchBidWinnerPage(1, []);
      provinceCodeMap = parseProvincePayload(html);
      rememberProvinceCodeMap(provinceCodeMap);
    } catch {
      // ignore; we'll fall back below
    }
  }

  const provinceCodes = resolveProvinceCodes(input.provinces, provinceCodeMap);

  const htmlPages = await Promise.all(
    pageNumbers.map((page) => fetchBidWinnerPage(page, provinceCodes)),
  );

  let sourceTotal = 0;
  let sourcePerPage = BIDWINNER_PER_PAGE;
  const fetchedItems: LivePackageItem[] = [];
  const seen = new Set<string>();

  for (const html of htmlPages) {
    const payload = parseBidSearchPayload(html);
    if (typeof payload.total === "number" && payload.total >= 0) {
      sourceTotal = payload.total;
    }
    if (typeof payload.per_page === "number" && payload.per_page > 0) {
      sourcePerPage = payload.per_page;
    }

    // Refresh province code map opportunistically.
    if (provinceCodeMap.size === 0) {
      const ttp = parseProvincePayload(html);
      if (ttp.size > 0) {
        provinceCodeMap = ttp;
        rememberProvinceCodeMap(ttp);
      }
    }

    const mapped = payload.data
      .map((item) => toLivePackageItem(item))
      .filter((item): item is LivePackageItem => item !== null);

    for (const item of mapped) {
      if (seen.has(item.externalId)) continue;
      seen.add(item.externalId);
      fetchedItems.push(item);
    }
  }

  // Window: local offset within the fetched span.
  const spanStart = (startRemotePage - 1) * sourcePerPage;
  const localStart = Math.max(0, input.offset - spanStart);
  const windowItems = fetchedItems.slice(localStart, localStart + limit);

  const { items: refined, fields } = applyLocalRefinement(windowItems, input);
  const sorted = sortItems(refined, sortBy, input.sortOrder);

  return {
    items: sorted,
    total: sourceTotal,
    visibleCount: sorted.length,
    offset: input.offset,
    limit: input.limit,
    source: "bidwinner_live",
    fetchedAt: new Date().toISOString(),
    localRefinement: {
      active: fields.length > 0,
      fields,
    },
    options: buildOptions(fetchedItems),
  };
}
