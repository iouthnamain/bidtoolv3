import "server-only";

import type { FillableField } from "~/lib/materials/excel-enrich-fields";
import {
  RELIABLE_SEARCH_MATCH_THRESHOLD,
  scoreAiCandidateCompletion,
} from "~/lib/materials/search-candidate-match";
import { assessMaterialSearchCandidate } from "~/lib/materials/match-assessment";
import type {
  AiSearchStoredResult,
  WebLinkResult,
} from "~/lib/materials/enrich-gap-fill";
import {
  ENRICHABLE_FIELDS,
  ENRICHABLE_TO_FILLABLE_FIELD,
} from "~/lib/materials/material-enrichment-types";
import { createLogger, traceFn } from "~/server/lib/logger";
import {
  resolveAiProvider,
  resolveSearchDomainPolicy,
  resolveSearchQueryControls,
  resolveSearchRelevancePipelineMode,
  resolveSearxngSearchConfig,
} from "~/server/services/app-settings";
import {
  buildLegacyProfileSearchQueries,
  buildProfileSearchQueryWaves,
  type SearchQuery,
} from "~/server/services/excel-research/query-builder";
import {
  enrichmentInputFromRow,
  mapExtractedToFillable,
  type EnrichWebRowInput,
} from "~/server/services/enrich-web-row";
import { extractProductFromSources } from "~/server/services/material-enrichment-extract";
import {
  enrichSearchResultsWithFetchedContent,
  fetchUrlAsSearchResult,
  rankSearchResults,
  searchWebForProduct,
  type WebSearchResult,
} from "~/server/services/material-web-search";
import {
  activeRejectedUrls,
  normalizeMaterialSearchUrl,
} from "~/server/services/material-search-feedback";
import { rerankAmbiguousMaterialLinks } from "~/server/services/material-search-ai-reranker";
import { recordSearchAuditLog } from "~/server/services/search-audit";

const log = createLogger("services-enrich-profile-row-search");

const PROFILE_TOP_LINKS = 8;
const PROFILE_FETCH_LINKS = 6;
const FETCH_CONCURRENCY = 3;
const EXTRACT_CONCURRENCY = 3;
const PROFILE_AI_WARNING_LIMIT = 6;

export type EnrichProfileRowSearchResult = {
  webLinkResults: WebLinkResult[];
  aiSearchCandidates: AiSearchStoredResult[];
  recommendedCandidateKey?: string;
  warnings: string[];
};

export type ProfileWebLinksSearchResult = {
  webLinkResults: WebLinkResult[];
  primaryResults?: WebLinkResult[];
  weakResults?: WebLinkResult[];
  rejectedCount?: number;
  identity?: ReturnType<typeof buildProfileSearchQueryWaves>["identity"];
  pipelineMode?: "guarded" | "legacy";
  timing?: { initialLinksMs: number };
  queries: string[];
  warnings: string[];
};

function mergeWaveResults(...groups: WebSearchResult[][]) {
  const byUrl = new Map<string, WebSearchResult>();
  for (const result of groups.flat()) {
    const existing = byUrl.get(result.url);
    if (!existing) {
      byUrl.set(result.url, { ...result });
      continue;
    }
    const occurrences = [
      ...(existing.matchedQueries ?? []),
      ...(result.matchedQueries ?? []),
    ];
    existing.matchedQueries = [
      ...new Map(
        occurrences.map((item) => [`${item.query}:${item.rank}`, item]),
      ).values(),
    ];
    existing.rrfScore = existing.matchedQueries.reduce(
      (sum, item) => sum + 1 / (60 + item.rank),
      0,
    );
  }
  return [...byUrl.values()];
}

function toWebLink(
  result: WebSearchResult,
  assessment: ReturnType<typeof assessMaterialSearchCandidate>,
  fetchStatus: WebLinkResult["fetchStatus"],
): WebLinkResult {
  return {
    title: result.title,
    url: result.url,
    domain: result.domain,
    snippet: result.snippet,
    query: result.query,
    rankScore: assessment.score,
    baseRankScore: result.baseRankScore,
    matchedQueries: result.matchedQueries,
    rrfScore: result.rrfScore,
    assessment,
    fetchStatus,
  };
}

