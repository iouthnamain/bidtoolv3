import {
  applyAllProposedFieldsWithCurrency,
  type WebLinkResult,
} from "~/lib/materials/enrich-gap-fill";
import {
  FILLABLE_FIELDS,
  type FillableField,
} from "~/lib/materials/excel-enrich-fields";
import type { MaterialEnrichmentEvidence } from "~/lib/materials/material-enrichment-types";
import type { RowDecision } from "~/lib/materials/review-decision";
import { searchCandidateKey } from "~/lib/materials/search-candidate-match";
import type {
  ProfileScrapedProduct,
  ScrapedProductReviewDraft,
  ScrapedProductStoredResult,
} from "~/lib/materials/profile-scrape-types";
import { scrapedProductKey } from "~/lib/materials/profile-scrape-types";

export type { ProfileScrapedProduct } from "~/lib/materials/profile-scrape-types";

export type ProfileCandidateCaptureMerge = {
  candidateKey: string;
  productKey: string;
  candidate: ScrapedProductStoredResult;
  decision: RowDecision;
};

export type ProfileProductResolution =
  | { status: "selected"; product: ProfileScrapedProduct; score: number }
  | { status: "awaiting_product_selection"; products: ProfileScrapedProduct[] };

function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
  return [
    ...new Set(values.map((value) => value?.trim()).filter(Boolean)),
  ] as string[];
}

function uniqueEvidence(
  values: MaterialEnrichmentEvidence[],
): MaterialEnrichmentEvidence[] {
  const seen = new Set<string>();
  return values.filter((item) => {
    const key = [item.field, item.value, item.sourceUrl, item.snippet].join(
      "\u0000",
    );
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function canonicalSourceUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_.+|fbclid|gclid|ref)$/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return `${url.hostname.replace(/^www\./i, "")}${url.port ? `:${url.port}` : ""}${url.pathname}${url.search}`;
  } catch {
    return value.trim().replace(/\/+$/, "");
  }
}

function normalizedScrapeJobUrl(value: string) {
  try {
    const url = new URL(value.trim());
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    url.hash = "";
    url.username = "";
    url.password = "";
    url.searchParams.sort();
    url.pathname =
      url.pathname.length > 1
        ? url.pathname.replace(/\/+$/g, "") || "/"
        : url.pathname;
    return url.toString();
  } catch {
    return value.trim();
  }
}

function sourceHost(value: string) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./i, "");
  } catch {
    return "";
  }
}

function textTokens(...values: Array<string | null | undefined>) {
  return new Set(
    values
      .join(" ")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 1),
  );
}

function tokenContainmentScore(left: Set<string>, right: Set<string>) {
  if (left.size === 0 || right.size === 0) return 0;
  let common = 0;
  for (const token of left) {
    if (right.has(token)) common += 1;
  }
  return common / Math.min(left.size, right.size);
}

function sameSource(candidate: ScrapedProductStoredResult, sourceUrl: string) {
  const target = canonicalSourceUrl(sourceUrl);
  return [candidate.sourceUrl, candidate.product.sourceUrl].some(
    (value) => value && canonicalSourceUrl(value) === target,
  );
}

export function profileCandidateSourceMatches(left: string, right: string) {
  return normalizedScrapeJobUrl(left) === normalizedScrapeJobUrl(right);
}

export function findProfileCandidateCapture(
  candidates: ScrapedProductStoredResult[] | undefined,
  sourceUrl: string,
) {
  return candidates?.find((candidate) => sameSource(candidate, sourceUrl));
}

export function findProfileCandidateCaptureByProductKey(
  candidates: ScrapedProductStoredResult[] | undefined,
  productKey: string | null | undefined,
) {
  return productKey
    ? candidates?.find((candidate) => candidate.productKey === productKey)
    : undefined;
}

function nonEmptyFields(
  ...records: Array<Partial<Record<FillableField, string>> | undefined>
) {
  const result: Partial<Record<FillableField, string>> = {};
  for (const record of records) {
    for (const field of FILLABLE_FIELDS) {
      const value = record?.[field]?.trim();
      if (value) result[field] = value;
    }
  }
  return result;
}

