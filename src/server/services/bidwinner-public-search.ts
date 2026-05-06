import {
  CATEGORY_OPTIONS,
  KEYWORD_OPTIONS,
  PROVINCE_OPTIONS,
  type SortOrder,
} from "~/constants/search-options";
import { env } from "~/env";
import {
  normalizeSearchCriteria,
  type SearchCriteria,
} from "~/lib/search-criteria";
import {
  SEARCH_MODE_LABELS,
  type SearchMode,
} from "~/lib/search-modes";
import { canonicalizeProvinceLabel, normalizeProvinceKey } from "~/lib/search-filter-utils";
import {
  searchBidWinnerLive,
  type LivePackageItem,
} from "~/server/services/bidwinner-search";

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

const MAX_FETCH_ATTEMPTS = 3;
const BIDWINNER_PER_PAGE = 20;

type SourceMetaField =
  | "keyword"
  | "provinces"
  | "packageCategories"
  | "classifyIds"
  | "budget"
  | "publishedAt"
  | "minMatchScore"
  | "planFields"
  | "procurementMethods"
  | "projectGroups";

type PublicPagePayload<T> = {
  current_page?: number;
  per_page?: number;
  last_page?: number;
  total?: number;
  data: T[];
};

type ProvincePayloadEntry = {
  matp?: string | number;
  name?: string;
  ten_tinh?: string;
  ten?: string;
};

type ClassifyPayloadEntry = {
  id?: number;
  parent_id?: number;
  name?: string;
  sub_name?: string | null;
  exclude_name?: string | null;
};

type BidWinnerPlanRawItem = {
  id?: number;
  so_tbmt?: string | number | null;
  thoi_diem_dang_tai?: string;
  tg_tc_lcnt?: string | null;
  ten_goi_thau?: string | null;
  ten_khlcnt?: string | null;
  owner?: string | null;
  bmt?: string | null;
  dt_goi_thau?: number | null;
  linh_vuc?: number | null;
  ht_lcnt?: string | null;
  matp?: string | null;
  city?: string | null;
  ttp_thuc_hien?: string | null;
  dd_thuc_hien?: string | null;
};

type BidWinnerProjectRawItem = {
  id?: number;
  so_tbmt?: string | number | null;
  thoi_diem_dang_tai?: string;
  ten_du_an?: string | null;
  nhom_du_an?: string | null;
  tong_muc_dau_tu?: number | null;
  ngay_phe_duyet?: string | null;
  so_hieu_phe_duyet?: string | null;
  matp?: string | null;
  city?: string | null;
  name?: string | null;
};

type BidWinnerProjectPlanRawItem = {
  id?: number;
  project_id?: number;
  ten_khlcnt?: string | null;
};

export type SearchModeClassifyOption = {
  id: number;
  parentId: number;
  name: string;
  pathLabel: string;
  depth: number;
  excludeName: string;
};

export type PackageSearchResultItem = LivePackageItem & {
  entityType: "package";
};

export type PlanSearchResultItem = {
  entityType: "plan";
  externalId: string;
  noticeNumber: string;
  title: string;
  planName: string;
  owner: string;
  province: string;
  field: string;
  procurementMethod: string;
  budget: number;
  publishedAt: string;
  timeline: string | null;
  sourceUrl: string;
};

export type ProjectPlanLink = {
  externalId: string;
  title: string;
  sourceUrl: string;
};

export type ProjectSearchResultItem = {
  entityType: "project";
  externalId: string;
  noticeNumber: string;
  title: string;
  owner: string;
  province: string;
  projectGroup: string;
  budget: number;
  publishedAt: string;
  approvedAt: string | null;
  approvalNumber: string | null;
  relatedPlans: ProjectPlanLink[];
  relatedPlanCount: number;
  sourceUrl: string;
};

export type SearchResultItem =
  | PackageSearchResultItem
  | PlanSearchResultItem
  | ProjectSearchResultItem;

export type SearchModeOptions = {
  provinces: string[];
  keywords: string[];
  packageCategories: string[];
  planFields: string[];
  procurementMethods: string[];
  projectGroups: string[];
  classifies: SearchModeClassifyOption[];
};

