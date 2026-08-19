import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Globe, Loader2, Save, Sparkles } from "lucide-react";

import { FieldCompareEditor } from "~/app/_components/enrich/field-compare-editor";
import { ProfileScrapeInlineLayer } from "~/app/_components/material-profiles/profile-scrape-inline-layer";
import type { ProfileScrapedProductPickerItem } from "~/app/_components/material-profiles/profile-scraped-product-picker";
import {
  ManualProductForm,
  type ManualProductValues,
} from "~/app/_components/enrich/manual-product-dialog";
import { type EnrichCandidate } from "~/app/_components/enrich/product-candidate-card";
import { planForCandidate } from "~/app/_components/materials/review/review-plan";
import type { SearchSourceCandidate } from "~/app/_components/materials/review/search-source-candidate-card";
import type {
  ReviewRow,
  ReviewSearchMode,
} from "~/app/_components/materials/review/review-types";
import { Button } from "~/app/_components/ui";
import { useToast } from "~/app/_components/ui/toast";
import {
  applyAllProposedFieldsWithCurrency,
  applySavedMaterialToDecision,
  effectiveAcceptedFieldValues,
  profileAcceptedFields,
  profileEffectiveFieldValues,
  webFieldsAfterGapFill,
} from "~/lib/materials/enrich-gap-fill";
import {
  candidateToFields,
  FIELD_LABELS,
  type FillableField,
  FILLABLE_FIELDS,
} from "~/lib/materials/excel-enrich-fields";
import {
  deserializeRowDecision,
  serializeRowDecision,
  type RowDecision,
} from "~/lib/materials/review-decision";
import { formatMoney, parseOptionalNumber } from "~/lib/materials/format";
import {
  aiCandidateMatchChips,
  catalogCandidateScore,
  markTopRecommended,
  parseSearchCandidateKey,
  searchCandidateKey,
  sortCandidatesByScore,
  webLinkMatchChips,
} from "~/lib/materials/search-candidate-match";
import { simpleSimilarity } from "~/lib/materials/option-matcher";
import {
  findProfileCandidateCapture,
  findProfileCandidateCaptureByProductKey,
  hasCapturedProductDetails,
  profileCandidateCaptureKey,
} from "~/lib/materials/profile-candidate-capture";
import { missingProfileMaterialSaveFields } from "~/lib/materials/profile-scrape-capture";
import {
  scrapedProductKey,
  type ProfileScrapedProduct,
} from "~/lib/materials/profile-scrape-types";
import { api } from "~/trpc/react";

function aiPriceLabel(fields: Partial<Record<FillableField, string>>) {
  const raw = fields.defaultUnitPrice?.trim();
  if (!raw) return undefined;
  const normalized = raw
    .replace(/\s/g, "")
    .replace(/\./g, "")
    .replace(/,/g, "");
  const parsed = parseOptionalNumber(normalized);
  if (parsed == null) return undefined;
  return formatMoney(parsed, fields.currency?.trim() ?? "VND");
}

function profileSearchFields(decision: RowDecision | undefined) {
  return {
    webLinkResults: decision?.webLinkResults,
    webLinksStatus: decision?.webLinksStatus,
    aiSearchResult: decision?.aiSearchResult,
    aiSearchCandidates: decision?.aiSearchCandidates,
    aiSearchStatus: decision?.aiSearchStatus,
    scrapeResults: decision?.scrapeResults,
    selectedScrapeProductKey: decision?.selectedScrapeProductKey,
    acceptedProfileFields: decision?.acceptedProfileFields,
    editedProfileValues: decision?.editedProfileValues,
    catalogPdfUrls: decision?.catalogPdfUrls,
  };
}

function aiCandidatesFromDecision(decision: RowDecision | undefined) {
  if (decision?.aiSearchCandidates?.length) {
    return decision.aiSearchCandidates;
  }
  if (decision?.aiSearchResult) {
    return [decision.aiSearchResult];
  }
  return [];
}

function trimmedOrUndefined(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed;
}

function formattedCaptureTime(value: string | undefined) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function profileScrapedProduct(value: unknown): ProfileScrapedProduct | null {
  if (!value || typeof value !== "object") return null;
  const product = value as Partial<ProfileScrapedProduct>;
  if (!product.name || !product.sourceUrl) return null;
  return {
    name: product.name,
    unit: product.unit ?? null,
    category: product.category ?? null,
    specText: product.specText ?? "",
    manufacturer: product.manufacturer ?? null,
    originCountry: product.originCountry ?? null,
    price: product.price ?? null,
    priceText: product.priceText ?? null,
    currency: product.currency?.trim() ? product.currency : "VND",
    sourceUrl: product.sourceUrl,
    imageUrl: product.imageUrl ?? null,
    sku: product.sku ?? null,
    model: product.model ?? null,
    shopCategory: product.shopCategory ?? null,
    catalogPdfUrls: product.catalogPdfUrls ?? [],
  };
}

function materialProfileSaveResolution({
  row,
  name: proposedName,
  effective,
}: {
  row: ReviewRow;
  name?: string;
  effective: Partial<Record<FillableField, string>>;
}) {
  const name = trimmedOrUndefined(proposedName) ?? row.name.trim();
  const unit = effective.unit?.trim() ?? row.sheetFields.unit?.trim() ?? "";
  const specText =
    effective.specText?.trim() ?? row.sheetFields.specText?.trim() ?? "";
  const sourceUrl = effective.sourceUrl?.trim() ?? "";
  const missing = missingProfileMaterialSaveFields({
    code: effective.code ?? "",
    name,
    unit,
    specText,
    sourceUrl,
  });
  const reasons =
    missing.length > 0 ? [`Chưa đủ dữ liệu: ${missing.join(", ")}.`] : [];
  if (sourceUrl) {
    try {
      const url = new URL(sourceUrl);
      if (!["http:", "https:"].includes(url.protocol)) {
        reasons.push("URL nguồn không hợp lệ.");
      }
    } catch {
      reasons.push("URL nguồn không hợp lệ.");
    }
  }
  return {
    complete: missing.length === 0,
    promotable: reasons.length === 0,
    status:
      reasons.length === 0
        ? ("saved" as const)
        : ("needs_verification" as const),
    reasons,
  };
}