function productFields(
  product: ProfileScrapedProduct,
  fallbackSourceUrl: string,
): Partial<Record<FillableField, string>> {
  const hasPrice = product.price != null;
  return nonEmptyFields({
    code: product.sku ?? product.model ?? undefined,
    unit: product.unit ?? undefined,
    category: product.category ?? product.shopCategory ?? undefined,
    specText: product.specText,
    manufacturer: product.manufacturer ?? undefined,
    originCountry: product.originCountry ?? undefined,
    defaultUnitPrice: hasPrice ? String(product.price) : undefined,
    currency: hasPrice ? product.currency : undefined,
    sourceUrl: product.sourceUrl || fallbackSourceUrl,
  });
}

function mergeProductSnapshot(
  previous: ProfileScrapedProduct | undefined,
  current: ProfileScrapedProduct,
): ProfileScrapedProduct {
  if (!previous) return current;
  return {
    ...previous,
    ...current,
    name: current.name.trim() ? current.name : previous.name,
    unit: current.unit ?? previous.unit,
    category: current.category ?? previous.category,
    specText: current.specText.trim() ? current.specText : previous.specText,
    manufacturer: current.manufacturer ?? previous.manufacturer,
    originCountry: current.originCountry ?? previous.originCountry,
    price: current.price ?? previous.price,
    priceText: current.priceText ?? previous.priceText,
    currency: current.currency.trim() ? current.currency : previous.currency,
    sourceUrl: current.sourceUrl.trim()
      ? current.sourceUrl
      : previous.sourceUrl,
    imageUrl: current.imageUrl ?? previous.imageUrl,
    sku: current.sku ?? previous.sku,
    model: current.model ?? previous.model,
    shopCategory: current.shopCategory ?? previous.shopCategory,
    catalogPdfUrls: uniqueNonEmpty([
      ...previous.catalogPdfUrls,
      ...current.catalogPdfUrls,
    ]),
  };
}

function productEvidence(
  fields: Partial<Record<FillableField, string>>,
  product: ProfileScrapedProduct,
  fallbackSourceUrl: string,
) {
  const sourceUrl = product.sourceUrl.trim() || fallbackSourceUrl;
  const snippet = uniqueNonEmpty([
    product.name,
    product.priceText,
    product.model ? `Model ${product.model}` : undefined,
  ]).join(" · ");
  return FILLABLE_FIELDS.flatMap((field) => {
    const value = fields[field]?.trim();
    if (!value) return [];
    return [{ field, value, sourceUrl, snippet }];
  });
}

export function profileCandidateCaptureKey(sourceUrl: string) {
  return searchCandidateKey("web", sourceUrl);
}

/** Stable fingerprint for detecting search results that changed mid-scrape. */
export function profileCandidateSearchGeneration(
  decision: RowDecision | undefined,
) {
  const candidates = decision?.aiSearchCandidates?.length
    ? decision.aiSearchCandidates
    : decision?.aiSearchResult
      ? [decision.aiSearchResult]
      : [];
  return JSON.stringify({
    webLinksStatus: decision?.webLinksStatus ?? null,
    aiSearchStatus: decision?.aiSearchStatus ?? null,
    webLinks: (decision?.webLinkResults ?? []).map((link) => [
      link.url,
      link.rankScore ?? null,
    ]),
    aiCandidates: candidates.map((candidate) => ({
      url: candidate.url ?? null,
      sourceUrls: candidate.sourceUrls,
      fields: FILLABLE_FIELDS.map((field) => [
        field,
        candidate.fields[field]?.trim() ?? "",
      ]),
      catalogPdfUrls: candidate.catalogPdfUrls ?? [],
      evidence: candidate.evidence.map((item) => [
        item.field,
        item.value,
        item.sourceUrl,
        item.snippet,
      ]),
    })),
  });
}

export function hasCapturedProductDetails(response: {
  fields: Partial<Record<FillableField, string>>;
  catalogPdfUrls?: string[];
}) {
  return (
    FILLABLE_FIELDS.some(
      (field) =>
        field !== "sourceUrl" && Boolean(response.fields[field]?.trim()),
    ) || (response.catalogPdfUrls ?? []).some((url) => Boolean(url.trim()))
  );
}