export type SearchSourceMeta = {
  modeLabel: string;
  pageUrl: string;
  exactFields: SourceMetaField[];
  localOnlyFields: SourceMetaField[];
  notices: string[];
};

export type UnifiedSearchResult = {
  mode: SearchMode;
  items: SearchResultItem[];
  total: number;
  visibleCount: number;
  offset: number;
  limit: number;
  windowBudgetRange: {
    min: number;
    max: number;
  };
  source: "bidwinner_public";
  fetchedAt: string;
  warning?: string;
  localRefinement: {
    active: boolean;
    fields: SourceMetaField[];
  };
  options: SearchModeOptions;
  sourceMeta: SearchSourceMeta;
};

type ProvinceMap = Map<string, string>;

function normalizeText(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function parseBidWinnerTimestamp(value: string): number {
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const parsed = new Date(normalized).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function parseBidWinnerDateKey(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  if (match?.[1]) {
    return match[1];
  }

  return null;
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

function readJsonAttr<T>(html: string, attrName: string): T {
  const regex = new RegExp(`${attrName}="([^"]+)"`);
  const match = regex.exec(html);
  if (!match?.[1]) {
    throw new Error(`Không tìm thấy payload ${attrName} trong HTML BidWinner.`);
  }

  return JSON.parse(decodeHtmlEntities(match[1])) as T;
}

function inferCategory(title: string): string {
  const text = normalizeText(title);

  if (/(benh vien|y te|thuoc|xet nghiem|hoa chat y)/.test(text)) {
    return "Y tế";
  }
  if (
    /(phan mem|may tinh|mang|cntt|vien thong|an ninh mang)/.test(text)
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

function toBudgetRange(items: SearchResultItem[]) {
  const values = items
    .map((item) => item.budget)
    .filter((value) => Number.isFinite(value) && value >= 0);

  if (values.length === 0) {
    return {
      min: 0,
      max: 0,
    };
  }

  return {
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

function summarizeHtmlFailure(html: string): string {
  const normalized = html.replace(/\s+/g, " ").trim().slice(0, 220);

  if (/just a moment/i.test(html)) {
    return "Cloudflare challenge";
  }

  if (!normalized) {
    return "empty HTML response";
  }

  return `unexpected HTML: ${normalized}`;
}

async function fetchBidWinnerHtml(
  pathname: string,
  params: URLSearchParams,
): Promise<string> {
  const url = new URL(pathname, env.BIDWINNER_BASE_URL);
  params.forEach((value, key) => {
    url.searchParams.set(key, value);
  });

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

      if (!/<body/i.test(html)) {
        throw new Error(
          `BidWinner trả về HTML không hợp lệ (${summarizeHtmlFailure(html)}).`,
        );
      }

      return html;
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
  }

  const message =
    lastError instanceof Error
      ? lastError.message
      : "Lỗi không xác định khi gọi BidWinner.";

  throw new Error(
    `Không thể lấy dữ liệu BidWinner cho ${pathname} sau ${MAX_FETCH_ATTEMPTS} lần thử. ${message}`,
  );
}

function parseProvincePayload(html: string): ProvinceMap {
  const map = new Map<string, string>();
  const entries = readJsonAttr<ProvincePayloadEntry[] | { data?: ProvincePayloadEntry[] }>(
    html,
    ":ttp",
  );
  const list = Array.isArray(entries)
    ? entries
    : Array.isArray(entries.data)
      ? entries.data
      : [];

  for (const entry of list) {
    const code =
      entry.matp !== undefined && entry.matp !== null
        ? String(entry.matp).trim()
        : "";
    const name = entry.ten_tinh ?? entry.name ?? entry.ten ?? "";
    const canonical = canonicalizeProvinceLabel(name) ?? name.trim();

    if (code && canonical) {
      map.set(String(code).trim(), canonical);
      map.set(normalizeProvinceKey(canonical), canonical);
    }
  }

  return map;
}

function resolveProvinceLabel(raw: {
  city?: string | null;
  matp?: string | null;
  altCode?: string | null;
  locationText?: string | null;
}, provinceMap: ProvinceMap): string {
  const cityText = raw.city?.trim();
  const cityLabel = cityText
    ? canonicalizeProvinceLabel(cityText) ?? cityText
    : null;
  if (cityLabel) {
    return cityLabel;
  }

  const directCode = raw.matp?.trim();
  if (directCode) {
    const fromCode = provinceMap.get(directCode);
    if (fromCode) {
      return fromCode;
    }
  }

  const altCode = raw.altCode?.trim();
  if (altCode) {
    const fromCode = provinceMap.get(altCode);
    if (fromCode) {
      return fromCode;
    }
  }

  const locationText = raw.locationText?.trim() ?? "";
  if (locationText) {
    for (const province of PROVINCE_OPTIONS) {
      if (normalizeText(locationText).includes(normalizeProvinceKey(province))) {
        return province;
      }
    }
  }

  return "Chưa xác định";
}

function buildPackageItem(item: LivePackageItem): PackageSearchResultItem {
  return {
    ...item,
    entityType: "package",
  };
}

function humanizeProcurementMethod(value?: string | null): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return "Chưa xác định";
  }

  const map: Record<string, string> = {
    dau_thau_rong_rai: "Đấu thầu rộng rãi",
    chao_hang_canh_tranh: "Chào hàng cạnh tranh",
    chi_dinh_thau: "Chỉ định thầu",
    tu_thuc_hien: "Tự thực hiện",
    mua_sam_truc_tiep: "Mua sắm trực tiếp",
    lua_chon_nha_thau_trong_truong_hop_dac_biet:
      "Trường hợp đặc biệt",
  };

  return (
    map[trimmed] ??
    trimmed
      .split("_")
      .filter(Boolean)
      .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
      .join(" ")
  );
}

function buildPlanSourceUrl(externalId: string): string {
  return new URL(
    `/4.0/ke-hoach-lua-chon-nha-thau/${encodeURIComponent(externalId)}`,
    env.BIDWINNER_BASE_URL,
  ).toString();
}

function buildProjectSourceUrl(externalId: string): string {
  return new URL(
    `/4.0/du-an-dau-tu-phat-trien/${encodeURIComponent(externalId)}`,
    env.BIDWINNER_BASE_URL,
  ).toString();
}

function toPlanItem(
  raw: BidWinnerPlanRawItem,
  provinceMap: ProvinceMap,
): PlanSearchResultItem | null {
  if (!raw.id) {
    return null;
  }

  const titleText = raw.ten_khlcnt?.trim();
  const fallbackTitle = raw.ten_goi_thau?.trim();
  const title =
    titleText && titleText.length > 0
      ? titleText
      : fallbackTitle && fallbackTitle.length > 0
        ? fallbackTitle
        : "";
  if (!title) {
    return null;
  }

  const ownerText = raw.owner?.trim();
  const inviterText = raw.bmt?.trim();
  const timelineText = raw.tg_tc_lcnt?.trim();
  const budgetValue = Number(raw.dt_goi_thau ?? 0);

  return {
    entityType: "plan",
    externalId: String(raw.id),
    noticeNumber: String(raw.so_tbmt ?? raw.id),
    title,
    planName:
      fallbackTitle && fallbackTitle.length > 0 ? fallbackTitle : title,
    owner:
      ownerText && ownerText.length > 0
        ? ownerText
        : inviterText && inviterText.length > 0
          ? inviterText
          : "Chưa xác định",
    province: resolveProvinceLabel(
      {
        city: raw.city,
        matp: raw.matp,
        altCode: raw.ttp_thuc_hien,
        locationText: raw.dd_thuc_hien,
      },
      provinceMap,
    ),
    field: inferCategory(`${title} ${raw.ten_goi_thau ?? ""}`),
    procurementMethod: humanizeProcurementMethod(raw.ht_lcnt),
    budget: Number.isFinite(budgetValue) ? budgetValue : 0,
    publishedAt: raw.thoi_diem_dang_tai ?? new Date().toISOString(),
    timeline: timelineText && timelineText.length > 0 ? timelineText : null,
    sourceUrl: buildPlanSourceUrl(String(raw.id)),
  };
}

function toProjectPlanLink(raw: BidWinnerProjectPlanRawItem): ProjectPlanLink | null {
  if (!raw.id) {
    return null;
  }

  const titleText = raw.ten_khlcnt?.trim();
  const title =
    titleText && titleText.length > 0 ? titleText : `KHLCNT ${raw.id}`;
  return {
    externalId: String(raw.id),
    title,
    sourceUrl: buildPlanSourceUrl(String(raw.id)),
  };
}

function toProjectItem(
  raw: BidWinnerProjectRawItem,
  relatedPlans: ProjectPlanLink[],
  provinceMap: ProvinceMap,
): ProjectSearchResultItem | null {
  if (!raw.id) {
    return null;
  }

  const title = raw.ten_du_an?.trim() ?? "";
  if (!title) {
    return null;
  }

  const ownerText = raw.name?.trim();
  const projectGroupText = raw.nhom_du_an?.trim();
  const approvedAtText = raw.ngay_phe_duyet?.trim();
  const approvalNumberText = raw.so_hieu_phe_duyet?.trim();
  const budgetValue = Number(raw.tong_muc_dau_tu ?? 0);

  return {
    entityType: "project",
    externalId: String(raw.id),
    noticeNumber: String(raw.so_tbmt ?? raw.id),
    title,
    owner: ownerText && ownerText.length > 0 ? ownerText : "Chưa xác định",
    province: resolveProvinceLabel(
      {
        city: raw.city,
        matp: raw.matp,
      },
      provinceMap,
    ),
    projectGroup:
      projectGroupText && projectGroupText.length > 0
        ? projectGroupText
        : "Chưa xác định",
    budget: Number.isFinite(budgetValue) ? budgetValue : 0,
    publishedAt: raw.thoi_diem_dang_tai ?? new Date().toISOString(),
    approvedAt:
      approvedAtText && approvedAtText.length > 0 ? approvedAtText : null,
    approvalNumber:
      approvalNumberText && approvalNumberText.length > 0
        ? approvalNumberText
        : null,
    relatedPlans,
    relatedPlanCount: relatedPlans.length,
    sourceUrl: buildProjectSourceUrl(String(raw.id)),
  };
}

function sortByPublishedAt<T extends { publishedAt: string }>(
  items: T[],
  sortOrder: SortOrder,
) {
  const direction = sortOrder === "asc" ? 1 : -1;

  return [...items].sort((a, b) => {
    return (
      (parseBidWinnerTimestamp(a.publishedAt) -
        parseBidWinnerTimestamp(b.publishedAt)) * direction
    );
  });
}

function matchesKeyword(keyword: string, haystack: string): boolean {
  if (!keyword.trim()) {
    return true;
  }

  const terms = keyword
    .split(",")
    .map((term) => normalizeText(term))
    .filter(Boolean);

  if (terms.length === 0) {
    return true;
  }

  const normalized = normalizeText(haystack);
  return terms.some((term) => normalized.includes(term));
}

function matchesProvince(provinces: string[], value: string): boolean {
  if (provinces.length === 0) {
    return true;
  }

  const normalizedValue = normalizeProvinceKey(value);
  return provinces.some(
    (province) => normalizeProvinceKey(province) === normalizedValue,
  );
}

function matchesDateRange(
  value: string,
  publishedFrom: string,
  publishedTo: string,
): boolean {
  const key = parseBidWinnerDateKey(value);
  if (!key) {
    return false;
  }

  if (publishedFrom && key < publishedFrom) {
    return false;
  }

  if (publishedTo && key > publishedTo) {
    return false;
  }

  return true;
}

function buildSearchOptions(items: SearchResultItem[], classifies: SearchModeClassifyOption[] = []): SearchModeOptions {
  const dynamicKeywords = Array.from(
    new Set(
      items
        .flatMap((item) =>
          normalizeText(
            item.entityType === "package"
              ? `${item.title} ${item.inviter}`
              : item.entityType === "plan"
                ? `${item.title} ${item.owner} ${item.planName}`
                : `${item.title} ${item.owner}`,
          )
            .split(/[^\p{L}\p{N}]+/u)
            .filter((token) => token.length >= 4),
        )
        .slice(0, 40),
    ),
  ).sort((a, b) => a.localeCompare(b, "vi"));

  const planFields = Array.from(
    new Set(
      items
        .filter((item): item is PlanSearchResultItem => item.entityType === "plan")
        .map((item) => item.field)
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b, "vi"));

  const procurementMethods = Array.from(
    new Set(
      items
        .filter((item): item is PlanSearchResultItem => item.entityType === "plan")
        .map((item) => item.procurementMethod)
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b, "vi"));

  const projectGroups = Array.from(
    new Set(
      items
        .filter(
          (item): item is ProjectSearchResultItem => item.entityType === "project",
        )
        .map((item) => item.projectGroup)
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b, "vi"));

  return {
    provinces: [...PROVINCE_OPTIONS],
    keywords: Array.from(
      new Set([...KEYWORD_OPTIONS, ...dynamicKeywords]),
    ).sort((a, b) => a.localeCompare(b, "vi")),
    packageCategories: [...CATEGORY_OPTIONS],
    planFields,
    procurementMethods,
    projectGroups,
    classifies,
  };
}

let cachedClassifyOptions: SearchModeClassifyOption[] | null = null;

async function getClassifyOptions(): Promise<SearchModeClassifyOption[]> {
  if (cachedClassifyOptions) {
    return cachedClassifyOptions;
  }

  const html = await fetchBidWinnerHtml(
    "/4.0/goi-thau-theo-linh-vuc-dia-phuong",
    new URLSearchParams(),
  );
  const entries = readJsonAttr<ClassifyPayloadEntry[]>(
    html,
    ":classifies",
  );
  const byParent = new Map<number, ClassifyPayloadEntry[]>();

  for (const entry of entries) {
    const parentId = entry.parent_id ?? 0;
    const group = byParent.get(parentId) ?? [];
    group.push(entry);
    byParent.set(parentId, group);
  }

  const flattened: SearchModeClassifyOption[] = [];

  function visit(parentId: number, path: string[], depth: number) {
    const group = (byParent.get(parentId) ?? []).sort((a, b) =>
      (a.name ?? "").localeCompare(b.name ?? "", "vi"),
    );

    for (const entry of group) {
      const id = entry.id ?? 0;
      const name = entry.name?.trim() ?? "";
      if (!id || !name) {
        continue;
      }

      const nextPath = [...path, name];
      flattened.push({
        id,
        parentId: entry.parent_id ?? 0,
        name,
        pathLabel: nextPath.join(" / "),
        depth,
        excludeName: entry.exclude_name?.trim() ?? "",
      });

      visit(id, nextPath, depth + 1);
    }
  }

  visit(0, [], 0);
  cachedClassifyOptions = flattened;
  return flattened;
}

function matchesClassifyIds(
  item: PackageSearchResultItem,
  classifyIds: number[],
  classifies: SearchModeClassifyOption[],
): boolean {
  if (classifyIds.length === 0) {
    return true;
  }

  const haystack = normalizeText(`${item.title} ${item.category}`);
  const selected = classifies.filter((entry) => classifyIds.includes(entry.id));

  return selected.some((entry) => {
    const normalizedPath = normalizeText(entry.pathLabel);
    if (normalizedPath && haystack.includes(normalizedPath)) {
      return true;
    }

    const nameTokens = normalizeText(entry.name)
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length >= 4);

    return nameTokens.some((token) => haystack.includes(token));
  });
}

async function searchPackageModes(input: {
  mode: SearchMode;
  criteria: SearchCriteria;
  offset: number;
  limit: number;
  sortOrder: SortOrder;
}): Promise<UnifiedSearchResult> {
  const criteria = normalizeSearchCriteria(input.criteria);
  const classifies =
    input.mode === "package_area_location" ? await getClassifyOptions() : [];
  const selectedProvince =
    input.mode === "package_location" && criteria.provinces.length > 0
      ? [criteria.provinces[0] ?? ""]
      : input.mode === "package_area_location"
        ? []
        : criteria.provinces;

  const packageResult = await searchBidWinnerLive({
    keyword: criteria.keyword,
    provinces: selectedProvince,
    categories: criteria.packageCategories,
    budgetMin: criteria.budgetMin ?? undefined,
    budgetMax: criteria.budgetMax ?? undefined,
    publishedFrom: criteria.publishedFrom ? criteria.publishedFrom : undefined,
    publishedTo: criteria.publishedTo ? criteria.publishedTo : undefined,
    minMatchScore: criteria.minMatchScore,
    sortBy: "publishedAt",
    sortOrder: input.sortOrder,
    offset: input.offset,
    limit: input.limit,
  });

  let items = packageResult.items.map(buildPackageItem);
  const extraLocalFields: SourceMetaField[] = [];
  const notices: string[] = [];
  let warning = packageResult.warning;

  if (input.mode === "package_location" && criteria.provinces.length > 1) {
    warning =
      "Chế độ Theo địa phương chỉ chạy chính xác với một tỉnh/thành tại một thời điểm. Hệ thống đang dùng tỉnh đầu tiên trong danh sách đã chọn.";
  }

  if (input.mode === "package_area_location") {
    if (criteria.provinces.length > 0) {
      items = items.filter((item) =>
        matchesProvince(criteria.provinces, item.province),
      );
      extraLocalFields.push("provinces");
    }

    if (criteria.classifyIds.length > 0) {
      items = items.filter((item) =>
        matchesClassifyIds(item, criteria.classifyIds, classifies),
      );
      extraLocalFields.push("classifyIds");
    }

    notices.push(
      "BidWinner public chỉ công khai taxonomy ngành nghề, không công khai endpoint kết quả tương ứng. Bộ lọc tỉnh và ngành nghề ở tab này đang tinh lọc trên cửa sổ dữ liệu package public hiện tại.",
    );
  }

  const localFields = Array.from(
    new Set([
      ...packageResult.localRefinement.fields.map((field) => {
        const mapping: Record<string, SourceMetaField> = {
          keyword: "keyword",
          categories: "packageCategories",
          budget: "budget",
          publishedAt: "publishedAt",
          minMatchScore: "minMatchScore",
        };
        return mapping[field] ?? "keyword";
      }),
      ...extraLocalFields,
    ]),
  );

  const exactFields: SourceMetaField[] =
    input.mode === "package_area_location"
      ? []
      : criteria.provinces.length > 0
        ? ["provinces"]
        : [];

  return {
    mode: input.mode,
    items,
    total: packageResult.total,
    visibleCount: items.length,
    offset: input.offset,
    limit: input.limit,
    windowBudgetRange: toBudgetRange(items),
    source: "bidwinner_public",
    fetchedAt: packageResult.fetchedAt,
    warning,
    localRefinement: {
      active: localFields.length > 0,
      fields: localFields,
    },
    options: buildSearchOptions(items, classifies),
    sourceMeta: {
      modeLabel: SEARCH_MODE_LABELS[input.mode],
      pageUrl:
        input.mode === "package_area_location"
          ? new URL(
              "/4.0/goi-thau-theo-linh-vuc-dia-phuong",
              env.BIDWINNER_BASE_URL,
            ).toString()
          : new URL("/4.0/tim-kiem-goi-thau", env.BIDWINNER_BASE_URL).toString(),
      exactFields,
      localOnlyFields: localFields,
      notices,
    },
  };
}

async function fetchPlanPage(page: number) {
  const html = await fetchBidWinnerHtml(
    "/4.0/tim-kiem-khlcnt",
    new URLSearchParams({ page: String(page) }),
  );
  const payload = readJsonAttr<PublicPagePayload<BidWinnerPlanRawItem>>(
    html,
    ":hsmts",
  );
  const provinceMap = parseProvincePayload(html);
  const items = payload.data
    .map((item) => toPlanItem(item, provinceMap))
    .filter((item): item is PlanSearchResultItem => item !== null);

  return {
    payload,
    provinceMap,
    items,
  };
}

async function fetchProjectPage(page: number) {
  const html = await fetchBidWinnerHtml(
    "/4.0/du-an-dau-tu-phat-trien",
    new URLSearchParams({ page: String(page) }),
  );
  const payload = readJsonAttr<PublicPagePayload<BidWinnerProjectRawItem>>(
    html,
    ":projects",
  );
  const relatedPlanRaw = readJsonAttr<BidWinnerProjectPlanRawItem[]>(
    html,
    ":khlcnts",
  );
  const provinceMap = parseProvincePayload(html);
  const relatedByProjectId = new Map<number, ProjectPlanLink[]>();

  for (const row of relatedPlanRaw) {
    const projectId = row.project_id ?? 0;
    const link = toProjectPlanLink(row);
    if (!projectId || !link) {
      continue;
    }

    const group = relatedByProjectId.get(projectId) ?? [];
    group.push(link);
    relatedByProjectId.set(projectId, group);
  }

  const items = payload.data
    .map((item) =>
      toProjectItem(item, relatedByProjectId.get(item.id ?? 0) ?? [], provinceMap),
    )
    .filter((item): item is ProjectSearchResultItem => item !== null);

  return {
    payload,
    provinceMap,
    items,
  };
}

async function fetchWindowItems<T>(options: {
  offset: number;
  limit: number;
  fetchPage: (page: number) => Promise<{
    payload: PublicPagePayload<unknown>;
    items: T[];
  }>;
}) {
  const startRemotePage = Math.floor(options.offset / BIDWINNER_PER_PAGE) + 1;
  const endRemotePage =
    Math.floor((options.offset + options.limit - 1) / BIDWINNER_PER_PAGE) + 1;
  const pageNumbers: number[] = [];

  for (let page = startRemotePage; page <= endRemotePage; page += 1) {
    pageNumbers.push(page);
  }

  const pages = await Promise.all(pageNumbers.map((page) => options.fetchPage(page)));
  const allItems = pages.flatMap((page) => page.items);
  const sourceTotal = pages[0]?.payload.total ?? 0;
  const perPage = pages[0]?.payload.per_page ?? BIDWINNER_PER_PAGE;
  const localStart = Math.max(0, options.offset - (startRemotePage - 1) * perPage);

  return {
    sourceTotal,
    allItems,
    items: allItems.slice(localStart, localStart + options.limit),
  };
}

async function searchPlanMode(input: {
  criteria: SearchCriteria;
  offset: number;
  limit: number;
  sortOrder: SortOrder;
}): Promise<UnifiedSearchResult> {
  const criteria = normalizeSearchCriteria(input.criteria);
  const window = await fetchWindowItems({
    offset: input.offset,
    limit: input.limit,
    fetchPage: fetchPlanPage,
  });

  const localFields = Array.from(
    new Set<SourceMetaField>([
      ...(criteria.keyword ? (["keyword"] as const) : []),
      ...(criteria.provinces.length > 0 ? (["provinces"] as const) : []),
      ...(criteria.planFields.length > 0 ? (["planFields"] as const) : []),
      ...(criteria.procurementMethods.length > 0
        ? (["procurementMethods"] as const)
        : []),
      ...(criteria.budgetMin !== null || criteria.budgetMax !== null
        ? (["budget"] as const)
        : []),
      ...(criteria.publishedFrom || criteria.publishedTo
        ? (["publishedAt"] as const)
        : []),
    ]),
  );
  let items = window.items.filter((item) => {
    if (!matchesKeyword(criteria.keyword, `${item.title} ${item.owner}`)) {
      return false;
    }

    if (
      criteria.planFields.length > 0 &&
      !criteria.planFields.includes(item.field)
    ) {
      return false;
    }

    if (
      criteria.procurementMethods.length > 0 &&
      !criteria.procurementMethods.includes(item.procurementMethod)
    ) {
      return false;
    }

    if (!matchesProvince(criteria.provinces, item.province)) {
      return false;
    }

    if (criteria.budgetMin !== null && item.budget < criteria.budgetMin) {
      return false;
    }

    if (criteria.budgetMax !== null && item.budget > criteria.budgetMax) {
      return false;
    }

    if (
      (criteria.publishedFrom || criteria.publishedTo) &&
      !matchesDateRange(item.publishedAt, criteria.publishedFrom, criteria.publishedTo)
    ) {
      return false;
    }

    return true;
  });

  items = sortByPublishedAt(items, input.sortOrder);

  return {
    mode: "plan",
    items,
    total: window.sourceTotal,
    visibleCount: items.length,
    offset: input.offset,
    limit: input.limit,
    windowBudgetRange: toBudgetRange(items),
    source: "bidwinner_public",
    fetchedAt: new Date().toISOString(),
    localRefinement: {
      active: localFields.length > 0,
      fields: localFields,
    },
    options: buildSearchOptions(window.allItems as SearchResultItem[]),
    sourceMeta: {
      modeLabel: SEARCH_MODE_LABELS.plan,
      pageUrl: new URL("/4.0/tim-kiem-khlcnt", env.BIDWINNER_BASE_URL).toString(),
      exactFields: [],
      localOnlyFields: localFields,
      notices: [
        "Tổng số và phân trang lấy đúng từ trang KHLCNT public. Các bộ lọc từ khóa, tỉnh, lĩnh vực, HTLCNT, ngày và ngân sách đang tinh lọc trong cửa sổ nguồn đã tải.",
      ],
    },
  };
}

async function searchProjectMode(input: {
  criteria: SearchCriteria;
  offset: number;
  limit: number;
  sortOrder: SortOrder;
}): Promise<UnifiedSearchResult> {
  const criteria = normalizeSearchCriteria(input.criteria);
  const window = await fetchWindowItems({
    offset: input.offset,
    limit: input.limit,
    fetchPage: fetchProjectPage,
  });

  const localFields = Array.from(
    new Set<SourceMetaField>([
      ...(criteria.keyword ? (["keyword"] as const) : []),
      ...(criteria.provinces.length > 0 ? (["provinces"] as const) : []),
      ...(criteria.projectGroups.length > 0
        ? (["projectGroups"] as const)
        : []),
      ...(criteria.budgetMin !== null || criteria.budgetMax !== null
        ? (["budget"] as const)
        : []),
      ...(criteria.publishedFrom || criteria.publishedTo
        ? (["publishedAt"] as const)
        : []),
    ]),
  );
  let items = window.items.filter((item) => {
    if (!matchesKeyword(criteria.keyword, `${item.title} ${item.owner}`)) {
      return false;
    }

    if (
      criteria.projectGroups.length > 0 &&
      !criteria.projectGroups.includes(item.projectGroup)
    ) {
      return false;
    }

    if (!matchesProvince(criteria.provinces, item.province)) {
      return false;
    }

    if (criteria.budgetMin !== null && item.budget < criteria.budgetMin) {
      return false;
    }

    if (criteria.budgetMax !== null && item.budget > criteria.budgetMax) {
      return false;
    }

    const dateValue = item.approvedAt ?? item.publishedAt;
    if (
      (criteria.publishedFrom || criteria.publishedTo) &&
      !matchesDateRange(dateValue, criteria.publishedFrom, criteria.publishedTo)
    ) {
      return false;
    }

    return true;
  });

  items = sortByPublishedAt(items, input.sortOrder);

  return {
    mode: "project",
    items,
    total: window.sourceTotal,
    visibleCount: items.length,
    offset: input.offset,
    limit: input.limit,
    windowBudgetRange: toBudgetRange(items),
    source: "bidwinner_public",
    fetchedAt: new Date().toISOString(),
    localRefinement: {
      active: localFields.length > 0,
      fields: localFields,
    },
    options: buildSearchOptions(window.allItems as SearchResultItem[]),
    sourceMeta: {
      modeLabel: SEARCH_MODE_LABELS.project,
      pageUrl: new URL(
        "/4.0/du-an-dau-tu-phat-trien",
        env.BIDWINNER_BASE_URL,
      ).toString(),
      exactFields: [],
      localOnlyFields: localFields,
      notices: [
        "Tổng số và phân trang lấy đúng từ trang Dự án public. Các bộ lọc từ khóa, tỉnh, nhóm dự án, ngày và tổng mức đầu tư đang tinh lọc trong cửa sổ nguồn đã tải.",
      ],
    },
  };
}

export async function queryBidWinnerPublicSearch(input: {
  mode: SearchMode;
  criteria: SearchCriteria;
  offset: number;
  limit: number;
  sortOrder: SortOrder;
}): Promise<UnifiedSearchResult> {
  const criteria = normalizeSearchCriteria(input.criteria);

  if (
    input.mode === "package_keyword" ||
    input.mode === "package_location" ||
    input.mode === "package_area_location"
  ) {
    return searchPackageModes({
      mode: input.mode,
      criteria,
      offset: input.offset,
      limit: input.limit,
      sortOrder: input.sortOrder,
    });
  }

  if (input.mode === "plan") {
    return searchPlanMode({
      criteria,
      offset: input.offset,
      limit: input.limit,
      sortOrder: input.sortOrder,
    });
  }

  return searchProjectMode({
    criteria,
    offset: input.offset,
    limit: input.limit,
    sortOrder: input.sortOrder,
  });
}