export type ProfileAiCandidatesSearchResult = {
  aiSearchCandidates: AiSearchStoredResult[];
  recommendedCandidateKey?: string;
  warnings: string[];
};

function fieldConfidencesFromExtracted(
  extracted: Awaited<ReturnType<typeof extractProductFromSources>>,
): Partial<Record<FillableField, number>> {
  const result: Partial<Record<FillableField, number>> = {};
  for (const enrichable of ENRICHABLE_FIELDS) {
    const cell = extracted[enrichable];
    if (cell?.confidence == null || !Number.isFinite(cell.confidence)) {
      continue;
    }
    result[ENRICHABLE_TO_FILLABLE_FIELD[enrichable]] = cell.confidence;
  }
  return result;
}

function verifiedCatalogUrlsFromSources(
  urls: string[],
  sources: WebSearchResult[],
) {
  const normalize = (value: string) => {
    try {
      const parsed = new URL(value);
      parsed.hash = "";
      return parsed.toString().replace(/\/$/, "");
    } catch {
      return "";
    }
  };
  return urls.filter((url) => {
    const normalized = normalize(url);
    if (!normalized) return false;
    return sources.some((source) => {
      const discovered = source.discoveredPdfUrls ?? [];
      return (
        normalize(source.url) === normalized ||
        source.snippet.includes(url) ||
        discovered.some((candidate) => normalize(candidate) === normalized)
      );
    });
  });
}

async function runPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await worker(items[index]!, index);
      }
    },
  );
  await Promise.all(runners);
  return results;
}

async function enrichLinkWithFetch(
  link: WebSearchResult,
  signal?: AbortSignal,
): Promise<WebSearchResult> {
  const fetched = await fetchUrlAsSearchResult(
    link.url,
    link.query ?? "profile_search",
    signal,
  );
  if (!fetched) return link;
  return {
    ...link,
    url: fetched.url || link.url,
    title: fetched.title.trim() || link.title,
    snippet: fetched.snippet.trim() || link.snippet,
    domain: fetched.domain || link.domain,
    discoveredPdfUrls: fetched.discoveredPdfUrls ?? link.discoveredPdfUrls,
  };
}

function webLinkToSearchResult(link: WebLinkResult): WebSearchResult {
  return {
    title: link.title,
    url: link.url,
    domain: link.domain,
    snippet: link.snippet,
    query: link.query ?? "profile_search",
    rankScore: link.rankScore ?? 0,
  };
}

function sourceLabel(link: WebSearchResult) {
  const domain = link.domain.trim();
  if (domain) return domain;
  try {
    return new URL(link.url).hostname;
  } catch {
    return link.url;
  }
}

function extractionErrorMessage(error: unknown) {
  const message =
    error instanceof Error && error.message.trim()
      ? error.message.trim()
      : "lỗi không xác định";
  return message.length > 160 ? `${message.slice(0, 160)}...` : message;
}

function pushAiExtractionWarning(warnings: string[], warning: string) {
  if (warnings.length >= PROFILE_AI_WARNING_LIMIT) return;
  warnings.push(warning);
}