export function resolveProfileScrapedProduct(
  products: ProfileScrapedProduct[],
  sourceUrl: string,
  expected?: { title?: string; name?: string; code?: string },
): ProfileProductResolution {
  const limitedProducts = products.slice(0, 8);
  const target = canonicalSourceUrl(sourceUrl);
  const exact = limitedProducts.find(
    (product) => canonicalSourceUrl(product.sourceUrl) === target,
  );
  if (exact) return { status: "selected", product: exact, score: 1 };

  const targetHost = sourceHost(sourceUrl);
  const expectedTokens = textTokens(expected?.title, expected?.name);
  const expectedCode = expected?.code?.trim().toLowerCase();
  const ranked = limitedProducts
    .filter((product) => sourceHost(product.sourceUrl) === targetHost)
    .map((product) => {
      const codeMatch =
        expectedCode &&
        [product.sku, product.model]
          .map((value) => value?.trim().toLowerCase())
          .includes(expectedCode)
          ? 1
          : 0;
      return {
        product,
        score: Math.max(
          codeMatch,
          tokenContainmentScore(
            textTokens(product.name, product.sku, product.model),
            expectedTokens,
          ),
        ),
      };
    })
    .sort((left, right) => right.score - left.score);
  const best = ranked[0];
  const runnerUp = ranked[1];
  if (
    !best ||
    best.score < 0.75 ||
    (runnerUp && best.score - runnerUp.score < 0.05)
  ) {
    return {
      status: "awaiting_product_selection",
      products: limitedProducts,
    };
  }
  return { status: "selected", product: best.product, score: best.score };
}

export function findProfileScrapedProduct(
  products: ProfileScrapedProduct[],
  sourceUrl: string,
  expected?: { title?: string; name?: string; code?: string },
) {
  const resolution = resolveProfileScrapedProduct(
    products,
    sourceUrl,
    expected,
  );
  return resolution.status === "selected" ? resolution.product : undefined;
}

function reviewDraftFromDecision(
  decision: RowDecision,
): ScrapedProductReviewDraft {
  return {
    acceptedFields: [...decision.acceptedFields],
    overwriteFields: [...(decision.overwriteFields ?? new Set())],
    editedValues: decision.editedValues,
    acceptedProfileFields: [...(decision.acceptedProfileFields ?? new Set())],
    editedProfileValues: decision.editedProfileValues,
    catalogPdfUrls: decision.catalogPdfUrls,
  } satisfies ScrapedProductReviewDraft;
}

function defaultReviewDraft(
  candidate: ScrapedProductStoredResult,
): ScrapedProductReviewDraft {
  const applied = applyAllProposedFieldsWithCurrency(candidate.fields);
  return {
    acceptedFields: [...applied.acceptedFields],
    overwriteFields: [],
    editedValues: applied.editedValues,
    acceptedProfileFields: [
      "name",
      ...(candidate.imageUrl ? (["imageUrl"] as const) : []),
    ],
    catalogPdfUrls: candidate.catalogPdfUrls,
  } satisfies ScrapedProductReviewDraft;
}

function stashActiveScrapeDraft(decision: RowDecision): RowDecision {
  if (!decision.selectedScrapeProductKey) return decision;
  return {
    ...decision,
    scrapeResults: decision.scrapeResults?.map((result) =>
      result.productKey === decision.selectedScrapeProductKey
        ? { ...result, reviewDraft: reviewDraftFromDecision(decision) }
        : result,
    ),
  };
}

