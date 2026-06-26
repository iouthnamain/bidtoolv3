import { useEffect, useMemo, useState } from "react";
import { Globe, Loader2, Sparkles } from "lucide-react";

import { FieldCompareEditor } from "~/app/_components/enrich/field-compare-editor";
import {
  ManualProductForm,
  type ManualProductValues,
} from "~/app/_components/enrich/manual-product-dialog";
import { type EnrichCandidate } from "~/app/_components/enrich/product-candidate-card";
import { planForCandidate } from "~/app/_components/materials/review/review-plan";
import type { SearchSourceCandidate } from "~/app/_components/materials/review/search-source-candidate-card";
import type { ReviewRow, ReviewSearchMode } from "~/app/_components/materials/review/review-types";
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
import type { RowDecision } from "~/lib/materials/review-decision";
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
import { api } from "~/trpc/react";

function aiPriceLabel(fields: Partial<Record<FillableField, string>>) {
  const raw = fields.defaultUnitPrice?.trim();
  if (!raw) return undefined;
  const normalized = raw.replace(/\s/g, "").replace(/\./g, "").replace(/,/g, "");
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

export function MatchChooser({
  row,
  decision,
  onChange,
  searchMode = "default",
  onWebSearch,
  onWebLinksSearch,
  onAiSearch,
  isWebSearchPending,
  isWebLinksPending,
  isAiSearchPending,
}: {
  row: ReviewRow;
  decision: RowDecision | undefined;
  onChange: (next: RowDecision) => void;
  searchMode?: ReviewSearchMode;
  onWebSearch?: () => void;
  onWebLinksSearch?: () => void;
  onAiSearch?: () => void;
  isWebSearchPending?: boolean;
  isWebLinksPending?: boolean;
  isAiSearchPending?: boolean;
}) {
  const toast = useToast();
  const utils = api.useUtils();
  const [searchTerm, setSearchTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const isProfileSplit = searchMode === "profileSplit";

  useEffect(() => {
    const id = setTimeout(() => setDebounced(searchTerm.trim()), 300);
    return () => clearTimeout(id);
  }, [searchTerm]);

  const searchQuery = api.material.enrichSearchMaterials.useQuery(
    { query: debounced },
    { enabled: debounced.length > 0 },
  );
  const upsertMaterial = api.material.upsertMaterial.useMutation();

  const selectedSearchCandidateKey = decision?.selectedSearchCandidateKey ?? null;
  const selectedId =
    selectedSearchCandidateKey == null &&
    (decision?.selectedSource === "catalog" || decision?.selectedSource == null)
      ? (decision?.materialId ?? null)
      : null;
  const parsedSearchKey = parseSearchCandidateKey(selectedSearchCandidateKey);
  const aiCandidates = aiCandidatesFromDecision(decision);
  const selectedAiCandidate =
    parsedSearchKey?.source === "ai"
      ? aiCandidates[Number(parsedSearchKey.id)] ?? null
      : null;
  const accepted = decision?.acceptedFields ?? new Set<FillableField>();
  const overwrite = decision?.overwriteFields ?? new Set<FillableField>();
  const editedValues = decision?.editedValues ?? {};
  const webProposedFields = decision?.webProposedFields ?? {};
  const webEvidence = decision?.webEvidence ?? [];
  const webSearchStatus = decision?.webSearchStatus;
  const profileFields = profileSearchFields(decision);

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
        row.candidates.find((candidate) => candidate.materialId === selectedId) ??
        null)
      : null;

  const catalogFields = selectedCandidate
    ? candidateToFields(selectedCandidate)
    : null;

  const editorProposedFields =
    selectedAiCandidate != null
      ? selectedAiCandidate.fields
      : webProposedFields;

  const profileSearchRunning =
    [isWebLinksPending, isAiSearchPending].some((v) => v === true);

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
        const { score, chips } = webLinkMatchChips(link, row.name);
        items.push({
          key: searchCandidateKey("web", link.url),
          source: "web",
          title: link.title.trim() || link.url,
          subtitle: link.snippet,
          fillCount: 0,
          score,
          chips,
          sourceUrl: link.url,
          isRecommended: false,
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
          priceLabel: aiPriceLabel(candidate.fields),
          isRecommended: false,
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
    decision?.webLinkResults,
    decision?.webLinksStatus,
    isProfileSplit,
    profileSearchRunning,
    row.name,
    sheetFields,
  ]);

  const selectedSearchCandidate = selectedSearchCandidateKey
    ? searchSourceCandidates.find(
        (candidate) => candidate.key === selectedSearchCandidateKey,
      ) ?? null
    : null;

  const afterColumnLabel =
    selectedSearchCandidate?.source === "ai"
      ? "Sau (AI)"
      : selectedSearchCandidate?.source === "web"
        ? "Sau (Web)"
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
    });
  };

  const chooseSearchCandidate = (key: string) => {
    const parsed = parseSearchCandidateKey(key);
    if (!parsed) return;

    if (parsed.source === "web") {
      const link = decision?.webLinkResults?.find((item) => item.url === parsed.id);
      if (!link) {
        toast.warning("Chưa có liên kết web để chọn.");
        return;
      }

      const matchingAi = aiCandidates.find((candidate) => candidate.url === link.url);
      if (matchingAi) {
        const { acceptedFields, editedValues: nextEdited } =
          applyAllProposedFieldsWithCurrency(matchingAi.fields);
        onChange({
          materialId: null,
          selectedSource: "web",
          selectedSearchCandidateKey: key,
          acceptedFields,
          overwriteFields: new Set(),
          editedValues: nextEdited,
          webProposedFields: { ...matchingAi.fields },
          webEvidence: matchingAi.evidence,
          webSearchStatus,
          ...profileFields,
          catalogPdfUrls: matchingAi.catalogPdfUrls,
          aiSearchResult: matchingAi,
        });
        return;
      }

      const pdfFromUrl = link.url.toLowerCase().includes(".pdf") ? [link.url] : [];
      const nextEdited: Partial<Record<FillableField, string>> = {
        sourceUrl: link.url,
      };
      onChange({
        materialId: null,
        selectedSource: "web",
        selectedSearchCandidateKey: key,
        acceptedFields: new Set<FillableField>(["sourceUrl"]),
        overwriteFields: new Set(),
        editedValues: nextEdited,
        webProposedFields: { sourceUrl: link.url },
        webEvidence: [],
        webSearchStatus,
        ...profileFields,
        catalogPdfUrls: pdfFromUrl.length > 0 ? pdfFromUrl : undefined,
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
      materialId: null,
      selectedSource: "ai",
      selectedSearchCandidateKey: key,
      acceptedFields: gapFields.acceptedFields,
      overwriteFields: new Set(),
      editedValues: gapFields.editedValues,
      webProposedFields: { ...aiResult.fields },
      webEvidence: aiResult.evidence,
      webSearchStatus,
      ...profileFields,
      catalogPdfUrls: aiResult.catalogPdfUrls,
      aiSearchResult: aiResult,
    });
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
      materialId: selectedId,
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
      materialId: selectedId,
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
    const nextAccepted = isProfileSplit
      ? profileAcceptedFields(sheetFields, catalogFields, {
          editedValues: nextEdited,
          webProposedFields: editorProposedFields,
        })
      : (() => {
          const next = new Set(accepted);
          next.add(field);
          return next;
        })();
    onChange({
      materialId: selectedId,
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
      materialId: selectedId,
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
      materialId: null,
      selectedSource: undefined,
      acceptedFields: nextAccepted,
      overwriteFields: new Set(),
      editedValues: nextEdited,
      webProposedFields: {},
      webEvidence: [],
      ...profileFields,
    });
  };

  const profileEffective = isProfileSplit
    ? profileEffectiveFieldValues(sheetFields, catalogFields, {
        editedValues,
        webProposedFields: editorProposedFields,
      })
    : null;

  const saveCurrentToMaterials = () => {
    const effective = isProfileSplit
      ? profileEffectiveFieldValues(sheetFields, catalogFields, {
          editedValues,
          webProposedFields: editorProposedFields,
        })
      : effectiveAcceptedFieldValues(sheetFields, catalogFields, {
          acceptedFields: accepted,
          editedValues,
          webProposedFields: editorProposedFields,
          overwriteFields: overwrite,
        });
    const unit = effective.unit?.trim() ?? sheetFields.unit?.trim() ?? "";
    const name = row.name.trim();
    if (!name) {
      toast.error("Tên vật tư không được để trống.");
      return;
    }
    if (!unit) {
      toast.error("ĐVT không được để trống.");
      return;
    }
    if (
      !isProfileSplit &&
      accepted.size === 0
    ) {
      toast.error("Chọn ít nhất một trường trước khi lưu.");
      return;
    }
    if (isProfileSplit && Object.keys(effective).length === 0) {
      toast.error("Nhập ít nhất một trường trước khi lưu.");
      return;
    }

    const trimmedOrUndefined = (value: string | undefined) => {
      const trimmed = value?.trim();
      if (!trimmed) {
        return undefined;
      }
      return trimmed;
    };

    upsertMaterial.mutate(
      {
        id: selectedId ?? undefined,
        patch: {
          name,
          unit,
          code: trimmedOrUndefined(effective.code),
          category: trimmedOrUndefined(effective.category),
          specText: trimmedOrUndefined(effective.specText),
          manufacturer: trimmedOrUndefined(effective.manufacturer),
          originCountry: trimmedOrUndefined(effective.originCountry),
          defaultUnitPrice: parseOptionalNumber(
            effective.defaultUnitPrice ?? "",
          ),
          sourceUrl: trimmedOrUndefined(effective.sourceUrl),
          currency: "VND",
          catalogPdfUrls: decision?.catalogPdfUrls,
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
            selectedId != null
              ? "Đã cập nhật vật tư."
              : "Đã lưu vào vật tư.",
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
  const canSaveToMaterials =
    (isProfileSplit
      ? Object.keys(profileEffective ?? {}).length > 0
      : accepted.size > 0) &&
    !isWebSearchPending &&
    !isWebLinksPending &&
    !isAiSearchPending;
  const isSavingMaterial = upsertMaterial.isPending;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {isProfileSplit ? (
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={onWebLinksSearch}
              disabled={[isWebLinksPending, rowNameMissing].some(Boolean)}
            >
              {isWebLinksPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Globe className="h-4 w-4" aria-hidden />
              )}
              Tìm web
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={onAiSearch}
              disabled={[isAiSearchPending, rowNameMissing].some(Boolean)}
            >
              {isAiSearchPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Sparkles className="h-4 w-4" aria-hidden />
              )}
              Tìm AI
            </Button>
          </>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            onClick={onWebSearch}
            disabled={[isWebSearchPending, rowNameMissing].some(Boolean)}
          >
            {isWebSearchPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Globe className="h-4 w-4" aria-hidden />
            )}
            Tìm web
          </Button>
        )}
        <Button
          variant="secondary"
          size="sm"
          onClick={saveCurrentToMaterials}
          disabled={!canSaveToMaterials || isSavingMaterial}
          title={
            canSaveToMaterials
              ? "Lưu các trường đã chọn vào danh mục vật tư"
              : isProfileSplit
                ? "Nhập ít nhất một trường để lưu"
                : "Chọn ít nhất một trường để lưu"
          }
        >
          {isSavingMaterial ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : null}
          Lưu vào vật tư
        </Button>
      </div>

      <FieldCompareEditor
        sheetLabel={`Dòng Excel ${row.originalRowIndex}`}
        sheetName={row.name}
        sheetFields={sheetFields}
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
        catalogPdfUrls={decision?.catalogPdfUrls}
        onEditCatalogPdfUrls={isProfileSplit ? editCatalogPdfUrls : undefined}
        searchSourceCandidates={searchSourceCandidates}
        selectedSearchCandidateKey={selectedSearchCandidateKey}
        onChooseSearchCandidate={
          isProfileSplit ? chooseSearchCandidate : undefined
        }
        unifiedCandidateGrid={isProfileSplit}
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
      />
    </div>
  );
}