async function _searchProfileRowWebLinks(
  input: EnrichWebRowInput,
  signal?: AbortSignal,
): Promise<ProfileWebLinksSearchResult> {
  const warnings: string[] = [];
  const startedAt = Date.now();

  if (!input.name.trim()) {
    return {
      webLinkResults: [],
      primaryResults: [],
      weakResults: [],
      rejectedCount: 0,
      identity: buildProfileSearchQueryWaves(input).identity,
      pipelineMode: "guarded",
      timing: { initialLinksMs: Date.now() - startedAt },
      queries: [],
      warnings: ["Tên vật tư trống."],
    };
  }

  const [domainPolicy, queryControls, pipelineMode] = await Promise.all([
    resolveSearchDomainPolicy(),
    resolveSearchQueryControls(),
    resolveSearchRelevancePipelineMode(),
  ]);
  const queryInput = { ...input };
  const waves = buildProfileSearchQueryWaves(queryInput, {
    domainPolicy,
    queryControls,
  });
  const legacyQueries = buildLegacyProfileSearchQueries(queryInput, {
    domainPolicy,
    queryControls,
  });
  const queryBudget = queryControls.interactiveMaxQueries;
  const firstQueries = (
    pipelineMode === "guarded" ? waves.wave1 : legacyQueries
  ).slice(0, queryBudget);
  let executedQueries: SearchQuery[] = [...firstQueries];

  if (firstQueries.length === 0) {
    return {
      webLinkResults: [],
      primaryResults: [],
      weakResults: [],
      rejectedCount: 0,
      identity: waves.identity,
      pipelineMode,
      timing: { initialLinksMs: Date.now() - startedAt },
      queries: [],
      warnings: ["Không tạo được truy vấn tìm kiếm."],
    };
  }

  const budgetSignal = AbortSignal.timeout(15_000);
  const searchSignal = signal
    ? AbortSignal.any([signal, budgetSignal])
    : budgetSignal;
  const searchResponse = await searchWebForProduct(firstQueries, searchSignal, {
    feature: "profile_search",
  });
  warnings.push(...searchResponse.warnings);
  const unsafeRejectedUrls = new Set(searchResponse.unsafeRejectedUrls ?? []);
  const rejectedUrls = await activeRejectedUrls(waves.identity.signature);
  const feedbackRejectedUrls = new Set<string>();
  const feedbackFiltered = searchResponse.results.filter((result) => {
    try {
      const normalizedUrl = normalizeMaterialSearchUrl(result.url);
      if (rejectedUrls.has(normalizedUrl)) {
        feedbackRejectedUrls.add(normalizedUrl);
        return false;
      }
      return true;
    } catch {
      feedbackRejectedUrls.add(result.url.trim());
      return false;
    }
  });
  const coarse = feedbackFiltered.map((candidate) => ({
    candidate,
    assessment: assessMaterialSearchCandidate({
      identity: waves.identity,
      candidate,
    }),
  }));
  const plausibleCount = coarse.filter(
    ({ assessment }) =>
      assessment.score >= 0.2 && assessment.hardRejects.length === 0,
  ).length;
  let mergedResults = feedbackFiltered;
  if (
    pipelineMode === "guarded" &&
    plausibleCount < 5 &&
    executedQueries.length < queryBudget &&
    !searchSignal.aborted
  ) {
    const remainingQueries = waves.wave2.slice(
      0,
      queryBudget - executedQueries.length,
    );
    executedQueries = [...executedQueries, ...remainingQueries];
    const wave2 = await searchWebForProduct(remainingQueries, searchSignal, {
      feature: "profile_search",
    });
    warnings.push(...wave2.warnings);
    for (const url of wave2.unsafeRejectedUrls ?? []) {
      unsafeRejectedUrls.add(url);
    }
    const wave2FeedbackFiltered = wave2.results.filter((result) => {
      try {
        const normalizedUrl = normalizeMaterialSearchUrl(result.url);
        if (rejectedUrls.has(normalizedUrl)) {
          feedbackRejectedUrls.add(normalizedUrl);
          return false;
        }
        return true;
      } catch {
        feedbackRejectedUrls.add(result.url.trim());
        return false;
      }
    });
    mergedResults = mergeWaveResults(feedbackFiltered, wave2FeedbackFiltered);
  }

  const rankingInput = {
    manufacturer: input.manufacturer ?? null,
    name: input.name,
    code: input.code ?? null,
    specText: input.specText ?? null,
    unit: input.unit ?? null,
    category: input.category ?? null,
    originCountry: input.originCountry ?? null,
    sourceUrl: null,
    profileSearch: true,
  };
  const initialRanked = rankSearchResults(
    mergedResults,
    rankingInput,
    searchResponse.domainPolicy ?? domainPolicy,
  );
  const plausible =
    pipelineMode === "legacy"
      ? initialRanked
      : initialRanked.filter((candidate) => {
          const assessment = assessMaterialSearchCandidate({
            identity: waves.identity,
            candidate,
          });
          return assessment.score >= 0.2 || assessment.aiOverrideEligible;
        });
  const deterministicRejectedUrls = new Set(
    initialRanked
      .filter((candidate) => !plausible.includes(candidate))
      .map((candidate) => candidate.url),
  );
  let fetchedRanked = plausible;
  try {
    fetchedRanked = await enrichSearchResultsWithFetchedContent(plausible, {
      fetchCount: 8,
      signal: searchSignal,
    });
  } catch {
    warnings.push("Một số nguồn chưa được xác minh nội dung trong 15 giây.");
  }
  const ranked = rankSearchResults(
    fetchedRanked,
    rankingInput,
    searchResponse.domainPolicy ?? domainPolicy,
  );
  const assessed = ranked.map((hit) => {
    const assessment = assessMaterialSearchCandidate({
      identity: waves.identity,
      candidate: hit,
    });
    return {
      hit,
      assessment:
        hit.fetchStatus === "verified" || assessment.tier === "rejected"
          ? assessment
          : { ...assessment, tier: "weak" as const },
    };
  });
  const primaryResults = assessed
    .filter(({ assessment }) => assessment.tier === "primary")
    .slice(0, PROFILE_TOP_LINKS)
    .map(({ hit, assessment }) =>
      toWebLink(hit, assessment, hit.fetchStatus ?? "unverified"),
    );
  const weakResults = assessed
    .filter(({ assessment }) => assessment.tier === "weak")
    .slice(0, PROFILE_TOP_LINKS)
    .map(({ hit, assessment }) =>
      toWebLink(hit, assessment, hit.fetchStatus ?? "unverified"),
    );
  const webLinkResults =
    pipelineMode === "legacy"
      ? ranked.slice(0, PROFILE_TOP_LINKS).map((hit) => {
          const assessment = assessMaterialSearchCandidate({
            identity: waves.identity,
            candidate: hit,
          });
          return toWebLink(
            hit,
            { ...assessment, tier: "primary" },
            hit.fetchStatus ?? "unverified",
          );
        })
      : [...primaryResults, ...weakResults];
  for (const { hit, assessment } of assessed) {
    if (assessment.tier === "rejected") deterministicRejectedUrls.add(hit.url);
  }
  const unsafeRejectedCount = unsafeRejectedUrls.size;
  const feedbackRejectedCount = feedbackRejectedUrls.size;
  const rejectedCount = new Set([
    ...unsafeRejectedUrls,
    ...feedbackRejectedUrls,
    ...deterministicRejectedUrls,
  ]).size;
  const auditPrimaryCount =
    pipelineMode === "legacy" ? webLinkResults.length : primaryResults.length;
  const auditWeakCount = pipelineMode === "legacy" ? 0 : weakResults.length;
  const searxng = await resolveSearxngSearchConfig();
  await recordSearchAuditLog({
    feature: "profile_search",
    provider: "guarded_pipeline",
    query: executedQueries.map((query) => query.query).join(" | "),
    engines: searxng.engines,
    language: searxng.language,
    resultCount: mergedResults.length,
    selectedResultCount: webLinkResults.length,
    durationMs: Date.now() - startedAt,
    status: webLinkResults.length > 0 ? "success" : "no_results",
    warnings,
    topResults: webLinkResults.slice(0, 8).map((result) => ({
      title: result.title,
      url: result.url,
      domain: result.domain,
      rankScore: result.assessment?.score ?? 0,
      reasons: result.assessment?.reasons ?? [],
    })),
    rankingPolicy: searchResponse.domainPolicy ?? domainPolicy,
    qualitySummary: {
      pipelineMode,
      primaryCount: auditPrimaryCount,
      weakCount: auditWeakCount,
      rejectedCount,
      unsafeRejectedCount,
      feedbackRejectedCount,
      aiPromotedCount: 0,
      initialLinksMs: Date.now() - startedAt,
    },
  });

  if (ranked.length === 0) {
    return {
      webLinkResults,
      primaryResults,
      weakResults,
      rejectedCount,
      identity: waves.identity,
      pipelineMode,
      timing: { initialLinksMs: Date.now() - startedAt },
      queries: executedQueries.map((query) => query.query),
      warnings,
    };
  }

  return {
    webLinkResults,
    primaryResults,
    weakResults,
    rejectedCount,
    identity: waves.identity,
    pipelineMode,
    timing: { initialLinksMs: Date.now() - startedAt },
    queries: executedQueries.map((query) => query.query),
    warnings,
  };
}