/** Store or refresh one product without changing the active comparison. */
export function storeProfileCandidateCapture(
  decision: RowDecision,
  source: WebLinkResult,
  product: ProfileScrapedProduct,
  capture: {
    jobId?: string;
    shopScrapeJobId?: string | null;
    productMatchScore?: number | null;
  } = {},
): ProfileCandidateCaptureMerge | null {
  const scrapedFields = productFields(product, source.url);
  const capturedCatalogPdfUrls = uniqueNonEmpty([
    ...product.catalogPdfUrls,
    /\.pdf(?:$|[?#])/i.test(source.url) ? source.url : undefined,
  ]);
  if (
    !hasCapturedProductDetails({
      fields: scrapedFields,
      catalogPdfUrls: capturedCatalogPdfUrls,
    })
  ) {
    return null;
  }

  const current = stashActiveScrapeDraft(decision);
  const candidates = current.scrapeResults ?? [];
  const productKey = scrapedProductKey(source.url, product);
  const existingIndex = candidates.findIndex(
    (candidate) => candidate.productKey === productKey,
  );
  const existing = existingIndex >= 0 ? candidates[existingIndex] : undefined;
  const storedProduct = mergeProductSnapshot(existing?.product, product);
  const fields = productFields(storedProduct, source.url);
  const scrapedCatalogPdfUrls = uniqueNonEmpty([
    ...storedProduct.catalogPdfUrls,
    ...capturedCatalogPdfUrls,
  ]);
  const candidateKey = profileCandidateCaptureKey(source.url);
  const inheritedDraft =
    !existing &&
    current.selectedSource === "web" &&
    current.selectedSearchCandidateKey === candidateKey
      ? {
          ...reviewDraftFromDecision(current),
          catalogPdfUrls: uniqueNonEmpty([
            ...(current.catalogPdfUrls ?? []),
            ...scrapedCatalogPdfUrls,
          ]),
        }
      : undefined;
  const candidate: ScrapedProductStoredResult = {
    productKey,
    jobId: capture.jobId ?? existing?.jobId ?? "interactive",
    shopScrapeJobId:
      capture.shopScrapeJobId ?? existing?.shopScrapeJobId ?? null,
    sourceCandidateKey: candidateKey,
    sourceUrl: source.url,
    sourceScore: source.rankScore ?? null,
    product: storedProduct,
    fields,
    evidence: uniqueEvidence([
      ...(existing?.evidence ?? []),
      ...productEvidence(scrapedFields, product, source.url),
    ]),
    catalogPdfUrls: scrapedCatalogPdfUrls,
    name: storedProduct.name.trim() ? storedProduct.name.trim() : source.title,
    imageUrl: storedProduct.imageUrl?.trim()
      ? storedProduct.imageUrl.trim()
      : undefined,
    productMatchScore: capture.productMatchScore ?? null,
    reviewDraft: existing?.reviewDraft ?? inheritedDraft,
  };
  const nextCandidates = [...candidates];
  if (existingIndex >= 0) nextCandidates[existingIndex] = candidate;
  else nextCandidates.push(candidate);

  return {
    candidateKey,
    productKey,
    candidate,
    decision: {
      ...current,
      scrapeResults: nextCandidates,
    },
  };
}

/** Activate one retained product, stashing and restoring complete drafts. */
export function activateProfileCandidateCapture(
  decision: RowDecision,
  productKey: string,
): RowDecision | null {
  const current = stashActiveScrapeDraft(decision);
  const candidate = findProfileCandidateCaptureByProductKey(
    current.scrapeResults,
    productKey,
  );
  if (!candidate) return null;
  const draft = candidate.reviewDraft ?? defaultReviewDraft(candidate);
  return {
    ...current,
    selectedSource: "web",
    selectedSearchCandidateKey: candidate.sourceCandidateKey,
    selectedScrapeProductKey: candidate.productKey,
    acceptedFields: new Set(draft.acceptedFields),
    overwriteFields: new Set(draft.overwriteFields ?? []),
    editedValues: draft.editedValues,
    webProposedFields: { ...candidate.fields },
    webEvidence: candidate.evidence,
    catalogPdfUrls: draft.catalogPdfUrls,
    acceptedProfileFields: new Set(draft.acceptedProfileFields ?? []),
    editedProfileValues: draft.editedProfileValues,
    scrapeResults: current.scrapeResults?.map((result) =>
      result.productKey === productKey
        ? { ...result, reviewDraft: draft }
        : result,
    ),
  };
}

/** Remove one retained product; active removal intentionally selects no fallback. */
export function removeProfileCandidateCapture(
  decision: RowDecision,
  productKey: string,
): RowDecision {
  const current = stashActiveScrapeDraft(decision);
  const scrapeResults = current.scrapeResults?.filter(
    (result) => result.productKey !== productKey,
  );
  if (current.selectedScrapeProductKey !== productKey) {
    return { ...current, scrapeResults };
  }
  return {
    ...current,
    selectedSource: undefined,
    selectedSearchCandidateKey: undefined,
    selectedScrapeProductKey: null,
    acceptedFields: new Set(),
    overwriteFields: new Set(),
    editedValues: {},
    webProposedFields: {},
    webEvidence: [],
    catalogPdfUrls: undefined,
    acceptedProfileFields: new Set(),
    editedProfileValues: undefined,
    scrapeResults,
  };
}

/** Backward-compatible explicit capture: store, then activate. */
export function mergeProfileCandidateCapture(
  decision: RowDecision,
  source: WebLinkResult,
  product: ProfileScrapedProduct,
  capture: {
    jobId?: string;
    shopScrapeJobId?: string | null;
    productMatchScore?: number | null;
  } = {},
): ProfileCandidateCaptureMerge | null {
  const stored = storeProfileCandidateCapture(
    decision,
    source,
    product,
    capture,
  );
  if (!stored) return null;
  const activated = activateProfileCandidateCapture(
    stored.decision,
    stored.productKey,
  );
  return activated ? { ...stored, decision: activated } : null;
}
