import { createLogger, traceFn } from "~/server/lib/logger";
import type {
  SearchDomainPolicy,
  SearchQueryControls,
} from "~/server/services/app-settings";
import { DEFAULT_SEARCH_PENALTY_DOMAINS } from "~/server/services/search-domain-policy";
const log = createLogger("services-excel-research-query-builder");

export type SearchQuery = {
  query: string;
  intent:
    | "official"
    | "datasheet"
    | "pdf"
    | "general"
    | "bang_gia"
    | "vn_spec"
    | "vn_pdf"
    | "site_vn"
    | "vn_product"
    | "vn_supplier"
    | "vn_price"
    | "negative_marketplace";
};

function textOverlap(a: string, b: string): number {
  const tokensA = new Set(
    a
      .toLowerCase()
      .split(/\s+/)
      .filter((token) => token.length > 2),
  );
  const tokensB = new Set(
    b
      .toLowerCase()
      .split(/\s+/)
      .filter((token) => token.length > 2),
  );
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let overlap = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) {
      overlap += 1;
    }
  }
  return overlap / Math.min(tokensA.size, tokensB.size);
}

type SearchQueryContext =
  | "material_job"
  | "excel_research"
  | "interactive"
  | "profile_search";

function maxQueriesForContext(
  inputMax: number | undefined,
  controls: SearchQueryControls | undefined,
  context: SearchQueryContext | undefined,
) {
  if (inputMax != null) return inputMax;
  if (!controls) return 6;
  switch (context) {
    case "material_job":
      return controls.materialJobMaxQueries;
    case "excel_research":
      return controls.excelResearchMaxQueries;
    case "profile_search":
      return controls.interactiveMaxQueries;
    case "interactive":
    default:
      return controls.interactiveMaxQueries;
  }
}

function negativeMarketplaceSuffix(policy?: SearchDomainPolicy) {
  const domains =
    policy?.penaltyDomains && policy.penaltyDomains.length > 0
      ? policy.penaltyDomains
      : DEFAULT_SEARCH_PENALTY_DOMAINS;
  return domains.map((domain) => `-site:${domain}`).join(" ");
}

