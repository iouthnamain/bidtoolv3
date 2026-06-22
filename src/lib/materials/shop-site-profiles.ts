export type ShopSiteProfileExtraLabels = {
  manufacturer?: readonly string[];
  originCountry?: readonly string[];
  category?: readonly string[];
  sku?: readonly string[];
  model?: readonly string[];
  availability?: readonly string[];
  specText?: readonly string[];
};

export type ShopSiteProfile = {
  id: string;
  hostPattern: RegExp;
  listingPathPatterns?: readonly RegExp[];
  productPathPatterns?: readonly RegExp[];
  extraCardSelectors?: readonly string[];
  extraSpecSelectors?: readonly string[];
  extraLabels?: ShopSiteProfileExtraLabels;
};

const DEFAULT_EXTRA_SPEC_SELECTORS = [
  ".woocommerce-product-attributes",
  ".woocommerce-product-attributes-item",
  ".product_meta",
  "#tab-description",
  ".tt-sp",
  ".product-info",
  ".specifications",
  "[class*='thong-so' i]",
  "[class*='spec' i]",
] as const;

export const SHOP_SITE_PROFILES: readonly ShopSiteProfile[] = [
  {
    id: "thegioiic",
    hostPattern: /(?:^|\.)thegioiic\.com$/i,
    listingPathPatterns: [/^\/san-pham(?:\/|$)/i],
    extraLabels: {
      manufacturer: ["nsx", "hãng sx"],
      originCountry: ["xx", "xuất xứ sx"],
    },
  },
  {
    id: "dientutuonglai",
    hostPattern: /(?:^|\.)dientutuonglai\.com$/i,
    listingPathPatterns: [/^\/san-pham(?:\/|$)/i],
  },
  {
    id: "linhkienchatluong",
    hostPattern: /(?:^|\.)linhkienchatluong\.vn$/i,
    listingPathPatterns: [/_s\d+\.aspx$/i],
    productPathPatterns: [/_p\d+\.aspx$/i],
  },
  {
    id: "codienhaiau",
    hostPattern: /(?:^|\.)codienhaiau\.com$/i,
    listingPathPatterns: [
      /^\/(?:danh-muc|category|san-pham)(?:\/|$)/i,
    ],
    extraCardSelectors: [".catepage .motsanpham", ".product-item"],
  },
  {
    id: "dientunguyenhien",
    hostPattern: /(?:^|\.)dientunguyenhien\.(?:com|vn)$/i,
    productPathPatterns: [/^\/show\//i],
  },
  {
    id: "woocommerce",
    hostPattern: /.+/i,
    extraCardSelectors: [
      "ul.products li.product",
      "li.product.type-product",
      ".products .product",
    ],
    extraSpecSelectors: DEFAULT_EXTRA_SPEC_SELECTORS,
  },
] as const;

export function resolveShopSiteProfile(hostname: string): ShopSiteProfile {
  const normalized = hostname.toLowerCase();
  for (const profile of SHOP_SITE_PROFILES) {
    if (profile.id === "woocommerce") {
      continue;
    }
    if (profile.hostPattern.test(normalized)) {
      return profile;
    }
  }
  return SHOP_SITE_PROFILES.find((profile) => profile.id === "woocommerce")!;
}

export function mergeExtraSpecSelectors(
  profile: ShopSiteProfile,
): readonly string[] {
  const merged = new Set<string>([
    ...DEFAULT_EXTRA_SPEC_SELECTORS,
    ...(profile.extraSpecSelectors ?? []),
  ]);
  return Array.from(merged);
}

export function mergeExtraLabels(
  profile: ShopSiteProfile,
  baseLabels: Record<string, readonly string[]>,
): Record<string, readonly string[]> {
  if (!profile.extraLabels) {
    return baseLabels;
  }
  const merged: Record<string, readonly string[]> = { ...baseLabels };
  for (const [field, labels] of Object.entries(profile.extraLabels)) {
    const existing = merged[field] ?? [];
    merged[field] = Array.from(new Set([...existing, ...labels]));
  }
  return merged;
}

export function profileListingPathPatterns(
  profile: ShopSiteProfile,
): readonly RegExp[] {
  return profile.listingPathPatterns ?? [];
}

export function profileProductPathPatterns(
  profile: ShopSiteProfile,
): readonly RegExp[] {
  return profile.productPathPatterns ?? [];
}

export function buildHostSpecLabelPrefixes(
  profile: ShopSiteProfile,
  baseDefinitions: Record<string, readonly string[]>,
): readonly string[] {
  const merged = mergeExtraLabels(profile, baseDefinitions);
  return Object.values(merged).flat();
}
