// Conservative normalization for scraped NCC (manufacturer) and Xuất xứ
// (origin country) values. The goal is to clean obvious residue left behind by
// label-regex extraction without mangling legitimate values: when in doubt the
// original (trimmed) value is passed through unchanged.

// Leading label residue that sometimes survives extraction, e.g. a value of
// "Xuất xứ: Trung Quốc" should become "Trung Quốc".
const ORIGIN_LABEL_PREFIX =
  /^(?:xx|xuất\s*xứ(?:\s*sx)?|xuat\s*xu(?:\s*sx)?|xuất\s*sứ|nơi\s*sản\s*xuất|noi\s*san\s*xuat|nước\s*sản\s*xuất|nuoc\s*san\s*xuat|quốc\s*gia|quoc\s*gia|sản\s*xuất\s*tại|san\s*xuat\s*tai|made\s*in|origin|country(?:\s*of\s*origin)?)\s*[:：\-]?\s*/i;

const MANUFACTURER_LABEL_PREFIX =
  /^(?:nsx|ncc|nhà\s*cung\s*cấp|nha\s*cung\s*cap|nhà\s*sản\s*xuất|nha\s*san\s*xuat|nhà\s*sx|nha\s*sx|hãng\s*sx|hang\s*sx|nhãn\s*hiệu|nhan\s*hieu|thương\s*hiệu(?:\s*sx)?|thuong\s*hieu(?:\s*sx)?|hãng|hang|công\s*ty|cong\s*ty|cty|brand|manufacturer)\s*[:：\-]?\s*/i;

// High-confidence origin synonyms keyed by a normalized (accent-stripped,
// lowercased) lookup. Only add entries we are certain about — unknown values
// must pass through untouched.
const ORIGIN_SYNONYMS: Record<string, string> = {
  tq: "Trung Quốc",
  "trung quoc": "Trung Quốc",
  china: "Trung Quốc",
  "made in china": "Trung Quốc",
  vn: "Việt Nam",
  "viet nam": "Việt Nam",
  vietnam: "Việt Nam",
  nhat: "Nhật Bản",
  "nhat ban": "Nhật Bản",
  japan: "Nhật Bản",
  "han quoc": "Hàn Quốc",
  korea: "Hàn Quốc",
  "south korea": "Hàn Quốc",
  duc: "Đức",
  germany: "Đức",
  "dai loan": "Đài Loan",
  taiwan: "Đài Loan",
  my: "Mỹ",
  usa: "Mỹ",
  "united states": "Mỹ",
  phap: "Pháp",
  france: "Pháp",
  "thai lan": "Thái Lan",
  thailand: "Thái Lan",
  malaysia: "Malaysia",
  mys: "Malaysia",
  indonesia: "Indonesia",
  idn: "Indonesia",
  singapore: "Singapore",
  sgp: "Singapore",
  india: "Ấn Độ",
  ind: "Ấn Độ",
  italy: "Ý",
  ita: "Ý",
  y: "Ý",
};

function normalizeLookupKey(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function titleCase(value: string) {
  return value
    .toLowerCase()
    .replace(/(^|[\s/\-(])([\p{L}])/gu, (_, sep: string, ch: string) =>
      `${sep}${ch.toUpperCase()}`,
    );
}

export function normalizeOriginCountry(
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null;
  }
  let cleaned = value.replace(/\s+/g, " ").trim();
  // Strip a leading label fragment that leaked into the value.
  let previous: string;
  do {
    previous = cleaned;
    cleaned = cleaned.replace(ORIGIN_LABEL_PREFIX, "").trim();
  } while (cleaned !== previous);
  if (!cleaned) {
    return null;
  }

  const mapped = ORIGIN_SYNONYMS[normalizeLookupKey(cleaned)];
  if (mapped) {
    return mapped;
  }

  // Title-case short values that arrived entirely lowercase (e.g. "nhật bản").
  // Anything already carrying uppercase keeps its casing so we never clobber
  // meaningful capitalization like "(EU)".
  if (
    cleaned.length <= 40 &&
    /^[\p{Ll}\s/\-().]+$/u.test(cleaned) &&
    /\p{Ll}/u.test(cleaned)
  ) {
    return titleCase(cleaned);
  }
  return cleaned;
}

export function normalizeManufacturer(
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null;
  }
  let cleaned = value.replace(/\s+/g, " ").trim();
  // Strip a leading label fragment that leaked into the value.
  let previous: string;
  do {
    previous = cleaned;
    cleaned = cleaned.replace(MANUFACTURER_LABEL_PREFIX, "").trim();
  } while (cleaned !== previous);
  // Drop trailing stock / price residue but preserve the original casing of the
  // brand itself.
  cleaned = cleaned
    .replace(/\b(còn hàng|hết hàng|in stock|out of stock)\b.*$/i, "")
    .replace(/\b\d{1,3}(?:[.,]\d{3})+\s*(?:vnd|vnđ|₫|đ|dong|đồng)?\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || cleaned.length < 2) {
    return null;
  }
  return cleaned.slice(0, 160);
}