function stripAccents(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

const MODEL_STOPWORDS = new Set([
  "bang",
  "be",
  "cap",
  "cat",
  "day",
  "dien",
  "kem",
  "ma",
  "may",
  "nhua",
  "ong",
  "thep",
  "tong",
]);

const QUERY_INTENT_TERMS = [
  /\bthông\s*số\s*kỹ\s*thuật\b/gi,
  /\bthong\s*so\s*ky\s*thuat\b/gi,
  /\bchi\s*tiết\b/gi,
  /\bchi\s*tiet\b/gi,
  /\bcatalog(?:ue)?\b/gi,
  /\bdatasheet\b/gi,
  /\bbảng\s*giá\b/gi,
  /\bbang\s*gia\b/gi,
  /\bbáo\s*giá\b/gi,
  /\bbao\s*gia\b/gi,
  /\bfiletype:\S+\b/gi,
  /\bsite:\S+\b/gi,
  /\B-site:\S+\b/gi,
];

const KNOWN_BRAND_PROBES = [
  {
    pattern:
      /\b(bình\s*minh|binh\s*minh|nhựa\s*bình\s*minh|nhua\s*binh\s*minh)\b/i,
    domainTerms: ["binhminhplastic"],
    productTerms: ["PVC"],
  },
  {
    pattern: /\bcadivi\b/i,
    domainTerms: ["cadivi", "cadivi-vn"],
    productTerms: ["dây điện", "cáp điện"],
  },
  {
    pattern: /\b(hòa\s*phát|hoa\s*phat)\b/i,
    domainTerms: ["hoaphat"],
    productTerms: ["thép"],
  },
];

function tokenizeProductName(value: string) {
  return value.match(/[A-Za-zÀ-ỹ0-9]+(?:[./xX-][A-Za-zÀ-ỹ0-9]+)*/g) ?? [];
}

function extractModelSpecPhrase(name: string, identifier: string) {
  if (identifier.trim()) return identifier.trim();

  const picked = tokenizeProductName(name).filter((token) => {
    const normalized = stripAccents(token).toLowerCase();
    if (MODEL_STOPWORDS.has(normalized)) return false;
    return /\d/.test(token) || /[A-Z]/.test(token);
  });

  return picked.length > 0 ? picked.join(" ") : "";
}

function specSpacingVariants(value: string) {
  const variants = new Set<string>();
  const push = (candidate: string) => {
    const normalized = candidate.replace(/\s+/g, " ").trim();
    if (normalized) variants.add(normalized);
  };

  push(value);
  push(
    value.replace(
      /(\d+(?:[.,]\d+)?)\s*(mm2|mm²|m2)\b/gi,
      (_match, size: string, unit: string) => `${size} ${unit}`,
    ),
  );
  push(
    value.replace(
      /(\d+(?:[.,]\d+)?)\s*(mm2)\b/gi,
      (_match, size: string) => `${size}mm²`,
    ),
  );
  push(value.replace(/(\d+)\.(\d+)/g, "$1,$2"));

  return [...variants];
}

function relaxedSpecNameVariants(name: string) {
  const variants = new Set<string>();
  const push = (candidate: string) => {
    const normalized = candidate.replace(/\s+/g, " ").trim();
    if (normalized && normalized !== name) variants.add(normalized);
  };

  push(name.replace(/\b\d+(?:[.,]\d+)?\s*(?:mm2|mm²|m2)\b/gi, ""));
  push(name.replace(/\b\d+\s*x\s*\d+(?:[.,]\d+)?\b/gi, ""));

  return [...variants];
}

function cleanProbeQuery(value: string) {
  let cleaned = value;
  for (const pattern of QUERY_INTENT_TERMS) {
    cleaned = cleaned.replace(pattern, " ");
  }
  return cleaned.replace(/[“”"]/g, " ").replace(/\s+/g, " ").trim();
}

function removeKnownBrand(value: string, pattern: RegExp) {
  return value.replace(pattern, " ").replace(/\s+/g, " ").trim();
}

function pushUnique(values: string[], value: string | null | undefined) {
  const trimmed = value?.replace(/\s+/g, " ").trim();
  if (!trimmed || trimmed.length < 3) return;
  if (values.some((item) => item.toLowerCase() === trimmed.toLowerCase()))
    return;
  values.push(trimmed);
}

export function buildSearchProbeQueries(query: string, limit = 8): string[] {
  const original = query.trim();
  if (!original) return [];

  const probes: string[] = [];
  const core = cleanProbeQuery(original);
  const modelSpec = extractModelSpecPhrase(core || original, "");
  const relaxedNames = relaxedSpecNameVariants(core);

  pushUnique(probes, original);
  pushUnique(probes, core);

  for (const brand of KNOWN_BRAND_PROBES) {
    if (!brand.pattern.test(original) && !brand.pattern.test(core)) continue;
    const withoutBrand = removeKnownBrand(core, brand.pattern);
    const brandModelSpec =
      extractModelSpecPhrase(withoutBrand, "") || modelSpec;
    for (const domainTerm of brand.domainTerms) {
      if (brandModelSpec) {
        pushUnique(probes, `${domainTerm} ${brandModelSpec}`);
        for (const productTerm of brand.productTerms.slice(0, 1)) {
          pushUnique(probes, `${domainTerm} ${productTerm} ${brandModelSpec}`);
        }
      }
      pushUnique(probes, `${domainTerm} ${withoutBrand}`);
    }
  }

  for (const variant of relaxedNames.slice(0, 2)) {
    pushUnique(probes, variant);
  }
  pushUnique(probes, `${core} catalog`);
  pushUnique(probes, `${core} bảng giá`);

  return probes.slice(0, Math.max(1, limit));
}

function _buildSearchQueries(
  input: {
    name: string;
    manufacturer?: string | null;
    code?: string | null;
    specText?: string | null;
    sku?: string | null;
    model?: string | null;
    unit?: string | null;
    category?: string | null;
    originCountry?: string | null;
    maxQueries?: number;
  },
  options?: {
    maxQueries?: number;
    domainPolicy?: SearchDomainPolicy;
    queryControls?: SearchQueryControls;
    context?: SearchQueryContext;
  },
): SearchQuery[] {
  const name = input.name.trim();
  if (!name) return [];

  const brand = input.manufacturer?.trim() ?? "";
  const code = input.code?.trim() ?? "";
  const sku = input.sku?.trim() ?? "";
  const model = input.model?.trim() ?? "";
  const identifier = sku || model || code;
  const category = input.category?.trim() ?? "";
  const unit = input.unit?.trim() ?? "";
  const origin = input.originCountry?.trim() ?? "";
  const maxQueries = Math.max(
    1,
    options?.maxQueries ??
      maxQueriesForContext(
        input.maxQueries,
        options?.queryControls,
        options?.context,
      ),
  );
  const enableSiteVnVariants =
    options?.queryControls?.enableSiteVnVariants ?? true;
  const enableNegativeMarketplaceVariants =
    options?.queryControls?.enableNegativeMarketplaceVariants ?? true;
  const isProfileSearch = options?.context === "profile_search";
  const allowConstrainedVariants = options?.context !== "interactive";
  const queries: SearchQuery[] = [];

  const push = (
    query: string | null | undefined,
    intent: SearchQuery["intent"],
    allowSimilar = false,
  ) => {
    const trimmed = query?.trim();
    if (!trimmed || trimmed.length < 3) return;
    if (queries.some((item) => item.query === trimmed)) return;
    if (
      !allowSimilar &&
      queries.some((item) => textOverlap(trimmed, item.query) > 0.75)
    ) {
      return;
    }
    queries.push({ query: trimmed, intent });
  };
  const pushConstrainedVariants = () => {
    if (enableSiteVnVariants && allowConstrainedVariants) {
      push(
        brand ? `${name} ${brand} site:.vn` : `${name} site:.vn`,
        "site_vn",
        true,
      );
    }

    if (enableNegativeMarketplaceVariants && allowConstrainedVariants) {
      const suffix = negativeMarketplaceSuffix(options?.domainPolicy);
      push(
        brand
          ? `${name} ${brand} thông số kỹ thuật ${suffix}`
          : `${name} thông số kỹ thuật ${suffix}`,
        "negative_marketplace",
        true,
      );
      push(
        brand
          ? `${name} ${brand} đại lý nhà phân phối ${suffix}`
          : `${name} đại lý nhà phân phối ${suffix}`,
        "negative_marketplace",
        true,
      );
    }
  };
  const profileQueryBase = brand ? `${name} ${brand}` : name;
  const pushProfileDiscoveryQueries = () => {
    // The profile search budget is intentionally led by sources that can sell
    // the material, before catalog/PDF queries used for validation.
    push(`${profileQueryBase} sản phẩm`, "vn_product", true);
    push(`${profileQueryBase} đại lý nhà phân phối`, "vn_supplier", true);
    push(`${profileQueryBase} giá bán`, "vn_price", true);
  };
  const pushProfileConstrainedVariants = () => {
    if (enableSiteVnVariants) {
      push(`${profileQueryBase} site:.vn`, "site_vn", true);
    }

    if (enableNegativeMarketplaceVariants) {
      const suffix = negativeMarketplaceSuffix(options?.domainPolicy);
      push(
        `${profileQueryBase} sản phẩm ${suffix}`,
        "negative_marketplace",
        true,
      );
    }
  };
  const pushProfileValidationQuery = () => {
    // Retain one bounded slot for an authoritative catalog/spec source. Without
    // it, the six-query profile budget would contain seller discovery only.
    if (brand && identifier) {
      push(`${brand} ${identifier} datasheet filetype:pdf`, "pdf", true);
      return;
    }
    push(`${profileQueryBase} catalog datasheet`, "datasheet", true);
  };
  const modelSpec = extractModelSpecPhrase(name, identifier);
  const modelSpecVariants = specSpacingVariants(modelSpec);
  const nameVariants = specSpacingVariants(name);
  const relaxedNames = relaxedSpecNameVariants(name);

  if (isProfileSearch) {
    pushProfileDiscoveryQueries();
    pushProfileConstrainedVariants();
    pushProfileValidationQuery();
  }

  if (brand && !identifier) {
    for (const variant of relaxedNames.slice(0, 2)) {
      push(`${variant} ${brand}`, "general", true);
      push(`${variant} ${brand} bảng giá`, "bang_gia", true);
    }
    for (const variant of modelSpecVariants.slice(0, 2)) {
      push(`${brand} ${variant}`, "official", true);
    }
  }

  if (brand && identifier) {
    push(`"${brand}" "${identifier}" datasheet filetype:pdf`, "pdf");
    push(`${brand} ${identifier} catalogue filetype:pdf`, "vn_pdf");
  }

  if (brand) {
    for (const variant of nameVariants.slice(1, 3)) {
      push(`${variant} ${brand}`, "general", true);
    }
    push(`${brand} ${name} thông số kỹ thuật`, "vn_spec");
    push(`${name} ${brand} thông số kỹ thuật filetype:pdf`, "vn_pdf");
    push(`${name} bảng giá ${brand}`, "bang_gia");
    push(`${name} ${brand} đại lý nhà phân phối`, "vn_supplier");
    push(`${name} ${brand} bảng giá báo giá`, "vn_price");
  }

  if (!input.specText?.trim()) {
    push(
      `${name} thông số kỹ thuật chi tiết${brand ? ` ${brand}` : ""}`,
      "vn_spec",
    );
  }

  if (!isProfileSearch) {
    pushConstrainedVariants();
  }

  if (identifier) {
    push(brand ? `${identifier} ${brand}` : identifier, "official");
    if (brand) {
      push(`${identifier} catalogue ${brand}`, "vn_pdf");
    }
  }

  if (category && textOverlap(category, name) < 0.6) {
    push(`${name} ${category}`, "general");
  }

  if (unit && textOverlap(unit, name) < 0.5) {
    push(`${name} ${unit}`, "general");
  }

  if (origin && brand) {
    push(`${name} ${brand} ${origin}`, "general");
  }

  if (input.specText) {
    const shortSpec = input.specText.slice(0, 60).trim();
    if (textOverlap(shortSpec, name) < 0.6) {
      push(`${name} ${shortSpec}`, "general");
    }
  }

  push(`${name} catalog datasheet`, "datasheet");
  push(brand ? `${name} ${brand}` : name, "general");

  return queries.slice(0, maxQueries);
}

export const buildSearchQueries = traceFn(
  log,
  "buildSearchQueries",
  _buildSearchQueries,
);