async function _extractProfileRowAiCandidates(
  input: EnrichWebRowInput,
  webLinkResults: WebLinkResult[],
  signal?: AbortSignal,
): Promise<ProfileAiCandidatesSearchResult> {
  if (webLinkResults.length === 0) {
    return {
      aiSearchCandidates: [],
      warnings: ["Không có nguồn web để trích xuất AI."],
    };
  }

  const provider = await resolveAiProvider("enrichment");
  const extractionWarnings: string[] = [];
  const identity = buildProfileSearchQueryWaves(input).identity;
  const deterministicPrimary = webLinkResults.filter(
    (link) => link.assessment?.tier === "primary",
  );
  let promoted: WebLinkResult[] = [];
  const ambiguous = webLinkResults.filter(
    (link) =>
      link.assessment != null &&
      ((link.assessment.score >= 0.2 && link.assessment.score < 0.75) ||
        link.assessment.aiOverrideEligible),
  );
  if (ambiguous.length > 0) {
    const rerankStartedAt = Date.now();
    try {
      const reranked = await rerankAmbiguousMaterialLinks({
        identity,
        candidates: ambiguous,
        signal,
      });
      promoted = reranked.promotedResults;
      if (promoted.length > 0) {
        const [config, policy, mode] = await Promise.all([
          resolveSearxngSearchConfig(),
          resolveSearchDomainPolicy(),
          resolveSearchRelevancePipelineMode(),
        ]);
        await recordSearchAuditLog({
          feature: "profile_search",
          provider: "ai_relevance_reranker",
          query: identity.name,
          engines: config.engines,
          language: config.language,
          resultCount: ambiguous.length,
          selectedResultCount: promoted.length,
          durationMs: Date.now() - rerankStartedAt,
          status: "success",
          topResults: promoted.map((link) => ({
            title: link.title,
            url: link.url,
            domain: link.domain,
            rankScore: link.assessment?.score ?? 0,
            reasons: link.aiDecision?.reasons ?? [],
          })),
          rankingPolicy: policy,
          qualitySummary: {
            pipelineMode: mode,
            primaryCount: 0,
            weakCount: 0,
            rejectedCount: 0,
            unsafeRejectedCount: 0,
            feedbackRejectedCount: 0,
            aiPromotedCount: promoted.length,
            initialLinksMs: 0,
          },
        });
      }
    } catch (error) {
      pushAiExtractionWarning(
        extractionWarnings,
        `AI đánh giá độ liên quan không khả dụng: ${extractionErrorMessage(error)}.`,
      );
    }
  }
  const validatedLinks = [...deterministicPrimary, ...promoted].filter(
    (link, index, values) =>
      values.findIndex((candidate) => candidate.url === link.url) === index,
  );
  if (validatedLinks.length === 0) {
    return {
      aiSearchCandidates: [],
      warnings: [
        "Không có nguồn đủ phù hợp để trích xuất dữ liệu.",
        ...extractionWarnings,
      ],
    };
  }
  const ranked = validatedLinks.map(webLinkToSearchResult);
  const linksToFetch = ranked.slice(0, PROFILE_FETCH_LINKS);
  const enrichedLinks = await runPool(linksToFetch, FETCH_CONCURRENCY, (link) =>
    enrichLinkWithFetch(link, signal),
  );

  const enrichmentInput = enrichmentInputFromRow(input);
  const extractedCandidates = await runPool(
    enrichedLinks,
    EXTRACT_CONCURRENCY,
    async (link) => {
      try {
        const extracted = await extractProductFromSources(
          enrichmentInput,
          [link],
          provider,
          signal,
        );
        const mapped = mapExtractedToFillable(extracted, [link.url]);
        const fieldConfidences = fieldConfidencesFromExtracted(extracted);
        const catalogEvidenceUrls = verifiedCatalogUrlsFromSources(
          mapped.catalogPdfUrls,
          [link],
        );
        const hasFields = Object.keys(mapped.fields).some(
          (field) => field !== "sourceUrl",
        );
        const hasPdfs = mapped.catalogPdfUrls.length > 0;
        if (!hasFields && !hasPdfs) {
          pushAiExtractionWarning(
            extractionWarnings,
            `AI không tìm thấy trường/PDF dùng được từ ${sourceLabel(link)}.`,
          );
          return null;
        }
        const candidate: AiSearchStoredResult = {
          fields: mapped.fields,
          sourceUrls: mapped.sourceUrls,
          evidence: mapped.evidence,
          catalogPdfUrls:
            mapped.catalogPdfUrls.length > 0
              ? mapped.catalogPdfUrls
              : undefined,
          catalogEvidenceUrls:
            catalogEvidenceUrls.length > 0 ? catalogEvidenceUrls : undefined,
          fieldConfidences,
          title: link.title,
          url: link.url,
          snippet: link.snippet,
          rankScore: link.rankScore,
          relevanceDecision: promoted.find(
            (candidate) => candidate.url === link.url,
          )?.aiDecision,
        };
        return candidate;
      } catch (error) {
        pushAiExtractionWarning(
          extractionWarnings,
          `AI không trích xuất được nguồn ${sourceLabel(link)}: ${extractionErrorMessage(error)}.`,
        );
        return null;
      }
    },
  );

  const aiSearchCandidates = extractedCandidates.filter(
    (item): item is AiSearchStoredResult => item != null,
  );

  const sheetFields: Partial<Record<FillableField, string>> = {
    code: input.code,
    manufacturer: input.manufacturer,
    unit: input.unit,
    category: input.category,
    specText: input.specText,
    originCountry: input.originCountry,
  };

  aiSearchCandidates.sort(
    (left, right) =>
      scoreAiCandidateCompletion(right, sheetFields, input.name) -
      scoreAiCandidateCompletion(left, sheetFields, input.name),
  );

  const bestScore =
    aiSearchCandidates.length > 0
      ? scoreAiCandidateCompletion(
          aiSearchCandidates[0]!,
          sheetFields,
          input.name,
        )
      : 0;
  const recommendedCandidateKey =
    bestScore >= RELIABLE_SEARCH_MATCH_THRESHOLD ? "ai:0" : undefined;
  const warnings =
    aiSearchCandidates.length > 0 && !recommendedCandidateKey
      ? ["Có kết quả nhưng chưa đạt ngưỡng tin cậy 75%."]
      : [];

  return {
    aiSearchCandidates,
    recommendedCandidateKey,
    warnings: [...warnings, ...extractionWarnings],
  };
}

