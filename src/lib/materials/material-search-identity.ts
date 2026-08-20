export type MaterialSearchIdentityInput = {
  name: string;
  code?: string | null;
  manufacturer?: string | null;
  specText?: string | null;
  unit?: string | null;
  category?: string | null;
  originCountry?: string | null;
};

export type MaterialSearchIdentity = {
  signature: string;
  name: string;
  normalizedName: string;
  /** A broad, search-friendly product phrase without model/spec suffixes. */
  searchPhrase: string | null;
  productPhrase: string | null;
  manufacturer: string | null;
  identifiers: string[];
  compositeDimensions: string[];
  numericSpecs: string[];
  highSignalSpecTokens: string[];
  unit: string | null;
};

const GENERIC_NOISE = new Set([
  "cai",
  "chiec",
  "bo",
  "dien",
  "vat tu",
  "vnd",
  "vnđ",
  "dong",
  "viet nam",
  "trung quoc",
  "han quoc",
  "nhat ban",
]);

export function stripVietnameseAccents(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

export function normalizeMaterialSearchText(value: string) {
  return stripVietnameseAccents(normalizeMaterialSearchQueryVariant(value))
    .toLowerCase()
    .replace(/[^a-z0-9.+/-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A search-friendly variant that keeps Vietnamese words but canonicalizes specs. */
export function normalizeMaterialSearchQueryVariant(value: string) {
  return value
    .normalize("NFC")
    .replace(/[ΦØ]/gi, "phi ")
    .replace(/\bphi\s*/gi, "phi ")
    .replace(/(\d)\s*[x×]\s*(?=\d)/gi, "$1x")
    .replace(/(\d+(?:[.,]\d+)?)\s*(?:mm2|mm²)\b/gi, "$1mm²")
    .replace(/(\d+(?:[.,]\d+)?)\s*(?:m2|m²)\b/gi, "$1m²")
    .replace(/(\d+(?:x\d+){2,})\s*mm\b/gi, "$1")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/[“”"']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function extractDimensions(value: string) {
  const normalized = normalizeMaterialSearchText(value);
  return unique(
    [
      ...normalized.matchAll(
        /\b\d+(?:\.\d+)?(?:x\d+(?:\.\d+)?){1,3}(?:mm)?\b/g,
      ),
    ].map((match) => match[0].replace(/mm$/, "")),
  );
}

function extractIdentifiers(value: string) {
  const canonical = normalizeMaterialSearchQueryVariant(value);
  const tokens =
    canonical.match(
      /\b(?=[A-Za-z0-9./-]*\d)[A-Za-z0-9]+(?:[./-][A-Za-z0-9]+)*\b/g,
    ) ?? [];
  return unique(
    tokens
      .map((token) => normalizeMaterialSearchText(token).replace(/\s+/g, ""))
      .filter((token) => token.length >= 2 && !/^\d+(?:\.\d+)?$/.test(token)),
  );
}

function extractNumericSpecs(value: string) {
  const normalized = normalizeMaterialSearchText(value);
  return unique(
    [
      ...normalized.matchAll(
        /\b\d+(?:\.\d+)?\s*(?:a|ka|v|kv|w|kw|mm|mm²|m²|bar|pn\d+|dn\d+|p)\b/g,
      ),
    ].map((match) => match[0].replace(/\s+/g, "")),
  );
}

function cleanOptional(value: string | null | undefined) {
  const trimmed = value?.replace(/\s+/g, " ").trim() ?? "";
  return trimmed || null;
}

function dedupePhraseTokens(value: string) {
  const seen = new Set<string>();
  return value
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => {
      const key = normalizeMaterialSearchText(token);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(" ");
}

function isStandaloneNumericToken(token: string) {
  return /^\d+(?:[.,]\d+)?$/.test(token);
}

function isSearchSpecMarker(token: string) {
  return /^(?:phi|d|dn|pn|mm|mm²|m²)$/i.test(token);
}

/**
 * Return a broad query for providers that perform poorly with long model
 * strings. Keep semantic numeric product words such as "1 chiều", but stop
 * before model/spec suffixes such as "M5" or "600x400x200". Parenthesized
 * aliases are preferred when they carry more useful words than the outer name
 * (for example, "Xăng (xăng thơm)").
 */
function extractSearchPhrase(name: string): string | null {
  const canonical = normalizeMaterialSearchQueryVariant(name);
  const parenthetical = [...canonical.matchAll(/\(([^)]*)\)/g)].map(
    (match) => match[1] ?? "",
  );
  const outer = canonical.replace(/\([^)]*\)/g, " ");
  const candidates = [outer, ...parenthetical]
    .map((candidate) => {
      const tokens = candidate
        .replace(/[()[\]{};,]+/g, " ")
        .split(/\s+/)
        .filter(Boolean);
      const firstNumericToken = tokens.findIndex((token) => /\d/.test(token));
      if (firstNumericToken < 0) return dedupePhraseTokens(tokens.join(" "));

      const firstToken = tokens[firstNumericToken] ?? "";
      const leadingTokens = tokens.slice(0, firstNumericToken);
      const hadSearchSpecMarker = isSearchSpecMarker(
        leadingTokens.at(-1) ?? "",
      );
      if (hadSearchSpecMarker) {
        leadingTokens.pop();
      }

      // A standalone number can be part of the human-readable family name
      // when the prefix would otherwise be generic (for example, "Van").
      // Preserve an already-specific prefix such as "Van tiết lưu" so broad
      // educational/product-family sources remain discoverable.
      const phraseTokens =
        isStandaloneNumericToken(firstToken) &&
        !hadSearchSpecMarker &&
        leadingTokens.length < 2
          ? [...leadingTokens, firstToken]
          : leadingTokens;
      if (phraseTokens.length > leadingTokens.length) {
        for (const token of tokens.slice(firstNumericToken + 1)) {
          if (/\d/.test(token) || isSearchSpecMarker(token)) break;
          phraseTokens.push(token);
        }
      }

      return dedupePhraseTokens(phraseTokens.join(" "));
    })
    // A one-token phrase is too generic to drive broad recovery (for example,
    // "Van" matches both valve and vehicle/footwear pages).
    .filter((candidate) => candidate.split(/\s+/).filter(Boolean).length >= 2);

  return (
    candidates.sort((left, right) => {
      const tokenDifference =
        right.split(/\s+/).length - left.split(/\s+/).length;
      return tokenDifference || right.length - left.length;
    })[0] ?? null
  );
}

export function createMaterialSearchIdentity(
  input: MaterialSearchIdentityInput,
): MaterialSearchIdentity {
  const name = normalizeMaterialSearchQueryVariant(input.name);
  const combined = [input.name, input.code, input.specText]
    .filter(Boolean)
    .join(" ");
  const compositeDimensions = extractDimensions(combined);
  const identifiers = unique([
    ...extractIdentifiers(input.code ?? ""),
    ...extractIdentifiers(input.name),
    ...compositeDimensions,
  ]);
  const numericSpecs = extractNumericSpecs(combined);
  const specTokens = unique([
    ...identifiers,
    ...numericSpecs,
    ...normalizeMaterialSearchText(input.specText ?? "")
      .split(" ")
      .filter((token) => /\d/.test(token) && token.length >= 2),
  ]);
  const normalizedName = normalizeMaterialSearchText(name);
  const searchPhrase = extractSearchPhrase(input.name);
  const manufacturer = cleanOptional(input.manufacturer);
  const unit = cleanOptional(input.unit);
  const manufacturerNormalized = normalizeMaterialSearchText(
    manufacturer ?? "",
  );
  const productPhraseTokens = normalizedName
    .split(" ")
    .filter((token) => !identifiers.includes(token))
    .filter((token) => token !== manufacturerNormalized)
    .filter((token) => !GENERIC_NOISE.has(token));
  const productPhrase = productPhraseTokens.slice(0, 6).join(" ") || null;
  const signatureParts = unique([
    normalizedName,
    normalizeMaterialSearchText(manufacturer ?? ""),
    normalizeMaterialSearchText(unit ?? ""),
    ...identifiers,
    ...specTokens,
  ]);

  return {
    signature: signatureParts.join("|"),
    name,
    normalizedName,
    searchPhrase,
    productPhrase,
    manufacturer,
    identifiers,
    compositeDimensions,
    numericSpecs,
    highSignalSpecTokens: specTokens.slice(0, 12),
    unit,
  };
}

export function compactMaterialIdentityQuery(identity: MaterialSearchIdentity) {
  const product = identity.searchPhrase ?? identity.name;
  const manufacturer = identity.manufacturer;
  const productContainsManufacturer = Boolean(
    manufacturer &&
      normalizeMaterialSearchText(product).includes(
        normalizeMaterialSearchText(manufacturer),
      ),
  );
  const parts = [
    product,
    productContainsManufacturer ? null : manufacturer,
    ...identity.identifiers.slice(0, 3),
  ].filter(Boolean);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}