export function MatchChooser({
  row,
  workspaceId,
  decision,
  onChange,
  searchMode = "default",
  onWebSearch,
  onWebLinksSearch,
  onAiSearch,
  isWebSearchPending,
  isWebLinksPending,
  isAiSearchPending,
  isSearchBusy = false,
  onCapturePendingChange,
  onFlushCurrentDecision,
}: {
  row: ReviewRow;
  workspaceId?: number;
  decision: RowDecision | undefined;
  onChange: (next: RowDecision) => void;
  searchMode?: ReviewSearchMode;
  onWebSearch?: () => void;
  onWebLinksSearch?: (options?: { customQueries?: string[] }) => void;
  onAiSearch?: () => void;
  isWebSearchPending?: boolean;
  isWebLinksPending?: boolean;
  isAiSearchPending?: boolean;
  isSearchBusy?: boolean;
  onCapturePendingChange?: (pending: boolean) => void;
  onFlushCurrentDecision?: () => void | Promise<void>;
}) {
  const toast = useToast();
  const materialSaveHintId = useId();
  const utils = api.useUtils();
  const [searchTerm, setSearchTerm] = useState("");
  const [manualSourceUrl, setManualSourceUrl] = useState("");
  const [customQueriesText, setCustomQueriesText] = useState("");
  const [debounced, setDebounced] = useState("");
  const [startingCandidateKeys, setStartingCandidateKeys] = useState(
    () => new Set<string>(),
  );
  const [expandedScrapeSourceKey, setExpandedScrapeSourceKey] = useState<
    string | null
  >(null);
  const [pendingProductKey, setPendingProductKey] = useState<string | null>(
    null,
  );
  const [removingProductKey, setRemovingProductKey] = useState<string | null>(
    null,
  );
  const [rejectingSearchCandidateKey, setRejectingSearchCandidateKey] =
    useState<string | null>(null);
  const rejectingSearchCandidateKeyRef = useRef<string | null>(null);
  const handledCaptureRunIdsRef = useRef(new Set<string>());
  const decisionRef = useRef(decision);
  decisionRef.current = decision;
  const onCapturePendingChangeRef = useRef(onCapturePendingChange);
  onCapturePendingChangeRef.current = onCapturePendingChange;
  const isProfileSplit = searchMode === "profileSplit";

  useEffect(() => {
    const id = setTimeout(() => setDebounced(searchTerm.trim()), 300);
    return () => clearTimeout(id);
  }, [searchTerm]);

  useEffect(
    () => () => {
      onCapturePendingChangeRef.current?.(false);
    },
    [],
  );

  const searchQuery = api.material.enrichSearchMaterials.useQuery(
    { query: debounced },
    { enabled: debounced.length > 0 },
  );
  const upsertMaterial = api.material.upsertMaterial.useMutation();
  const persistReviewDecision =
    api.materialProfile.updateItemReviewDecision.useMutation();
  const rejectSearchResult =
    api.materialProfile.rejectSearchResult.useMutation();
  const restoreSearchResult =
    api.materialProfile.restoreSearchResult.useMutation();
  const inspectManualSource =
    api.materialProfile.inspectManualSource.useMutation();
  const createSavePreview =
    api.materialProfile.createMaterialSavePreview.useMutation();
  const commitSaveBatch =
    api.materialProfile.commitMaterialSaveBatch.useMutation();
  const cancelSaveBatch =
    api.materialProfile.cancelMaterialSaveBatch.useMutation();
  const recentSaveBatches =
    api.materialProfile.listMaterialSaveBatches.useQuery(
      { workspaceId: workspaceId ?? 0, limit: 10 },
      { enabled: isProfileSplit && workspaceId != null },
    );
  const scrapeHistoryQuery = api.materialProfile.getScrapeHistory.useQuery(
    { workspaceId: workspaceId ?? 0, itemId: row.key },
    {
      enabled: isProfileSplit && workspaceId != null,
      refetchInterval: (query) =>
        query.state.data?.some(
          (run) => run.status === "queued" || run.status === "running",
        )
          ? 1_000
          : false,
      refetchOnWindowFocus: false,
      staleTime: 0,
    },
  );
  const scrapeHistory = scrapeHistoryQuery.data;
  const latestScrapeRunsBySource = useMemo(() => {
    const runs = new Map<string, NonNullable<typeof scrapeHistory>[number]>();
    for (const run of scrapeHistory ?? []) {
      if (run.sourceCandidateKey && !runs.has(run.sourceCandidateKey)) {
        runs.set(run.sourceCandidateKey, run);
      }
    }
    return runs;
  }, [scrapeHistory]);
  const activeScrapeRuns = (scrapeHistory ?? []).filter(
    (run) => run.status === "queued" || run.status === "running",
  );
  const anyScrapePending =
    startingCandidateKeys.size > 0 || activeScrapeRuns.length > 0;
  const capturingSearchCandidateKey = anyScrapePending ? "multiple" : null;
  const startScrapeJob = api.materialProfile.startScrapeJob.useMutation();
  const attachPdfSource =
    api.materialProfile.attachCatalogPdfSource.useMutation({
      onSuccess: (serialized) => {
        const next = deserializeRowDecision(serialized);
        if (next) onChange(next);
        toast.success("Đã thêm catalog PDF làm bằng chứng.");
      },
      onError: (error) => {
        toast.error(error.message || "Không thể gắn catalog PDF.");
      },
    });
  const cancelScrapeJob = api.materialProfile.cancelScrapeJob.useMutation({
    onSuccess: () => void scrapeHistoryQuery.refetch(),
  });
  const retryScrapeRuns = api.materialProfile.retryScrapeRuns.useMutation({
    onSuccess: () => void scrapeHistoryQuery.refetch(),
  });
  const selectScrapedProduct =
    api.materialProfile.selectScrapedProduct.useMutation();
  const activateScrapedProduct =
    api.materialProfile.activateScrapedProduct.useMutation();
  const removeScrapedProduct =
    api.materialProfile.removeScrapedProduct.useMutation();

  const selectedSearchCandidateKey =
    decision?.selectedSearchCandidateKey ?? null;
  useEffect(() => {
    const unhandled = (scrapeHistory ?? []).filter(
      (run) =>
        run.status === "completed" &&
        !handledCaptureRunIdsRef.current.has(run.id),
    );
    if (unhandled.length === 0 || workspaceId == null) return;
    unhandled.forEach((run) => handledCaptureRunIdsRef.current.add(run.id));
    void utils.materialProfile.get.fetch({ workspaceId }).then((workspace) => {
      const item = workspace.items.find((entry) => entry.id === row.key);
      const next = deserializeRowDecision(item?.reviewDecisionJson);
      const current = decisionRef.current;
      if (next?.scrapeResults && current) {
        onChange({ ...current, scrapeResults: next.scrapeResults });
      }
    });
  }, [
    scrapeHistory,
    onChange,
    row.key,
    utils.materialProfile.get,
    workspaceId,
  ]);

  useEffect(() => {
    onCapturePendingChangeRef.current?.(anyScrapePending);
  }, [anyScrapePending]);

  const selectedId =
    selectedSearchCandidateKey == null &&
    (decision?.selectedSource === "catalog" || decision?.selectedSource == null)
      ? (decision?.materialId ?? null)
      : null;
  const parsedSearchKey = parseSearchCandidateKey(selectedSearchCandidateKey);
  const aiCandidates = aiCandidatesFromDecision(decision);
  const selectedAiCandidate =
    parsedSearchKey?.source === "ai"
      ? (aiCandidates[Number(parsedSearchKey.id)] ?? null)
      : null;
  const selectedWebScrape =
    findProfileCandidateCaptureByProductKey(
      decision?.scrapeResults,
      decision?.selectedScrapeProductKey,
    ) ?? null;
  const storedAccepted = decision?.acceptedFields ?? new Set<FillableField>();
  const storedAcceptedProfileFields =
    decision?.acceptedProfileFields ?? new Set<"name" | "imageUrl">();
  const overwrite = decision?.overwriteFields ?? new Set<FillableField>();
  const editedValues = decision?.editedValues ?? {};
  const webProposedFields = decision?.webProposedFields ?? {};
  const webEvidence = decision?.webEvidence ?? [];
  const webSearchStatus = decision?.webSearchStatus;
  const profileFields = profileSearchFields(decision);
  const linkedCatalogPdfUrls = row.linkedCatalogPdfUrls ?? [];

  const sheetFields: Partial<Record<FillableField, string>> = row.sheetFields;

  const searchCandidates = (searchQuery.data?.candidates ??
    []) as EnrichCandidate[];
  const showingSearch = debounced.length > 0;
  const cards: EnrichCandidate[] = showingSearch
    ? searchCandidates
    : isProfileSplit
      ? [...row.candidates].sort(
          (left, right) =>
            catalogCandidateScore(right.score) -
            catalogCandidateScore(left.score),
        )
      : row.candidates;

  const selectedCandidate =
    selectedId != null
      ? (cards.find((candidate) => candidate.materialId === selectedId) ??
        row.candidates.find(
          (candidate) => candidate.materialId === selectedId,
        ) ??
        null)
      : null;

  const catalogFields = selectedCandidate
    ? candidateToFields(selectedCandidate)
    : null;

  const editorProposedFields =
    selectedAiCandidate != null
      ? selectedAiCandidate.fields
      : selectedWebScrape != null
        ? selectedWebScrape.fields
        : webProposedFields;
  const profileNameAfter =
    decision?.editedProfileValues?.name ??
    selectedWebScrape?.name ??
    selectedAiCandidate?.title ??
    selectedCandidate?.name ??
    row.name;
  const profileImageAfter =
    decision?.editedProfileValues?.imageUrl ??
    selectedWebScrape?.imageUrl ??
    selectedCandidate?.imageUrl ??
    "";
  const accepted = isProfileSplit
    ? profileAcceptedFields(sheetFields, catalogFields, {
        editedValues,
        webProposedFields: editorProposedFields,
      })
    : storedAccepted;
  const acceptedProfileFields = isProfileSplit
    ? new Set<"name" | "imageUrl">([
        "name",
        ...(profileImageAfter.trim() ? (["imageUrl"] as const) : []),
      ])
    : storedAcceptedProfileFields;
  const sourceProvenance =
    decision?.selectedSource === "web" && selectedWebScrape
      ? "Scrape"
      : decision?.selectedSource === "ai"
        ? "AI"
        : decision?.selectedSource === "catalog"
          ? "Danh mục"
          : "Thủ công";
  const fieldProvenance = Object.fromEntries(
    FILLABLE_FIELDS.map((field) => {
      const edited = decision?.editedValues?.[field];
      const proposed = editorProposedFields[field];
      if (edited === undefined && !proposed?.trim()) return [field, undefined];
      return [
        field,
        edited !== undefined && edited.trim() !== proposed?.trim()
          ? "Thủ công"
          : sourceProvenance,
      ];
    }),
  ) as Partial<Record<FillableField, string>>;

  const profileSearchRunning = [isWebLinksPending, isAiSearchPending].some(
    (v) => v === true,
  );

  const searchSourceCandidates = useMemo((): SearchSourceCandidate[] => {
    if (!isProfileSplit) return [];

    const items: SearchSourceCandidate[] = [];
    const links = decision?.webLinkResults ?? [];

    if (profileSearchRunning && links.length === 0) {
      items.push({
        key: "web:pending",
        source: "web",
        title: row.name.trim() || "Đang tìm web",
        subtitle: "Đang tìm liên kết…",
        fillCount: 0,
        score: 0,
        chips: [],
        status: "pending",
      });
    } else {
      links.forEach((link) => {
        const { score: assessedScore, chips } = webLinkMatchChips(
          link,
          row.name,
          sheetFields,
        );
        const linkedScrape = findProfileCandidateCapture(
          decision?.scrapeResults,
          link.url,
        );
        const linkedPriceLabel = linkedScrape
          ? aiPriceLabel(linkedScrape.fields)
          : undefined;
        items.push({
          key: searchCandidateKey("web", link.url),
          source: "web",
          title: link.title.trim() || link.url,
          subtitle: link.snippet,
          fillCount: 0,
          score: assessedScore,
          chips,
          sourceUrl: link.url,
          priceLabel: linkedPriceLabel,
          priceStatus: linkedScrape
            ? linkedPriceLabel
              ? "available"
              : "not_found"
            : "unchecked",
          capturedAt: formattedCaptureTime(linkedScrape?.capturedAt),
          isCaptured:
            (linkedScrape != null && hasCapturedProductDetails(linkedScrape)) ||
            (/\.pdf(?:$|[?#])/i.test(link.url) &&
              Boolean(decision?.catalogPdfUrls?.includes(link.url))),
          isRecommended: false,
          tier: link.assessment?.tier === "weak" ? "weak" : "primary",
          providerLabel:
            link.provider === "bing"
              ? "Bing cứu hộ"
              : link.provider === "manual"
                ? "URL thủ công"
                : link.provider === "known_source"
                  ? "nguồn đã biết"
                  : link.engines?.length
                    ? `SearXNG · ${link.engines.join(", ")}`
                    : link.provider === "searxng"
                      ? "SearXNG"
                      : undefined,
          debug: link.assessment ? (
            <>
              <p>
                Điểm vật tư: {(link.assessment.score * 100).toFixed(0)}% · RRF:{" "}
                {link.rrfScore?.toFixed(4) ?? "—"} · Nội dung:{" "}
                {link.fetchStatus === "verified"
                  ? "Đã xác minh"
                  : "Chưa xác minh nội dung"}
              </p>
              <p>
                Identity {link.assessment.dimensions.identity.toFixed(2)} · Spec{" "}
                {link.assessment.dimensions.specification.toFixed(2)} · Trust{" "}
                {link.assessment.dimensions.sourceTrust.toFixed(2)} · Consensus{" "}
                {link.assessment.dimensions.retrievalConsensus.toFixed(2)}
              </p>
              {link.assessment.conflicts.length > 0 ? (
                <p>Xung đột: {link.assessment.conflicts.join(" · ")}</p>
              ) : null}
              {(link.matchedQueries ?? []).map((match) => (
                <p key={`${match.query}-${match.rank}`}>
                  #{match.rank} {match.intent}: {match.query}
                </p>
              ))}
              {link.aiDecision ? (
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap">
                  {JSON.stringify(link.aiDecision, null, 2)}
                </pre>
              ) : null}
            </>
          ) : undefined,
          status:
            decision?.webLinksStatus === "error" ? "error" : ("done" as const),
        });
      });
    }

    if (profileSearchRunning && aiCandidates.length === 0) {
      items.push({
        key: "ai:pending",
        source: "ai",
        title: row.name.trim() || "Đang tìm AI",
        subtitle: "Đang trích xuất từng nguồn…",
        fillCount: 0,
        score: 0,
        chips: [],
        status: "pending",
      });
    } else {
      aiCandidates.forEach((candidate, index) => {
        const { score, chips } = aiCandidateMatchChips(
          candidate,
          sheetFields,
          row.name,
        );
        const fillCount = Object.values(candidate.fields).filter(
          (value) => (value ?? "").trim().length > 0,
        ).length;
        const previewField = [
          candidate.fields.manufacturer,
          candidate.fields.code,
          candidate.title,
        ]
          .map((value) => value?.trim())
          .find((value) => (value?.length ?? 0) > 0);
        const snippet = candidate.snippet?.trim() ?? "";
        const priceLabel = aiPriceLabel(candidate.fields);
        items.push({
          key: searchCandidateKey("ai", String(index)),
          source: "ai",
          title: previewField ?? row.name.trim() ?? `Kết quả AI ${index + 1}`,
          subtitle:
            snippet.length > 0
              ? snippet
              : `${Object.values(candidate.fields).filter((value) => (value ?? "").trim()).length} trường trích xuất`,
          fillCount,
          score,
          chips,
          sourceUrl: candidate.url ?? candidate.sourceUrls[0],
          priceLabel,
          priceStatus: priceLabel ? "available" : "not_found",
          capturedAt:
            candidate.url === selectedWebScrape?.sourceUrl
              ? formattedCaptureTime(selectedWebScrape?.capturedAt)
              : undefined,
          isRecommended: false,
          debug: candidate.relevanceDecision ? (
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap">
              {JSON.stringify(candidate.relevanceDecision, null, 2)}
            </pre>
          ) : undefined,
          status:
            fillCount > 0
              ? "done"
              : decision?.aiSearchStatus === "error"
                ? "error"
                : "done",
        });
      });
    }

    if (
      !profileSearchRunning &&
      decision?.webLinksStatus === "error" &&
      links.length === 0
    ) {
      items.push({
        key: "web:error",
        source: "web",
        title: "Tìm web thất bại",
        subtitle: "Không có liên kết",
        fillCount: 0,
        score: 0,
        chips: [],
        status: "error",
      });
    }

    return markTopRecommended(sortCandidatesByScore(items));
  }, [
    aiCandidates,
    decision?.aiSearchStatus,
    decision?.catalogPdfUrls,
    decision?.webLinkResults,
    decision?.webLinksStatus,
    decision?.scrapeResults,
    isProfileSplit,
    profileSearchRunning,
    row.name,
    selectedWebScrape?.capturedAt,
    selectedWebScrape?.sourceUrl,
    sheetFields,
  ]);

  const selectedSearchCandidate = selectedSearchCandidateKey
    ? (searchSourceCandidates.find(
        (candidate) => candidate.key === selectedSearchCandidateKey,
      ) ?? null)
    : null;

  const afterColumnLabel =
    selectedSearchCandidate?.source === "ai"
      ? "Sau (AI)"
      : selectedSearchCandidate?.source === "web"
        ? selectedWebScrape
          ? "Sau (Scrape)"
          : "Sau (Web)"
        : selectedCandidate
          ? `Sau (${selectedCandidate.name})`
          : "Sau";
  const choose = (candidate: EnrichCandidate) => {
    const candidateFields = candidateToFields(candidate);
    if (isProfileSplit) {
      const { acceptedFields, editedValues: nextEdited } =
        applyAllProposedFieldsWithCurrency(candidateFields);
      onChange({
        materialId: candidate.materialId,
        selectedSource: "catalog",
        selectedSearchCandidateKey: undefined,
        acceptedFields,
        overwriteFields: new Set(),
        editedValues: nextEdited,
        webProposedFields,
        webEvidence,
        webSearchStatus,
        ...profileFields,
        selectedScrapeProductKey: null,
        acceptedProfileFields: new Set([
          "name",
          ...(candidate.imageUrl ? (["imageUrl"] as const) : []),
        ]),
        editedProfileValues: undefined,
      });
      return;
    }

    const { fillable } = planForCandidate(sheetFields, candidate);
    const webGaps = webFieldsAfterGapFill(
      sheetFields,
      candidateFields,
      webProposedFields,
    );
    const nextAccepted = new Set(fillable);
    const nextEdited = { ...editedValues };
    for (const [field, value] of Object.entries(webGaps)) {
      const fillableField = field as FillableField;
      nextAccepted.add(fillableField);
      if (!(fillableField in nextEdited)) {
        nextEdited[fillableField] = value;
      }
    }
    onChange({
      materialId: candidate.materialId,
      selectedSource: "catalog",
      selectedSearchCandidateKey: undefined,
      acceptedFields: nextAccepted,
      overwriteFields: new Set(),
      editedValues: nextEdited,
      webProposedFields,
      webEvidence,
      webSearchStatus,
      ...profileFields,
      selectedScrapeProductKey: null,
    });
  };

  const chooseSearchCandidate = (key: string) => {
    const parsed = parseSearchCandidateKey(key);
    if (!parsed) return;

    if (parsed.source === "web") {
      const link = decision?.webLinkResults?.find(
        (item) => item.url === parsed.id,
      );
      if (!link) {
        toast.warning("Chưa có liên kết web để chọn.");
        return;
      }
      if (link.assessment?.tier === "weak") {
        toast.warning(
          "Nguồn này cần kiểm tra thủ công vì độ liên quan còn thấp.",
        );
      }

      const nextEdited: Partial<Record<FillableField, string>> = {
        sourceUrl: link.url,
      };
      onChange({
        materialId: decision?.materialId ?? null,
        selectedSource: "web",
        selectedSearchCandidateKey: key,
        acceptedFields: new Set<FillableField>(["sourceUrl"]),
        overwriteFields: new Set(),
        editedValues: nextEdited,
        webProposedFields: { sourceUrl: link.url },
        webEvidence: [],
        webSearchStatus,
        ...profileFields,
        selectedScrapeProductKey: null,
        catalogPdfUrls: decision?.catalogPdfUrls,
        acceptedProfileFields: new Set(),
        editedProfileValues: undefined,
      });
      return;
    }

    const index = Number(parsed.id);
    const aiResult = aiCandidates[index];
    if (!aiResult) {
      toast.warning("Chưa có kết quả AI để chọn.");
      return;
    }
    const gapFields = applyAllProposedFieldsWithCurrency(aiResult.fields);
    onChange({
      materialId: decision?.materialId ?? null,
      selectedSource: "ai",
      selectedSearchCandidateKey: key,
      acceptedFields: gapFields.acceptedFields,
      overwriteFields: new Set(),
      editedValues: gapFields.editedValues,
      webProposedFields: { ...aiResult.fields },
      webEvidence: aiResult.evidence,
      webSearchStatus,
      ...profileFields,
      selectedScrapeProductKey: decision?.selectedScrapeProductKey ?? null,
      catalogPdfUrls: [
        ...new Set([
          ...(decision?.catalogPdfUrls ?? []),
          ...(aiResult.catalogPdfUrls ?? []),
        ]),
      ],
      aiSearchResult: aiResult,
      acceptedProfileFields: aiResult.title ? new Set(["name"]) : new Set(),
      editedProfileValues: undefined,
    });
  };

  const captureSearchCandidate = (key: string) => {
    const parsed = parseSearchCandidateKey(key);
    if (parsed?.source !== "web" || isWebLinksPending || isAiSearchPending) {
      return;
    }
    const link = decision?.webLinkResults?.find(
      (item) => item.url === parsed.id,
    );
    if (!link) {
      toast.warning("Chưa có liên kết web để thu thập thông tin.");
      return;
    }
    if (workspaceId == null) {
      toast.error("Thiếu mã hồ sơ vật tư để bắt đầu scrape.");
      return;
    }
    const candidateKey = profileCandidateCaptureKey(link.url);
    const latestRun = latestScrapeRunsBySource.get(candidateKey);
    const hasRetainedProducts = decision?.scrapeResults?.some(
      (result) => result.sourceCandidateKey === candidateKey,
    );
    if (!latestRun && hasRetainedProducts) {
      setExpandedScrapeSourceKey(candidateKey);
      return;
    }
    if (
      latestRun &&
      ["queued", "running", "awaiting_product_selection", "completed"].includes(
        latestRun.status,
      )
    ) {
      setExpandedScrapeSourceKey(candidateKey);
      return;
    }
    if (latestRun?.status === "failed") {
      setExpandedScrapeSourceKey(candidateKey);
      return;
    }
    setStartingCandidateKeys((current) => new Set(current).add(candidateKey));
    onCapturePendingChangeRef.current?.(true);
    if (/\.pdf(?:$|[?#])/i.test(link.url)) {
      attachPdfSource.mutate(
        {
          workspaceId,
          itemId: row.key,
          sourceUrl: link.url,
          sourceCandidateKey: candidateKey,
        },
        {
          onSettled: () =>
            setStartingCandidateKeys((current) => {
              const next = new Set(current);
              next.delete(candidateKey);
              return next;
            }),
        },
      );
      return;
    }
    startScrapeJob.mutate(
      {
        workspaceId,
        itemIds: [row.key],
        interactive: true,
        sourceUrl: link.url,
        sourceCandidateKey: candidateKey,
      },
      {
        onSuccess: () => {
          setExpandedScrapeSourceKey(candidateKey);
          void scrapeHistoryQuery.refetch();
        },
        onError: (error) =>
          toast.error(error.message || "Không thể bắt đầu scrape nguồn web."),
        onSettled: () =>
          setStartingCandidateKeys((current) => {
            const next = new Set(current);
            next.delete(candidateKey);
            return next;
          }),
      },
    );
  };

  const rejectSearchCandidate = (key: string) => {
    if (rejectingSearchCandidateKeyRef.current != null) return;
    const parsed = parseSearchCandidateKey(key);
    if (parsed?.source !== "web") return;
    const link = decision?.webLinkResults?.find(
      (item) => item.url === parsed.id,
    );
    if (!link) return;
    rejectingSearchCandidateKeyRef.current = key;
    setRejectingSearchCandidateKey(key);
    rejectSearchResult.mutate(
      { itemId: row.key, url: link.url, title: link.title },
      {
        onSuccess: (feedback) => {
          const next: RowDecision = {
            ...(decision ?? {
              materialId: null,
              acceptedFields: new Set(),
            }),
            webLinkResults: (decision?.webLinkResults ?? []).filter(
              (candidate) => candidate.url !== link.url,
            ),
            selectedSearchCandidateKey:
              decision?.selectedSearchCandidateKey === key
                ? undefined
                : decision?.selectedSearchCandidateKey,
          };
          onChange(next);
          void Promise.all([
            utils.materialProfile.get.invalidate(),
            utils.searchConfig.listSearchFeedback.invalidate(),
          ]);
          toast.success("Đã ẩn kết quả không liên quan.", {
            actionLabel: "Hoàn tác",
            onAction: () =>
              restoreSearchResult.mutate(
                { feedbackId: feedback.id },
                {
                  onSuccess: () => {
                    onChange({
                      ...(decisionRef.current ?? next),
                      webLinkResults: [
                        ...(decisionRef.current?.webLinkResults ??
                          next.webLinkResults ??
                          []),
                        link,
                      ].filter(
                        (candidate, index, values) =>
                          values.findIndex(
                            (value) => value.url === candidate.url,
                          ) === index,
                      ),
                    });
                    void utils.searchConfig.listSearchFeedback.invalidate();
                    toast.success("Đã khôi phục kết quả.");
                  },
                  onError: (mutationError) =>
                    toast.error(`Không thể hoàn tác: ${mutationError.message}`),
                },
              ),
          });
        },
        onError: (mutationError) => toast.error(mutationError.message),
        onSettled: () => {
          if (rejectingSearchCandidateKeyRef.current !== key) return;
          rejectingSearchCandidateKeyRef.current = null;
          setRejectingSearchCandidateKey(null);
        },
      },
    );
  };

  const addManualSource = async () => {
    if (workspaceId == null) {
      toast.error("Thiếu mã hồ sơ vật tư.");
      return;
    }
    const url = manualSourceUrl.trim();
    if (!url) {
      toast.warning("Nhập URL nguồn cần kiểm tra.");
      return;
    }
    try {
      const link = await inspectManualSource.mutateAsync({
        workspaceId,
        itemId: row.key,
        url,
      });
      const current = decisionRef.current ?? {
        materialId: null,
        acceptedFields: new Set<FillableField>(),
      };
      onChange({
        ...current,
        webLinkResults: [
          link,
          ...(current.webLinkResults ?? []).filter(
            (candidate) => candidate.url !== link.url,
          ),
        ],
        webLinksStatus: "done",
      });
      setManualSourceUrl("");
      toast.success("Đã thêm URL an toàn vào danh sách nguồn.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "URL nguồn không an toàn hoặc không hợp lệ.",
      );
    }
  };

  const runCustomQuerySearch = () => {
    const customQueries = customQueriesText
      .split("\n")
      .map((query) => query.trim().replace(/\s+/g, " "))
      .filter(Boolean)
      .slice(0, 6);
    if (customQueries.length === 0) {
      toast.warning("Nhập ít nhất một truy vấn, mỗi dòng một truy vấn.");
      return;
    }
    onWebLinksSearch?.({ customQueries });
  };

  const isSkipped = decision?.skipped === true;

  const toggleSkip = () => {
    onChange({
      materialId: null,
      selectedSource: undefined,
      selectedSearchCandidateKey: undefined,
      acceptedFields: new Set(),
      overwriteFields: new Set(),
      editedValues: {},
      webProposedFields: {},
      webEvidence: [],
      skipped: !isSkipped,
      ...profileFields,
      selectedScrapeProductKey: null,
    });
  };

  const toggleField = (field: FillableField) => {
    const next = new Set(accepted);
    const nextOverwrite = new Set(overwrite);
    if (next.has(field)) {
      next.delete(field);
      nextOverwrite.delete(field);
    } else {
      next.add(field);
    }
    onChange({
      materialId: decision?.materialId ?? selectedId,
      selectedSource: decision?.selectedSource,
      selectedSearchCandidateKey: decision?.selectedSearchCandidateKey,
      acceptedFields: next,
      overwriteFields: nextOverwrite,
      editedValues,
      webProposedFields: editorProposedFields,
      webEvidence,
      webSearchStatus,
      ...profileFields,
    });
  };

  const toggleOverwrite = (field: FillableField) => {
    const nextOverwrite = new Set(overwrite);
    const nextAccepted = new Set(accepted);
    if (nextOverwrite.has(field)) {
      nextOverwrite.delete(field);
      nextAccepted.delete(field);
    } else {
      nextOverwrite.add(field);
      nextAccepted.add(field);
    }
    onChange({
      materialId: decision?.materialId ?? selectedId,
      selectedSource: decision?.selectedSource,
      selectedSearchCandidateKey: decision?.selectedSearchCandidateKey,
      acceptedFields: nextAccepted,
      overwriteFields: nextOverwrite,
      editedValues,
      webProposedFields: editorProposedFields,
      webEvidence,
      webSearchStatus,
      ...profileFields,
    });
  };

  const editValue = (field: FillableField, value: string) => {
    const nextEdited = { ...editedValues, [field]: value };
    const nextAccepted = new Set(accepted);
    nextAccepted.add(field);
    onChange({
      materialId: decision?.materialId ?? selectedId,
      selectedSource: decision?.selectedSource,
      selectedSearchCandidateKey: decision?.selectedSearchCandidateKey,
      acceptedFields: nextAccepted,
      overwriteFields: overwrite,
      editedValues: nextEdited,
      webProposedFields: editorProposedFields,
      webEvidence,
      webSearchStatus,
      ...profileFields,
    });
  };

  const editCatalogPdfUrls = (raw: string) => {
    const urls = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    onChange({
      materialId: decision?.materialId ?? selectedId,
      selectedSource: decision?.selectedSource,
      selectedSearchCandidateKey: decision?.selectedSearchCandidateKey,
      acceptedFields: accepted,
      overwriteFields: overwrite,
      editedValues,
      webProposedFields: editorProposedFields,
      webEvidence,
      webSearchStatus,
      ...profileFields,
      catalogPdfUrls: urls.length > 0 ? urls : undefined,
    });
  };

  const toggleProfileField = (field: "name" | "imageUrl") => {
    const next = new Set(acceptedProfileFields);
    if (next.has(field)) next.delete(field);
    else next.add(field);
    onChange({
      ...(decision ?? {
        materialId: null,
        acceptedFields: new Set<FillableField>(),
      }),
      acceptedProfileFields: next,
    });
  };

  const editProfileValue = (field: "name" | "imageUrl", value: string) => {
    onChange({
      ...(decision ?? {
        materialId: null,
        acceptedFields: new Set<FillableField>(),
      }),
      acceptedProfileFields: new Set([...acceptedProfileFields, field]),
      editedProfileValues: {
        ...decision?.editedProfileValues,
        [field]: value,
      },
    });
  };

  const applyManualValues = (values: ManualProductValues) => {
    const nextAccepted = new Set<FillableField>();
    const nextEdited: Partial<Record<FillableField, string>> = {};
    for (const field of FILLABLE_FIELDS) {
      if (field === "currency") continue;
      const value = values[field]?.trim() ?? "";
      if (value) {
        nextEdited[field] = value;
        nextAccepted.add(field);
      }
    }
    onChange({
      materialId: isProfileSplit ? (decision?.materialId ?? null) : null,
      selectedSource: undefined,
      acceptedFields: nextAccepted,
      overwriteFields: new Set(),
      editedValues: nextEdited,
      webProposedFields: {},
      webEvidence: [],
      ...profileFields,
      selectedScrapeProductKey: null,
    });
  };

  const profileEffective = isProfileSplit
    ? profileEffectiveFieldValues(sheetFields, catalogFields, {
        acceptedFields: accepted,
        editedValues,
        webProposedFields: editorProposedFields,
      })
    : null;
  const profileTargetName = acceptedProfileFields.has("name")
    ? profileNameAfter
    : row.name;
  const targetLookupKeyword =
    [profileEffective?.code?.trim(), profileTargetName.trim()].find(Boolean) ??
    "";
  const targetLookup = api.material.searchMaterials.useQuery(
    {
      keyword: targetLookupKeyword,
      limit: 5,
      offset: 0,
    },
    {
      enabled: isProfileSplit && Boolean(targetLookupKeyword),
    },
  );
  const targetLookupPending =
    isProfileSplit && Boolean(targetLookupKeyword) && targetLookup.isLoading;
  const profileSaveTarget = useMemo(() => {
    if (!isProfileSplit) return null;
    const candidates = targetLookup.data ?? [];
    const linkedId = decision?.materialId ?? selectedId;
    if (linkedId != null) {
      const linked = candidates.find((material) => material.id === linkedId);
      const linkedCandidate = row.candidates.find(
        (material) => material.materialId === linkedId,
      );
      const linkedProfile =
        row.linkedMaterial?.id === linkedId ? row.linkedMaterial : undefined;
      return {
        material:
          linked ??
          (linkedCandidate
            ? {
                id: linkedCandidate.materialId,
                name: linkedCandidate.name,
                code: linkedCandidate.code,
                unit: linkedCandidate.unit,
                category: linkedCandidate.category,
                specText: linkedCandidate.specSnippet,
                manufacturer: linkedCandidate.manufacturer,
                originCountry: linkedCandidate.originCountry,
                defaultUnitPrice: linkedCandidate.defaultUnitPrice,
                currency: linkedCandidate.currency,
                sourceUrl: linkedCandidate.sourceUrl,
                imageUrl: linkedCandidate.imageUrl,
              }
            : (linkedProfile ?? { id: linkedId, name: "Vật tư đã liên kết" })),
        ambiguous: false,
      };
    }
    const code = profileEffective?.code?.trim().toLowerCase();
    const exact = code
      ? candidates.find(
          (material) => material.code?.trim().toLowerCase() === code,
        )
      : undefined;
    if (exact) return { material: exact, ambiguous: false };
    const ranked = candidates
      .map((material) => ({
        material,
        score:
          simpleSimilarity(profileTargetName, material.name) * 0.7 +
          simpleSimilarity(
            profileEffective?.specText ?? "",
            material.specText,
          ) *
            0.3,
      }))
      .sort((left, right) => right.score - left.score);
    if ((ranked[0]?.score ?? 0) < 0.85) return null;
    if (ranked[1] && ranked[0]!.score - ranked[1].score < 0.05) {
      return { material: null, ambiguous: true };
    }
    return { material: ranked[0]!.material, ambiguous: false };
  }, [
    decision?.materialId,
    isProfileSplit,
    profileEffective?.code,
    profileEffective?.specText,
    profileTargetName,
    row.candidates,
    row.linkedMaterial,
    selectedId,
    targetLookup.data,
  ]);
  const targetCatalogQuery = api.catalogDocument.listByMaterial.useQuery(
    { materialId: profileSaveTarget?.material?.id ?? 1 },
    {
      enabled: isProfileSplit && profileSaveTarget?.material?.id != null,
    },
  );
  const targetCatalogPdfUrls = (targetCatalogQuery.data ?? []).flatMap(
    (document) =>
      document.sourceUrl?.trim() ? [document.sourceUrl.trim()] : [],
  );
  const catalogPdfUrlsBefore = [
    ...new Set(
      [...linkedCatalogPdfUrls, ...targetCatalogPdfUrls]
        .map((url) => url.trim())
        .filter(Boolean),
    ),
  ];
  const proposedCatalogPdfUrls = selectedWebScrape
    ? selectedWebScrape.catalogPdfUrls
    : selectedAiCandidate
      ? (selectedAiCandidate.catalogPdfUrls ?? [])
      : selectedSearchCandidate?.sourceUrl &&
          /\.pdf(?:$|[?#])/i.test(selectedSearchCandidate.sourceUrl)
        ? [selectedSearchCandidate.sourceUrl]
        : [];
  const profileCatalogPdfUrls = [
    ...new Set(
      [
        ...catalogPdfUrlsBefore,
        ...(decision?.catalogPdfUrls ?? []),
        ...proposedCatalogPdfUrls,
      ]
        .map((url) => url.trim())
        .filter(Boolean),
    ),
  ];
  const catalogPdfAccepted = profileCatalogPdfUrls.length > 0;
  const catalogPdfWasEdited =
    catalogPdfAccepted &&
    proposedCatalogPdfUrls.length > 0 &&
    decision?.catalogPdfUrls != null &&
    [
      ...new Set(
        decision.catalogPdfUrls.map((url) => url.trim()).filter(Boolean),
      ),
    ]
      .sort()
      .join("\n") !==
      [
        ...new Set(
          [...catalogPdfUrlsBefore, ...proposedCatalogPdfUrls]
            .map((url) => url.trim())
            .filter(Boolean),
        ),
      ]
        .sort()
        .join("\n");
  const catalogPdfProvenance = catalogPdfWasEdited
    ? "Thủ công"
    : selectedWebScrape
      ? "Scrape"
      : selectedAiCandidate
        ? "AI"
        : selectedSearchCandidate?.sourceUrl &&
            /\.pdf(?:$|[?#])/i.test(selectedSearchCandidate.sourceUrl)
          ? "Danh mục"
          : decision?.catalogPdfUrls?.length
            ? "Thủ công"
            : catalogPdfUrlsBefore.length > 0
              ? "Danh mục"
              : undefined;
  const profileFinalEffective = { ...(profileEffective ?? {}) };
  const targetMaterial = profileSaveTarget?.material;
  const profileCompareBeforeFields = { ...sheetFields };
  if (targetMaterial) {
    const retainedFields: Array<
      [FillableField, string | number | null | undefined]
    > = [
      ["code", "code" in targetMaterial ? targetMaterial.code : undefined],
      ["unit", "unit" in targetMaterial ? targetMaterial.unit : undefined],
      [
        "category",
        "category" in targetMaterial ? targetMaterial.category : undefined,
      ],
      [
        "specText",
        "specText" in targetMaterial ? targetMaterial.specText : undefined,
      ],
      [
        "manufacturer",
        "manufacturer" in targetMaterial
          ? targetMaterial.manufacturer
          : undefined,
      ],
      [
        "originCountry",
        "originCountry" in targetMaterial
          ? targetMaterial.originCountry
          : undefined,
      ],
      [
        "defaultUnitPrice",
        "defaultUnitPrice" in targetMaterial
          ? targetMaterial.defaultUnitPrice
          : undefined,
      ],
      [
        "currency",
        "currency" in targetMaterial ? targetMaterial.currency : undefined,
      ],
      [
        "sourceUrl",
        "sourceUrl" in targetMaterial ? targetMaterial.sourceUrl : undefined,
      ],
    ];
    for (const [field, value] of retainedFields) {
      if (value != null) profileCompareBeforeFields[field] = String(value);
      if (!accepted.has(field) && value != null && String(value).trim()) {
        profileFinalEffective[field] = String(value);
      }
    }
  }
  const profileFinalName = !acceptedProfileFields.has("name")
    ? (targetMaterial?.name ?? row.name)
    : profileNameAfter;
  const profileSaveResolution = isProfileSplit
    ? materialProfileSaveResolution({
        row,
        name: profileFinalName,
        effective: profileFinalEffective,
      })
    : null;
  const conflictingSaveBatch = recentSaveBatches.data?.find((batch) =>
    ["draft", "queued", "running"].includes(batch.status),
  );
  const profileSaveHint = conflictingSaveBatch
    ? "Đang có bản xem trước hoặc đợt lưu chưa hoàn tất."
    : targetLookupPending
      ? "Đang kiểm tra vật tư đích trước khi lưu."
      : profileSaveResolution?.promotable
        ? profileSaveTarget?.ambiguous
          ? "Có nhiều vật tư đích gần điểm nhau; bản xem trước sẽ yêu cầu chọn đích."
          : profileSaveTarget?.material
            ? `Sẽ cập nhật vật tư #${profileSaveTarget.material.id} · ${profileSaveTarget.material.name}.`
            : "Sẽ tạo vật tư mới trong /materials."
        : (profileSaveResolution?.reasons[0] ??
          "Hoàn thiện các trường bắt buộc trước khi lưu.");

  const saveCurrentToMaterials = async () => {
    const effective = isProfileSplit
      ? profileFinalEffective
      : effectiveAcceptedFieldValues(sheetFields, catalogFields, {
          acceptedFields: accepted,
          editedValues,
          webProposedFields: editorProposedFields,
          overwriteFields: overwrite,
        });
    const unit = effective.unit?.trim() ?? sheetFields.unit?.trim() ?? "";
    const specText =
      effective.specText?.trim() ?? sheetFields.specText?.trim() ?? "";
    const name = (isProfileSplit ? profileFinalName : profileNameAfter).trim();
    if (!name) {
      toast.error("Tên vật tư không được để trống.");
      return;
    }
    if (!unit) {
      toast.error("ĐVT không được để trống.");
      return;
    }
    if (!isProfileSplit && accepted.size === 0) {
      toast.error("Chọn ít nhất một trường trước khi lưu.");
      return;
    }
    if (isProfileSplit && Object.keys(effective).length === 0) {
      toast.error("Nhập ít nhất một trường trước khi lưu.");
      return;
    }

    const sourceUrl = trimmedOrUndefined(effective.sourceUrl);
    const catalogPdfUrls = decision?.catalogPdfUrls ?? [];

    // Material-profile rows still require canonical identity fields before
    // creating or updating a material.
    if (isProfileSplit) {
      if (targetLookupPending) {
        toast.warning(
          "Đang kiểm tra vật tư đích; vui lòng chờ trong giây lát.",
        );
        return;
      }
      if (!profileSaveResolution?.promotable) {
        toast.error(
          `Chưa thể lưu vào vật tư: ${profileSaveResolution?.reasons.join(" ") ?? "Hồ sơ chưa đủ điều kiện."}`,
        );
        return;
      }
      if (workspaceId == null || !decision) {
        toast.error("Thiếu dữ liệu hồ sơ để lưu vật tư.");
        return;
      }
      try {
        const decisionForSave: RowDecision = {
          ...decision,
          acceptedFields: accepted,
          overwriteFields: new Set(),
          acceptedProfileFields,
          catalogPdfUrls:
            profileCatalogPdfUrls.length > 0
              ? profileCatalogPdfUrls
              : undefined,
        };
        await persistReviewDecision.mutateAsync({
          itemId: row.key,
          decision: serializeRowDecision(decisionForSave),
        });
        const preview = await createSavePreview.mutateAsync({
          workspaceId,
          itemIds: [row.key],
          single: true,
        });
        const blocked = preview.rows.find(
          (entry) => entry.action === "blocked",
        );
        if (blocked) {
          await cancelSaveBatch.mutateAsync({
            workspaceId,
            batchId: preview.batch.id,
          });
          toast.error(
            blocked.warningsJson[0] ?? "Hồ sơ chưa đủ điều kiện lưu.",
          );
          return;
        }
        const previewRow = preview.rows[0];
        const expectedTargetId = profileSaveTarget?.material?.id ?? null;
        if (previewRow?.targetMaterialId !== expectedTargetId) {
          await cancelSaveBatch.mutateAsync({
            workspaceId,
            batchId: preview.batch.id,
          });
          void targetLookup.refetch();
          toast.warning(
            "Vật tư đích vừa thay đổi; đã dừng lưu để bạn kiểm tra lại phần so sánh.",
          );
          return;
        }
        const committed = await commitSaveBatch.mutateAsync({
          workspaceId,
          batchId: preview.batch.id,
        });
        if (committed.status !== "completed") {
          throw new Error(committed.message ?? "Đợt lưu vật tư chưa hoàn tất.");
        }
        const workspace = await utils.materialProfile.get.fetch({
          workspaceId,
        });
        const item = workspace.items.find((entry) => entry.id === row.key);
        const next = deserializeRowDecision(item?.reviewDecisionJson);
        if (next) onChange(next);
        await Promise.all([
          utils.material.searchMaterials.invalidate(),
          utils.material.getMaterialSummary.invalidate(),
          utils.material.getMaterialFilterOptions.invalidate(),
        ]);
        toast.success("Đã lưu vào /materials.");
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Không lưu được vật tư.",
        );
      }
      return;
    }

    upsertMaterial.mutate(
      {
        id: selectedId ?? undefined,
        patch: {
          name,
          unit,
          code: trimmedOrUndefined(effective.code),
          category: trimmedOrUndefined(effective.category),
          specText: trimmedOrUndefined(specText),
          manufacturer: trimmedOrUndefined(effective.manufacturer),
          originCountry: trimmedOrUndefined(effective.originCountry),
          defaultUnitPrice: parseOptionalNumber(
            effective.defaultUnitPrice ?? "",
          ),
          sourceUrl,
          currency: "VND",
          catalogPdfUrls,
        },
      },
      {
        onSuccess: (material) => {
          if (!material) {
            toast.error("Không lưu được vật tư.");
            return;
          }
          void utils.material.enrichSearchMaterials.invalidate();
          onChange(
            applySavedMaterialToDecision(material.id, effective, decision),
          );
          toast.success(
            selectedId != null ? "Đã cập nhật vật tư." : "Đã lưu vào vật tư.",
          );
        },
        onError: (error) => {
          if (error.data?.code === "CONFLICT") {
            toast.error("Mã vật tư đã tồn tại.");
            return;
          }
          toast.error(error.message ?? "Không lưu được vật tư.");
        },
      },
    );
  };

  const handleSavedToCatalog = (
    materialId: number,
    values: ManualProductValues,
  ) => {
    const savedFields: Partial<Record<FillableField, string>> = {};
    for (const field of FILLABLE_FIELDS) {
      if (field === "currency") continue;
      const value = values[field]?.trim() ?? "";
      if (value) savedFields[field] = value;
    }
    void utils.material.enrichSearchMaterials.invalidate();
    onChange(applySavedMaterialToDecision(materialId, savedFields, decision));
  };

  const clearDecision = () => {
    onChange({
      materialId: null,
      selectedSource: undefined,
      selectedSearchCandidateKey: undefined,
      acceptedFields: new Set(),
      overwriteFields: new Set(),
      editedValues: {},
      webProposedFields: {},
      webEvidence: [],
      ...profileFields,
      selectedScrapeProductKey: null,
      catalogPdfUrls: undefined,
    });
  };

  const hasWebOrManualDecision =
    selectedSearchCandidateKey != null ||
    Object.keys(webProposedFields).length > 0 ||
    (selectedId == null &&
      (accepted.size > 0 ||
        Object.values(editedValues).some(
          (value) => (value ?? "").trim().length > 0,
        )));

  const rowNameMissing = row.name.trim().length === 0;

  const pickerProductsForSource = (
    sourceKey: string,
    run: NonNullable<typeof scrapeHistory>[number] | null,
  ) => {
    const products = new Map<string, ProfileScrapedProductPickerItem>();
    const sourceUrl = sourceKey.startsWith("web:") ? sourceKey.slice(4) : "";
    const liveProducts = Array.isArray(run?.scrapedProductCandidatesJson)
      ? run.scrapedProductCandidatesJson
      : [];
    liveProducts.forEach((raw, productIndex) => {
      const product = profileScrapedProduct(raw);
      if (!product) return;
      const productKey = scrapedProductKey(sourceUrl, product);
      products.set(productKey, {
        productKey,
        product,
        retained: false,
        active: false,
        productIndex,
      });
    });
    for (const result of decision?.scrapeResults ?? []) {
      if (result.sourceCandidateKey !== sourceKey) continue;
      const live = products.get(result.productKey);
      products.set(result.productKey, {
        productKey: result.productKey,
        product: live?.product ?? result.product,
        retained: true,
        active: decision?.selectedScrapeProductKey === result.productKey,
        productIndex: live?.productIndex,
      });
    }
    return [...products.values()].slice(0, 8);
  };

  const applySerializedDecision = (serialized: unknown) => {
    const next = deserializeRowDecision(serialized);
    if (!next) throw new Error("Máy chủ không trả về quyết định hợp lệ.");
    decisionRef.current = next;
    onChange(next);
  };

  const flushCurrentDecision = async () => {
    if (onFlushCurrentDecision) {
      await onFlushCurrentDecision();
      return;
    }
    if (!decision) return;
    await persistReviewDecision.mutateAsync({
      itemId: row.key,
      decision: serializeRowDecision(decision),
    });
  };

  const selectPickerProduct = async (
    item: ProfileScrapedProductPickerItem,
    run: NonNullable<typeof scrapeHistory>[number] | null,
  ) => {
    if (workspaceId == null) return;
    setPendingProductKey(item.productKey);
    try {
      // Finish the debounced parent save before switching the whole decision.
      // Product activation persists a new decision and must not race that save.
      await flushCurrentDecision();
      if (!item.retained && item.productIndex != null && run) {
        // This transition is applied from the mutation response below. Do not
        // let the completed-run background merge restore the pre-click focus.
        handledCaptureRunIdsRef.current.add(run.id);
        const serialized = await selectScrapedProduct.mutateAsync({
          workspaceId,
          runId: run.id,
          productIndex: item.productIndex,
        });
        applySerializedDecision(serialized);
      } else {
        const serialized = await activateScrapedProduct.mutateAsync({
          workspaceId,
          itemId: row.key,
          productKey: item.productKey,
        });
        applySerializedDecision(serialized);
      }
      void utils.materialProfile.getActiveScrapeJob.invalidate({ workspaceId });
      void scrapeHistoryQuery.refetch();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Không áp dụng được sản phẩm đã chọn.",
      );
    } finally {
      setPendingProductKey(null);
    }
  };

  const removePickerProduct = async (productKey: string) => {
    if (workspaceId == null) return;
    setRemovingProductKey(productKey);
    try {
      await flushCurrentDecision();
      const serialized = await removeScrapedProduct.mutateAsync({
        workspaceId,
        itemId: row.key,
        productKey,
      });
      applySerializedDecision(serialized);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Không bỏ được sản phẩm.",
      );
    } finally {
      setRemovingProductKey(null);
    }
  };

  const rescrapeSource = (sourceKey: string) => {
    const parsed = parseSearchCandidateKey(sourceKey);
    const link = decision?.webLinkResults?.find(
      (candidate) => candidate.url === parsed?.id,
    );
    if (!link || workspaceId == null) return;
    setStartingCandidateKeys((current) => new Set(current).add(sourceKey));
    startScrapeJob.mutate(
      {
        workspaceId,
        itemIds: [row.key],
        interactive: true,
        sourceUrl: link.url,
        sourceCandidateKey: sourceKey,
      },
      {
        onSuccess: () => void scrapeHistoryQuery.refetch(),
        onError: (error) => toast.error(error.message),
        onSettled: () =>
          setStartingCandidateKeys((current) => {
            const next = new Set(current);
            next.delete(sourceKey);
            return next;
          }),
      },
    );
  };

  const getCaptureSearchCandidateState = (sourceKey: string) => {
    const run = latestScrapeRunsBySource.get(sourceKey) ?? null;
    const products = pickerProductsForSource(sourceKey, run);
    const starting = startingCandidateKeys.has(sourceKey);
    const pending =
      starting || run?.status === "queued" || run?.status === "running";
    const actionLabel = starting
      ? "Đang chờ"
      : run?.status === "queued"
        ? "Đang chờ"
        : run?.status === "running"
          ? "Đang scrape"
          : run?.status === "awaiting_product_selection"
            ? "Chọn sản phẩm"
            : run?.status === "failed"
              ? "Xem lỗi"
              : run?.status === "cancelled" || run?.status === "skipped"
                ? "Scrape lại"
                : run?.status === "completed" || products.length > 0
                  ? "Xem sản phẩm"
                  : undefined;
    const expanded = expandedScrapeSourceKey === sourceKey;
    return {
      pending,
      disabled: starting,
      actionLabel,
      statusText:
        run?.status === "queued"
          ? "Đang xếp hàng…"
          : run?.status === "running"
            ? (run.childShopJob?.message ?? "Đang đọc nguồn…")
            : undefined,
      inlineLayer:
        expanded && (run || products.length > 0) && workspaceId != null ? (
          <ProfileScrapeInlineLayer
            job={
              run
                ? { ...run.parentJob, childShopJob: run.childShopJob }
                : undefined
            }
            run={run}
            products={products}
            onCancel={
              run && (run.status === "queued" || run.status === "running")
                ? () =>
                    cancelScrapeJob.mutate({
                      workspaceId,
                      jobId: run.jobId,
                    })
                : undefined
            }
            onRetry={
              run?.status === "failed"
                ? () =>
                    retryScrapeRuns.mutate({
                      workspaceId,
                      jobId: run.jobId,
                      runIds: [run.id],
                    })
                : undefined
            }
            onRescrape={
              run &&
              [
                "awaiting_product_selection",
                "completed",
                "cancelled",
                "skipped",
              ].includes(run.status)
                ? () => rescrapeSource(sourceKey)
                : undefined
            }
            onSelectProduct={(item) => void selectPickerProduct(item, run)}
            onRemoveProduct={(productKey) =>
              void removePickerProduct(productKey)
            }
            cancelling={cancelScrapeJob.isPending}
            retrying={retryScrapeRuns.isPending}
            rescraping={starting}
            pendingProductKey={pendingProductKey}
            removingProductKey={removingProductKey}
          />
        ) : undefined,
    };
  };
  const canSaveToMaterials =
    (isProfileSplit
      ? profileSaveResolution?.promotable === true
      : accepted.size > 0) &&
    !conflictingSaveBatch &&
    !isWebSearchPending &&
    !isWebLinksPending &&
    !isAiSearchPending &&
    !isSearchBusy &&
    !targetLookupPending &&
    (decision?.selectedSource == null
      ? decision?.selectedScrapeProductKey !== null
      : decision.selectedSource !== "web" ||
        decision.selectedScrapeProductKey != null);
  const isSavingMaterial =
    upsertMaterial.isPending ||
    persistReviewDecision.isPending ||
    createSavePreview.isPending ||
    commitSaveBatch.isPending ||
    cancelSaveBatch.isPending;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {isProfileSplit ? (
          <>
            <Button
              variant="search"
              size="sm"
              onClick={() => onWebLinksSearch?.()}
              disabled={[
                isWebLinksPending,
                rowNameMissing,
                isSearchBusy,
                capturingSearchCandidateKey != null,
              ].some(Boolean)}
            >
              {isWebLinksPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Globe className="h-4 w-4" aria-hidden />
              )}
              {decision?.webLinkResults?.length
                ? "Tìm lại nguồn"
                : "Tìm nguồn phù hợp"}
            </Button>
            <Button
              variant="ai"
              size="sm"
              onClick={onAiSearch}
              disabled={[
                isAiSearchPending,
                rowNameMissing,
                isSearchBusy,
                capturingSearchCandidateKey != null,
                selectedWebScrape == null,
              ].some(Boolean)}
              title={
                selectedWebScrape == null
                  ? "Chọn nguồn và hoàn tất scrape trước khi chạy AI."
                  : "AI chỉ đọc bản chụp scrape đang chọn."
              }
            >
              {isAiSearchPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Sparkles className="h-4 w-4" aria-hidden />
              )}
              Trích xuất AI
            </Button>
          </>
        ) : (
          <Button
            variant="search"
            size="sm"
            onClick={onWebSearch}
            disabled={[
              isWebSearchPending,
              rowNameMissing,
              isSearchBusy,
              capturingSearchCandidateKey != null,
            ].some(Boolean)}
          >
            {isWebSearchPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Globe className="h-4 w-4" aria-hidden />
            )}
            Tìm web
          </Button>
        )}
      </div>

      {isProfileSplit ? (
        <details className="border-line bg-surface-2 rounded border px-3 py-2">
          <summary className="focus-visible:ring-ring flex min-h-10 cursor-pointer items-center text-xs font-semibold focus-visible:ring-2 focus-visible:outline-none">
            Nguồn thủ công & truy vấn nâng cao
          </summary>
          <div className="mt-2 grid gap-3 lg:grid-cols-2">
            <div>
              <label
                htmlFor={`manual-source-${row.key}`}
                className="text-ink-2 text-xs font-semibold"
              >
                Thêm URL nguồn
              </label>
              <div className="mt-1 flex flex-col gap-2 sm:flex-row">
                <input
                  id={`manual-source-${row.key}`}
                  type="url"
                  value={manualSourceUrl}
                  onChange={(event) => setManualSourceUrl(event.target.value)}
                  placeholder="https://nhacungcap.vn/san-pham"
                  className="border-line-strong bg-surface-1 min-h-10 min-w-0 flex-1 rounded border px-3 text-sm"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void addManualSource()}
                  isLoading={inspectManualSource.isPending}
                  disabled={inspectManualSource.isPending || isSearchBusy}
                >
                  Kiểm tra & thêm
                </Button>
              </div>
              <p className="text-ink-3 mt-1 text-xs">
                URL được kiểm tra SSRF và tên miền chặn trước khi thêm.
              </p>
            </div>
            <div>
              <label
                htmlFor={`custom-queries-${row.key}`}
                className="text-ink-2 text-xs font-semibold"
              >
                Truy vấn cho một lần chạy (tối đa 6)
              </label>
              <textarea
                id={`custom-queries-${row.key}`}
                rows={3}
                value={customQueriesText}
                onChange={(event) => setCustomQueriesText(event.target.value)}
                placeholder="Mỗi dòng một truy vấn"
                className="border-line-strong bg-surface-1 mt-1 w-full rounded border px-3 py-2 text-sm"
              />
              <Button
                className="mt-2"
                variant="secondary"
                size="sm"
                onClick={runCustomQuerySearch}
                disabled={[
                  isWebLinksPending,
                  rowNameMissing,
                  isSearchBusy,
                ].some(Boolean)}
              >
                Chạy truy vấn này
              </Button>
            </div>
          </div>
        </details>
      ) : null}

      <FieldCompareEditor
        sheetLabel={`Dòng Excel ${row.originalRowIndex}`}
        sheetName={row.name}
        sheetFields={isProfileSplit ? profileCompareBeforeFields : sheetFields}
        proposedFields={editorProposedFields}
        selectedMaterialId={selectedId}
        accepted={accepted}
        overwrite={overwrite}
        editedValues={editedValues}
        onToggleField={toggleField}
        onToggleOverwrite={toggleOverwrite}
        onEditValue={editValue}
        onClear={clearDecision}
        enableCandidateGrid
        candidates={cards}
        recommendedMaterialId={row.topCandidate?.materialId ?? null}
        searchTerm={searchTerm}
        onSearchTermChange={setSearchTerm}
        isSearching={searchQuery.isLoading}
        showingSearch={showingSearch}
        onChoose={choose}
        enableInlineEdit
        enableSkip
        isSkipped={isSkipped}
        onToggleSkip={toggleSkip}
        forceShowDecision={hasWebOrManualDecision}
        compareLayout={isProfileSplit ? "sideBySide" : "inline"}
        afterColumnLabel={afterColumnLabel}
        alwaysEditableFields={isProfileSplit}
        catalogPdfUrls={profileCatalogPdfUrls}
        catalogPdfUrlsBefore={catalogPdfUrlsBefore}
        catalogPdfProvenance={catalogPdfProvenance}
        catalogPdfAccepted={catalogPdfAccepted}
        onEditCatalogPdfUrls={isProfileSplit ? editCatalogPdfUrls : undefined}
        profileExtraFields={
          isProfileSplit
            ? {
                before: {
                  name:
                    targetMaterial?.name ??
                    row.linkedMaterial?.name ??
                    row.name,
                  imageUrl:
                    targetMaterial && "imageUrl" in targetMaterial
                      ? (targetMaterial.imageUrl ?? "")
                      : "",
                },
                after: {
                  name: profileNameAfter,
                  imageUrl: profileImageAfter,
                },
                accepted: acceptedProfileFields,
                provenance: {
                  name: acceptedProfileFields.has("name")
                    ? decision?.editedProfileValues?.name !== undefined
                      ? "Thủ công"
                      : sourceProvenance
                    : undefined,
                  imageUrl: acceptedProfileFields.has("imageUrl")
                    ? decision?.editedProfileValues?.imageUrl !== undefined
                      ? "Thủ công"
                      : sourceProvenance
                    : undefined,
                },
              }
            : undefined
        }
        onToggleProfileField={isProfileSplit ? toggleProfileField : undefined}
        onEditProfileValue={isProfileSplit ? editProfileValue : undefined}
        fieldProvenance={isProfileSplit ? fieldProvenance : undefined}
        searchSourceCandidates={searchSourceCandidates}
        selectedSearchCandidateKey={selectedSearchCandidateKey}
        onChooseSearchCandidate={
          isProfileSplit ? chooseSearchCandidate : undefined
        }
        onCaptureSearchCandidate={
          isProfileSplit ? captureSearchCandidate : undefined
        }
        onRejectSearchCandidate={
          isProfileSplit ? rejectSearchCandidate : undefined
        }
        rejectingSearchCandidateKey={rejectingSearchCandidateKey}
        rejectSearchCandidateDisabled={rejectingSearchCandidateKey != null}
        capturingSearchCandidateKey={capturingSearchCandidateKey}
        captureSearchCandidateDisabled={
          isWebLinksPending === true ||
          isAiSearchPending === true ||
          isSearchBusy
        }
        getCaptureSearchCandidateState={getCaptureSearchCandidateState}
        unifiedCandidateGrid={isProfileSplit}
        decisionPaneLayout={isProfileSplit ? "sideBySide" : "stacked"}
        decisionActions={
          <div className="grid max-w-72 justify-items-end gap-1">
            <Button
              variant="save"
              size="sm"
              onClick={() => void saveCurrentToMaterials()}
              disabled={!canSaveToMaterials}
              isLoading={isSavingMaterial}
              leftIcon={<Save className="h-4 w-4" />}
              aria-describedby={isProfileSplit ? materialSaveHintId : undefined}
              title={
                isProfileSplit
                  ? profileSaveHint
                  : canSaveToMaterials
                    ? "Lưu các trường đã chọn vào danh mục vật tư"
                    : "Chọn ít nhất một trường để lưu"
              }
            >
              {isProfileSplit
                ? "Lưu tất cả vào /materials"
                : "Lưu vào /materials"}
            </Button>
            {isProfileSplit ? (
              <p
                id={materialSaveHintId}
                role="status"
                aria-live="polite"
                className={`${profileSaveResolution?.promotable ? "text-good" : "text-warning"} text-right text-xs leading-4`}
              >
                {profileSaveHint}
              </p>
            ) : null}
          </div>
        }
      />

      {!isProfileSplit && webEvidence.length > 0 && !isWebSearchPending ? (
        <div className="space-y-2">
          <p className="text-xs font-bold text-slate-700">Bằng chứng web</p>
          {webEvidence.slice(0, 6).map((item, index) => (
            <div
              key={`${item.field}-${item.sourceUrl ?? index}`}
              className="rounded border border-slate-500 bg-white p-2 text-xs shadow-[var(--shadow-flat)]"
            >
              <p className="font-semibold text-slate-700">
                {FIELD_LABELS[item.field as FillableField] ?? item.field}
              </p>
              <p className="mt-0.5 text-slate-600">{item.snippet}</p>
              {item.sourceUrl ? (
                <a
                  href={item.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block text-blue-700 hover:underline"
                >
                  {item.sourceUrl}
                </a>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <ManualProductForm
        productName={row.name}
        sheetFields={sheetFields}
        selectedCandidate={selectedCandidate}
        onApplyToRow={applyManualValues}
        onSavedToCatalog={handleSavedToCatalog}
        allowSaveToCatalog={!isProfileSplit}
      />
    </div>
  );
}