async function _enrichProfileRowSearch(
  input: EnrichWebRowInput,
  signal?: AbortSignal,
): Promise<EnrichProfileRowSearchResult> {
  const web = await searchProfileRowWebLinks(input, signal);
  if (web.webLinkResults.length === 0) {
    return {
      webLinkResults: web.webLinkResults,
      aiSearchCandidates: [],
      warnings: web.warnings,
    };
  }

  try {
    const ai = await extractProfileRowAiCandidates(
      input,
      web.webLinkResults,
      signal,
    );
    return {
      webLinkResults: web.webLinkResults,
      aiSearchCandidates: ai.aiSearchCandidates,
      recommendedCandidateKey: ai.recommendedCandidateKey,
      warnings: [...web.warnings, ...ai.warnings],
    };
  } catch (error) {
    return {
      webLinkResults: web.webLinkResults,
      aiSearchCandidates: [],
      warnings: [
        ...web.warnings,
        error instanceof Error
          ? error.message
          : "Không cấu hình AI enrichment.",
      ],
    };
  }
}

export const searchProfileRowWebLinks = traceFn(
  log,
  "searchProfileRowWebLinks",
  _searchProfileRowWebLinks,
);
export const extractProfileRowAiCandidates = traceFn(
  log,
  "extractProfileRowAiCandidates",
  _extractProfileRowAiCandidates,
);

export const enrichProfileRowSearch = traceFn(
  log,
  "enrichProfileRowSearch",
  _enrichProfileRowSearch,
);
