"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Globe,
  Loader2,
  RotateCcw,
  Search,
  Upload,
} from "lucide-react";

import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
} from "~/app/_components/ui";
import { useToast } from "~/app/_components/ui/toast";
import {
  StepHeader,
  type EnrichStep,
} from "~/app/_components/enrich/step-header";
import { EnrichResearchStep } from "~/app/_components/enrich/enrich-research-step";
import { FieldCompareEditor } from "~/app/_components/enrich/field-compare-editor";
import { ReviewPanel } from "~/app/_components/materials/review/review-panel";
import type { ReviewRowStatus } from "~/app/_components/materials/review/review-types";
import {
  buildExportPreviewRows,
  countFieldsToFill,
  countResolvedRows,
  isExportableDecision,
} from "~/lib/materials/enrich-gap-fill";
import {
  FIELD_LABELS,
  type FillableField,
} from "~/lib/materials/excel-enrich-fields";
import type { RowDecision } from "~/lib/materials/review-decision";
import {
  matchRowToReviewRow,
  reviewSummaryFromRows,
} from "~/lib/materials/workspace-review-row";
import type { ColumnKey } from "~/server/services/excel-workbook";
import { api, type RouterOutputs } from "~/trpc/react";

type EnrichPreview = RouterOutputs["material"]["enrichPreviewXlsx"];
type EnrichPreviewSheet = EnrichPreview["sheets"][number];
type MatchResponse = RouterOutputs["material"]["enrichMatchRows"];
type MatchRow = MatchResponse["results"][number];
type EnrichColumnMapping = Record<string, string | null>;
type SheetEdits = Record<string, Partial<Record<FillableField, string>>>;

const MAPPING_FIELDS: Array<{
  key: ColumnKey;
  label: string;
  required?: boolean;
}> = [
  { key: "materialName", label: "Tên vật tư", required: true },
  { key: "code", label: "Mã vật tư" },
  { key: "unit", label: "ĐVT" },
  { key: "category", label: "Nhóm" },
  { key: "specText", label: "Thông số" },
  { key: "vendorHint", label: "Nhà sản xuất" },
  { key: "originHint", label: "Xuất xứ" },
  { key: "unitPrice", label: "Đơn giá" },
  { key: "sourceUrl", label: "Nguồn" },
];

function rowEditKey(rowIndex: number) {
  return String(rowIndex);
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = reader.result;
      if (typeof value === "string") {
        resolve(value);
        return;
      }
      reject(new Error("Không đọc được tệp Excel."));
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("Không đọc được tệp Excel."));
    reader.readAsDataURL(file);
  });
}

function downloadBase64Xlsx(fileName: string, base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

const EMPTY_JOB_ID = "00000000-0000-0000-0000-000000000000";

// The whole workbook is base64-encoded and sent in the request body (preview,
// match, export). Base64 inflates size ~33%, so guard the raw file well under
// typical body limits to fail fast with a clear message instead of an opaque
// network/parse error.
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export function MaterialEnrichClient() {
  const toast = useToast();

  const [step, setStep] = useState<EnrichStep>(1);
  const [maxReached, setMaxReached] = useState<EnrichStep>(1);

  const [file, setFile] = useState<File | null>(null);
  const [base64, setBase64] = useState<string | null>(null);
  const [preview, setPreview] = useState<EnrichPreview | null>(null);
  const [sheetName, setSheetName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [matchData, setMatchData] = useState<MatchResponse | null>(null);
  const [decisions, setDecisions] = useState<Map<number, RowDecision>>(
    () => new Map(),
  );
  const [statusFilter, setStatusFilter] = useState<ReviewRowStatus | "all">(
    "all",
  );
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const [confirmUnmatchedOpen, setConfirmUnmatchedOpen] = useState(false);
  const [researchJobId, setResearchJobId] = useState<string | null>(null);
  const [confirmResearchExportOpen, setConfirmResearchExportOpen] =
    useState(false);
  const [researchExportSummary, setResearchExportSummary] = useState<{
    needsReview: number;
  } | null>(null);
  const [mappingBySheet, setMappingBySheet] = useState<Record<string, EnrichColumnMapping>>(
    {},
  );
  const [sheetEdits, setSheetEdits] = useState<SheetEdits>({});

  const previewRequestRef = useRef(0);

  const activeSheet: EnrichPreviewSheet | undefined =
    preview?.sheets.find((s) => s.name === sheetName) ?? preview?.sheets[0];
  const activeMapping = useMemo<EnrichColumnMapping>(() => {
    if (!activeSheet) return {};
    return {
      ...(activeSheet.suggestedMapping as EnrichColumnMapping),
      ...(mappingBySheet[activeSheet.name] ?? {}),
    };
  }, [activeSheet, mappingBySheet]);

  const previewXlsx = api.material.enrichPreviewXlsx.useMutation();
  const matchRowsMutation = api.material.enrichMatchRows.useMutation();
  const exportXlsx = api.material.enrichExportXlsx.useMutation();
  const exportResearchXlsx = api.excelResearch.exportExcel.useMutation();

  const researchJobStatus = api.excelResearch.getJobStatus.useQuery(
    { jobId: researchJobId ?? EMPTY_JOB_ID },
    {
      enabled: researchJobId != null && step >= 3,
      refetchOnWindowFocus: false,
    },
  );

  const reach = (target: EnrichStep) => {
    setStep(target);
    setMaxReached((prev) => (target > prev ? target : prev));
  };

  const handleFile = async (next: File | null) => {
    const requestId = previewRequestRef.current + 1;
    previewRequestRef.current = requestId;
    setFile(next);
    setBase64(null);
    setPreview(null);
    setMatchData(null);
    setDecisions(new Map());
    setStatusFilter("all");
    setSelectedRowIndex(null);
    setConfirmUnmatchedOpen(false);
    setResearchExportSummary(null);
    setResearchJobId(null);
    setMappingBySheet({});
    setSheetEdits({});
    setError(null);
    setSheetName("");
    setStep(1);
    setMaxReached(1);
    if (!next) return;

    if (next.size > MAX_UPLOAD_BYTES) {
      setFile(null);
      setError(
        `Tệp quá lớn (${(next.size / 1024 / 1024).toFixed(1)} MB). Giới hạn ${(MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0)} MB.`,
      );
      return;
    }

    try {
      const workbookBase64 = await fileToBase64(next);
      if (requestId !== previewRequestRef.current) return;
      setBase64(workbookBase64);
      previewXlsx.mutate(
        { fileName: next.name, workbookBase64 },
        {
          onSuccess: (result) => {
            if (requestId !== previewRequestRef.current) return;
            setPreview(result);
            setSheetName(result.selectedSheetName);
            setMappingBySheet(
              Object.fromEntries(
                result.sheets.map((sheet) => [
                  sheet.name,
                  sheet.suggestedMapping as EnrichColumnMapping,
                ]),
              ),
            );
          },
          onError: (err) => {
            const message = err.message || "Không tạo được preview Excel.";
            setError(message);
            toast.error(message);
          },
        },
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Không đọc được tệp Excel.";
      setError(message);
      toast.error(message);
    }
  };

  const runMatch = () => {
    if (!file || !base64 || !activeSheet) return;
    setError(null);
    matchRowsMutation.mutate(
      {
        fileName: file.name,
        workbookBase64: base64,
        sheetName: activeSheet.name,
        headerRowIndex: activeSheet.activeHeaderRowIndex,
        mapping: activeMapping,
      },
      {
        onSuccess: (result) => {
          setMatchData(result);
          // Seed decisions: only `auto` rows pre-select the top candidate and
          // tick all "filled" fields. `review` rows require an explicit pick
          // (so "Cần duyệt" rows aren't silently counted/exported); unmatched
          // start empty.
          const seeded = new Map<number, RowDecision>();
          for (const row of result.results) {
            const acceptedFields = new Set<FillableField>(
              row.fillPlan
                .filter((cell) => cell.action === "filled")
                .map((cell) => cell.field),
            );
            seeded.set(row.originalRowIndex, {
              materialId:
                row.status === "auto"
                  ? (row.topCandidate?.materialId ?? null)
                  : null,
              acceptedFields:
                row.status === "auto" ? acceptedFields : new Set(),
            });
          }
          setDecisions(seeded);
          setSelectedRowIndex(result.results[0]?.originalRowIndex ?? null);
          reach(2);
          toast.success(
            `Đã đối chiếu ${result.matchedRows.toLocaleString("vi-VN")} dòng.`,
          );
          if (result.truncated) {
            toast.warning(
              `Chỉ đối chiếu ${result.matchedRows.toLocaleString("vi-VN")}/${result.totalRows.toLocaleString("vi-VN")} dòng (giới hạn).`,
            );
          }
        },
        onError: (err) => {
          const message = err.message || "Không đối chiếu được.";
          setError(message);
          toast.error(message);
        },
      },
    );
  };

  const fieldsToFill = useMemo(
    () => countFieldsToFill(decisions.values()),
    [decisions],
  );

  // Unmatched rows the user hasn't resolved yet — neither manually matched nor
  // explicitly skipped. This is what export warnings should reflect, not the
  // raw server count (which ignores the user's skip/manual-match decisions).
  const pendingUnmatched = useMemo(() => {
    if (!matchData) return 0;
    return matchData.results.filter((row) => {
      if (row.status !== "unmatched") return false;
      const decision = decisions.get(row.originalRowIndex);
      if (decision?.skipped) return false;
      return !isExportableDecision(
        decision ?? { materialId: null, acceptedFields: new Set() },
      );
    }).length;
  }, [matchData, decisions]);

  // Mid-confidence "review" rows the user hasn't resolved yet — neither manually
  // matched nor explicitly skipped. Seeded with materialId:null, these are never
  // auto-accepted, so without surfacing them the user could export and silently
  // drop every reviewable row. Mirrors pendingUnmatched but for status "review".
  const pendingReview = useMemo(() => {
    if (!matchData) return 0;
    return matchData.results.filter((row) => {
      if (row.status !== "review") return false;
      const decision = decisions.get(row.originalRowIndex);
      if (decision?.skipped) return false;
      return !isExportableDecision(
        decision ?? { materialId: null, acceptedFields: new Set() },
      );
    }).length;
  }, [matchData, decisions]);

  // Rows the user has actually matched (a non-null materialId decision). This
  // reflects manual picks and skips, unlike the server's static summary counts.
  const matchedCount = useMemo(
    () => countResolvedRows(decisions.values()),
    [decisions],
  );
  const unresolvedRowNumbers = useMemo(() => {
    if (!matchData) return [];
    return matchData.results
      .filter((row) => {
        const decision = decisions.get(row.originalRowIndex);
        if (decision?.skipped) return false;
        return !isExportableDecision(
          decision ?? { materialId: null, acceptedFields: new Set() },
        );
      })
      .map((row) => row.originalRowIndex);
  }, [matchData, decisions]);

  const updateDecision = (rowIndex: number, next: RowDecision) => {
    setDecisions((prev) => {
      const map = new Map(prev);
      map.set(rowIndex, next);
      return map;
    });
  };

  const updateMapping = (sheet: EnrichPreviewSheet, key: ColumnKey, value: string | null) => {
    setMappingBySheet((prev) => ({
      ...prev,
      [sheet.name]: {
        ...(prev[sheet.name] ?? (sheet.suggestedMapping as EnrichColumnMapping)),
        [key]: value,
      },
    }));
  };

  const resetMapping = (sheet: EnrichPreviewSheet) => {
    setMappingBySheet((prev) => ({
      ...prev,
      [sheet.name]: sheet.suggestedMapping as EnrichColumnMapping,
    }));
  };

  const clearMapping = (sheet: EnrichPreviewSheet) => {
    setMappingBySheet((prev) => ({
      ...prev,
      [sheet.name]: Object.fromEntries(
        MAPPING_FIELDS.map((field) => [field.key, null]),
      ) as EnrichColumnMapping,
    }));
  };

  const updateSheetEdit = (
    rowIndex: number,
    field: FillableField,
    value: string | null,
  ) => {
    const key = rowEditKey(rowIndex);
    setSheetEdits((prev) => {
      const rowEdits = { ...(prev[key] ?? {}) };
      if (value == null) {
        delete rowEdits[field];
      } else {
        rowEdits[field] = value;
      }
      const next = { ...prev };
      if (Object.keys(rowEdits).length === 0) {
        delete next[key];
      } else {
        next[key] = rowEdits;
      }
      return next;
    });
  };

  const resetRowSheetEdits = (rowIndex: number) => {
    const key = rowEditKey(rowIndex);
    setSheetEdits((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const toggleSheetOverwrite = (rowIndex: number, field: FillableField) => {
    setDecisions((prev) => {
      const current =
        prev.get(rowIndex) ?? { materialId: null, acceptedFields: new Set() };
      const overwriteFields = new Set(current.overwriteFields ?? []);
      if (overwriteFields.has(field)) {
        overwriteFields.delete(field);
      } else {
        overwriteFields.add(field);
      }
      const acceptedFields = new Set(current.acceptedFields);
      acceptedFields.add(field);
      const next = new Map(prev);
      next.set(rowIndex, {
        ...current,
        acceptedFields,
        overwriteFields,
        skipped: false,
      });
      return next;
    });
  };

  const skipSheetField = (rowIndex: number, field: FillableField) => {
    updateSheetEdit(rowIndex, field, null);
    setDecisions((prev) => {
      const current = prev.get(rowIndex);
      if (!current) return prev;
      const acceptedFields = new Set(current.acceptedFields);
      const overwriteFields = new Set(current.overwriteFields ?? []);
      acceptedFields.delete(field);
      overwriteFields.delete(field);
      const editedValues = { ...(current.editedValues ?? {}) };
      delete editedValues[field];
      const next = new Map(prev);
      next.set(rowIndex, {
        ...current,
        acceptedFields,
        overwriteFields,
        editedValues,
      });
      return next;
    });
  };

  const skipSheetRow = (rowIndex: number) => {
    resetRowSheetEdits(rowIndex);
    setDecisions((prev) => {
      const current = prev.get(rowIndex);
      if (!current) return prev;
      const next = new Map(prev);
      next.set(rowIndex, {
        ...current,
        acceptedFields: new Set(),
        overwriteFields: new Set(),
        editedValues: {},
        skipped: true,
      });
      return next;
    });
  };

  const runExport = (mode: "preserve" | "clean") => {
    if (!file || !base64 || !matchData || !activeSheet) return;
    const exportDecisions = Array.from(decisions.entries())
      .map(([originalRowIndex, decision]) => ({
        originalRowIndex,
        materialId: decision.materialId,
        fields: Array.from(decision.acceptedFields),
        overwriteFields: Array.from(decision.overwriteFields ?? []),
        valueOverrides: {
          ...(decision.editedValues ?? {}),
          ...(sheetEdits[rowEditKey(originalRowIndex)] ?? {}),
        },
      }))
      // A row exports when it has accepted fields AND a source for their values:
      // either a matched catalog material, or per-field overrides (manual entry
      // / web-only rows) that cover the accepted fields.
      .filter(
        (d) =>
          d.fields.length > 0 &&
          (d.materialId != null ||
            d.fields.every((field) => d.valueOverrides[field] != null)),
      );

    exportXlsx.mutate(
      {
        fileName: file.name,
        workbookBase64: base64,
        sheetName: activeSheet.name,
        headerRowIndex: activeSheet.activeHeaderRowIndex,
        mapping: activeMapping,
        mode,
        decisions: exportDecisions,
      },
      {
        onSuccess: (result) => {
          downloadBase64Xlsx(result.fileName, result.workbookBase64);
          toast.success("Đã xuất file đã điền.");
        },
        onError: (err) => toast.error(err.message || "Không xuất được file."),
      },
    );
  };

  const handleExportClick = () => {
    if (pendingUnmatched > 0 || pendingReview > 0) {
      setConfirmUnmatchedOpen(true);
      return;
    }
    runExport("preserve");
  };

  const runResearchExport = () => {
    if (!researchJobId) return;
    exportResearchXlsx.mutate(
      { jobId: researchJobId },
      {
        onSuccess: (result) => {
          downloadBase64Xlsx(result.fileName, result.workbookBase64);
          toast.success("Đã xuất file nghiên cứu web.");
        },
        onError: (err) =>
          toast.error(err.message || "Không xuất được file nghiên cứu."),
      },
    );
  };

  const handleResearchExportClick = (needsReview: number) => {
    if (needsReview > 0) {
      setResearchExportSummary({ needsReview });
      setConfirmResearchExportOpen(true);
      return;
    }
    runResearchExport();
  };

  const reviewRows = useMemo(
    () => matchData?.results.map((row) => matchRowToReviewRow(row)) ?? [],
    [matchData],
  );
  const reviewSummary = useMemo(
    () =>
      reviewRows.length > 0
        ? {
            totalRows: matchData?.matchedRows ?? reviewRows.length,
            ...reviewSummaryFromRows(reviewRows),
          }
        : { totalRows: 0, auto: 0, review: 0, unmatched: 0 },
    [matchData?.matchedRows, reviewRows],
  );

  return (
    <div className="space-y-2">
      <StepHeader current={step} maxReached={maxReached} onJump={setStep} />

      {error ? (
        <div className="rounded border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p>{error}</p>
          </div>
        </div>
      ) : null}

      {step === 1 ? (
        <UploadStep
          file={file}
          preview={preview}
          activeSheet={activeSheet}
          activeMapping={activeMapping}
          isPreviewLoading={previewXlsx.isPending}
          isMatching={matchRowsMutation.isPending}
          onFile={handleFile}
          onSheetChange={setSheetName}
          onMappingChange={updateMapping}
          onResetMapping={resetMapping}
          onClearMapping={clearMapping}
          onMatch={runMatch}
        />
      ) : null}

      {step === 2 && matchData ? (
        <ReviewPanel
          rows={reviewRows}
          summary={reviewSummary}
          decisions={decisions}
          updateDecision={updateDecision}
          applyDecisions={setDecisions}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          selectedRowIndex={selectedRowIndex}
          setSelectedRowIndex={setSelectedRowIndex}
          fieldsToFill={fieldsToFill}
          matchedCount={matchedCount}
          pendingUnmatched={pendingUnmatched}
          headerActions={
            <>
              <Button
                variant="secondary"
                size="sm"
                disabled={reviewRows.length === 0}
                onClick={() => reach(4)}
              >
                Bỏ qua web → xuất file
              </Button>
              <Button
                variant="primary"
                size="sm"
                leftIcon={<Globe className="h-3.5 w-3.5" />}
                disabled={reviewRows.length === 0}
                onClick={() => reach(3)}
              >
                Tiếp tục nghiên cứu web
              </Button>
            </>
          }
        />
      ) : null}

      {step === 3 && file && base64 && activeSheet ? (
        <EnrichResearchStep
          fileName={file.name}
          workbookBase64={base64}
          sheetName={activeSheet.name}
          headerRowIndex={activeSheet.activeHeaderRowIndex}
          mapping={activeMapping}
          unmatchedCount={pendingUnmatched}
          unresolvedRowNumbers={unresolvedRowNumbers}
          jobId={researchJobId}
          onJobIdChange={setResearchJobId}
          onContinue={() => reach(4)}
          onSkip={() => reach(4)}
          onError={setError}
        />
      ) : null}

      {step === 4 && matchData ? (
        <ExportStep
          matchData={matchData}
          decisions={decisions}
          sheetEdits={sheetEdits}
          onSheetEdit={updateSheetEdit}
          onResetRowSheetEdits={resetRowSheetEdits}
          onToggleSheetOverwrite={toggleSheetOverwrite}
          onSkipSheetField={skipSheetField}
          onSkipSheetRow={skipSheetRow}
          fieldsToFill={fieldsToFill}
          matchedCount={matchedCount}
          pendingUnmatched={pendingUnmatched}
          pendingReview={pendingReview}
          isExporting={exportXlsx.isPending}
          isResearchExporting={exportResearchXlsx.isPending}
          hasResearchJob={researchJobId != null}
          researchJobId={researchJobId}
          onExport={handleExportClick}
          onExportClean={() => runExport("clean")}
          onExportResearch={() =>
            handleResearchExportClick(
              researchJobStatus.data?.needsReviewRows ?? 0,
            )
          }
          onBack={() => setStep(3)}
        />
      ) : null}

      <ConfirmDialog
        open={confirmUnmatchedOpen}
        title={`${(pendingUnmatched + pendingReview).toLocaleString("vi-VN")} dòng chưa xử lý`}
        description={`${
          pendingUnmatched > 0
            ? `${pendingUnmatched.toLocaleString("vi-VN")} dòng chưa khớp`
            : ""
        }${pendingUnmatched > 0 && pendingReview > 0 ? " và " : ""}${
          pendingReview > 0
            ? `${pendingReview.toLocaleString("vi-VN")} dòng cần duyệt chưa chọn`
            : ""
        } sẽ được giữ nguyên trong file xuất ra. Tiếp tục?`}
        confirmLabel="Xuất file"
        variant="primary"
        onConfirm={() => {
          setConfirmUnmatchedOpen(false);
          runExport("preserve");
        }}
        onCancel={() => setConfirmUnmatchedOpen(false)}
      />

      <ConfirmDialog
        open={confirmResearchExportOpen}
        title={`${researchExportSummary?.needsReview ?? 0} dòng nghiên cứu cần duyệt`}
        description="Các dòng chưa duyệt sẽ được xuất theo trạng thái hiện tại. Tiếp tục?"
        confirmLabel="Xuất file"
        variant="primary"
        onConfirm={() => {
          setConfirmResearchExportOpen(false);
          runResearchExport();
        }}
        onCancel={() => setConfirmResearchExportOpen(false)}
      />
    </div>
  );
}

function UploadStep({
  file,
  preview,
  activeSheet,
  activeMapping,
  isPreviewLoading,
  isMatching,
  onFile,
  onSheetChange,
  onMappingChange,
  onResetMapping,
  onClearMapping,
  onMatch,
}: {
  file: File | null;
  preview: EnrichPreview | null;
  activeSheet: EnrichPreviewSheet | undefined;
  activeMapping: EnrichColumnMapping;
  isPreviewLoading: boolean;
  isMatching: boolean;
  onFile: (file: File | null) => void;
  onSheetChange: (name: string) => void;
  onMappingChange: (
    sheet: EnrichPreviewSheet,
    key: ColumnKey,
    value: string | null,
  ) => void;
  onResetMapping: (sheet: EnrichPreviewSheet) => void;
  onClearMapping: (sheet: EnrichPreviewSheet) => void;
  onMatch: () => void;
}) {
  const hasNameColumn = Boolean(activeMapping.materialName);
  const mappedOptionalCount = MAPPING_FIELDS.filter(
    (field) => !field.required && Boolean(activeMapping[field.key]),
  ).length;
  const checklist = [
    { label: "Đã chọn file", done: Boolean(file) },
    { label: "Đã chọn sheet", done: Boolean(activeSheet) },
    { label: "Đã map tên vật tư", done: hasNameColumn },
    {
      label: `${mappedOptionalCount}/${MAPPING_FIELDS.length - 1} cột phụ`,
      done: mappedOptionalCount > 0,
    },
    {
      label: activeSheet
        ? `${activeSheet.rowCount.toLocaleString("vi-VN")} dòng`
        : "Chưa có dòng",
      done: Boolean(activeSheet && activeSheet.rowCount > 0),
    },
  ];

  return (
    <section className="panel overflow-hidden rounded shadow-[var(--shadow-flat)]">
      <div className="border-b border-blue-200 bg-blue-50 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded bg-blue-700 text-white">
            <FileSpreadsheet className="h-4 w-4" aria-hidden />
          </span>
          <h3 className="text-sm font-extrabold text-slate-900 text-balance">
            Tải lên & map cột
          </h3>
        </div>
      </div>

      <div className="grid gap-2 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.7fr)] lg:items-start">
        <label
          className={`relative flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded border border-dashed px-4 py-4 text-center transition-colors focus-within:ring-2 focus-within:ring-blue-500 ${
            file
              ? "border-emerald-300 bg-emerald-50 text-emerald-900"
              : "border-blue-300 bg-blue-50 text-blue-900 hover:bg-blue-100"
          }`}
        >
          <input
            type="file"
            accept=".xlsx"
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            onChange={(event) => onFile(event.target.files?.[0] ?? null)}
          />
          <span className="inline-flex h-11 w-11 items-center justify-center rounded bg-white shadow-sm">
            {file ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-700" aria-hidden />
            ) : (
              <Upload className="h-5 w-5 text-blue-700" aria-hidden />
            )}
          </span>
          <span className="text-sm font-bold">Chọn file Excel</span>
          <span className="max-w-full truncate text-xs font-medium text-slate-600">
            {file ? file.name : ".xlsx"}
          </span>
        </label>

        <div className="grid gap-1">
          {preview ? (
            <label className="grid gap-1">
              <span className="text-xs font-bold tracking-[0.12em] text-slate-700 uppercase">
                Sheet
              </span>
              <select
                className="rounded border border-slate-400 px-3 py-2 text-sm"
                value={activeSheet?.name ?? ""}
                onChange={(event) => onSheetChange(event.target.value)}
              >
                {preview.sheets.map((sheet) => (
                  <option key={sheet.name} value={sheet.name}>
                    {sheet.name} ({sheet.rowCount.toLocaleString("vi-VN")} dòng)
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="rounded border border-dashed border-slate-400 bg-slate-50 px-3 py-4 text-sm text-slate-700 shadow-[var(--shadow-flat)]">
              {isPreviewLoading ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Đang đọc file…
                </span>
              ) : (
                "Chọn file để xem cột nhận diện được…"
              )}
            </div>
          )}

          {activeSheet ? (
            <div className="grid gap-1 rounded border border-slate-400 bg-slate-50 p-3 text-xs text-slate-600 shadow-[var(--shadow-flat)]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-extrabold text-slate-900">Map cột Excel</p>
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onResetMapping(activeSheet)}
                  >
                    Auto map lại
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onClearMapping(activeSheet)}
                  >
                    Xóa mapping
                  </Button>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                {MAPPING_FIELDS.map((field) => {
                  const id = `mapping-${activeSheet.name}-${field.key}`;
                  return (
                    <label key={field.key} htmlFor={id} className="grid gap-1">
                      <span className="font-semibold text-slate-600">
                        {field.label}
                        {field.required ? (
                          <span className="text-rose-600"> *</span>
                        ) : null}
                      </span>
                      <select
                        id={id}
                        name={id}
                        value={activeMapping[field.key] ?? ""}
                        onChange={(event) =>
                          onMappingChange(
                            activeSheet,
                            field.key,
                            event.target.value || null,
                          )
                        }
                        className={`rounded border px-2 py-1.5 text-sm focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none ${
                          field.required && !activeMapping[field.key]
                            ? "border-amber-300 bg-amber-50"
                            : "border-slate-500 bg-white shadow-sm"
                        }`}
                      >
                        <option value="">Không map</option>
                        {activeSheet.headers.map((header) => (
                          <option key={`${field.key}-${header}`} value={header}>
                            {header}
                          </option>
                        ))}
                      </select>
                    </label>
                  );
                })}
              </div>

              <div className="flex flex-wrap gap-1.5">
                {checklist.map((item) => (
                  <span
                    key={item.label}
                    className={`rounded-full px-2 py-1 text-xs font-semibold ${
                      item.done
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-white text-slate-700"
                    }`}
                  >
                    {item.done ? "✓ " : ""}
                    {item.label}
                  </span>
                ))}
              </div>

              {!hasNameColumn ? (
                <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-amber-800">
                  Chưa map cột tên vật tư. Chọn cột ở trường “Tên vật tư” để
                  tiếp tục đối chiếu.
                </p>
              ) : null}
            </div>
          ) : null}

          <Button
            variant="primary"
            leftIcon={<Search className="h-4 w-4" />}
            disabled={!file || !hasNameColumn || isPreviewLoading}
            isLoading={isMatching}
            onClick={onMatch}
          >
            Đối chiếu catalog
          </Button>
        </div>
      </div>

      <EnrichXlsxPreviewPanel
        sheet={activeSheet}
        isLoading={isPreviewLoading}
      />
    </section>
  );
}

function EnrichXlsxPreviewPanel({
  sheet,
  isLoading,
}: {
  sheet: EnrichPreviewSheet | undefined;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="border-t border-slate-400 px-4 py-4">
        <div className="flex items-center gap-2 rounded border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Đang đọc file và tạo preview…
        </div>
      </div>
    );
  }

  if (!sheet) {
    return null;
  }

  const mappedHeaders = new Set(
    Object.values(sheet.suggestedMapping).filter(
      (header): header is string => Boolean(header),
    ),
  );
  const headers = sheet.headers.length > 0 ? sheet.headers : ["(trống)"];

  return (
    <div className="border-t border-slate-400">
      <div className="flex flex-wrap items-start justify-between gap-1 px-4 py-3">
        <div>
          <p className="text-xs font-bold tracking-[0.12em] text-slate-700 uppercase">
            Xem trước Excel
          </p>
          <p className="mt-1 text-sm font-bold text-slate-900">{sheet.name}</p>
          <p className="mt-0.5 text-xs text-slate-700">
            Header dòng {sheet.activeHeaderRowIndex};{" "}
            {sheet.rowCount.toLocaleString("vi-VN")} dòng dữ liệu.
          </p>
        </div>
        <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-bold text-blue-800 tabular-nums">
          {sheet.previewRows.length.toLocaleString("vi-VN")} dòng preview
        </span>
      </div>

      <div className="px-4 pb-4">
        {sheet.warnings.length > 0 ? (
          <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {sheet.warnings[0]}
          </div>
        ) : null}

        {sheet.previewRows.length > 0 ? (
          <div className="overflow-x-auto rounded border border-slate-400">
            <table className="w-full min-w-[36rem] divide-y divide-slate-200 text-sm break-words">
              <thead className="bg-slate-100 text-left text-xs font-bold text-slate-600 uppercase">
                <tr>
                  <th className="sticky left-0 z-10 bg-slate-100 px-3 py-2 whitespace-nowrap">
                    Dòng
                  </th>
                  {headers.map((header) => (
                    <th
                      key={header}
                      className={`max-w-48 px-3 py-2 whitespace-nowrap ${
                        mappedHeaders.has(header)
                          ? "bg-blue-100 text-blue-900"
                          : ""
                      }`}
                    >
                      <span className="line-clamp-2">{header}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {sheet.previewRows.map((row, index) => (
                  <tr key={row.key}>
                    <td className="sticky left-0 z-10 bg-white px-3 py-2 font-semibold text-slate-700 tabular-nums whitespace-nowrap">
                      {sheet.activeHeaderRowIndex + index + 1}
                    </td>
                    {headers.map((header) => (
                      <td
                        key={`${row.key}-${header}`}
                        className="max-w-56 px-3 py-2 text-slate-700"
                      >
                        <span className="line-clamp-3">
                          {(row.values[header]?.trim() ?? "") || "-"}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded border border-dashed border-slate-400 bg-slate-50 px-3 py-4 text-sm text-slate-700">
            Không có dòng dữ liệu để preview trên sheet này.
          </div>
        )}
      </div>
    </div>
  );
}


function EnrichExportPreviewPanel({
  matchData,
  decisions,
  sheetEdits,
  fillsOnly,
  onFillsOnlyChange,
  onSheetEdit,
  onResetRowSheetEdits,
  onToggleSheetOverwrite,
  onSkipSheetField,
  onSkipSheetRow,
}: {
  matchData: MatchResponse;
  decisions: Map<number, RowDecision>;
  sheetEdits: SheetEdits;
  fillsOnly: boolean;
  onFillsOnlyChange: (value: boolean) => void;
  onSheetEdit: (rowIndex: number, field: FillableField, value: string | null) => void;
  onResetRowSheetEdits: (rowIndex: number) => void;
  onToggleSheetOverwrite: (rowIndex: number, field: FillableField) => void;
  onSkipSheetField: (rowIndex: number, field: FillableField) => void;
  onSkipSheetRow: (rowIndex: number) => void;
}) {
  const preview = useMemo(
    () =>
      buildExportPreviewRows(
        matchData.results.map((row) => ({
          originalRowIndex: row.originalRowIndex,
          name: row.name,
          sheetFields: row.sheetFields,
          candidates: row.candidates,
        })),
        decisions,
        { fillsOnly, sheetEdits },
      ),
    [matchData.results, decisions, fillsOnly, sheetEdits],
  );
  const editedCellCount = Object.values(sheetEdits).reduce(
    (count, row) => count + Object.keys(row).length,
    0,
  );

  const actionLabels: Record<string, string> = {
    filled: "Điền mới",
    overwritten: "Ghi đè",
    kept: "Giữ nguyên",
    "missing-both": "—",
  };

  return (
    <div className="overflow-hidden rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-400 px-4 py-3">
        <div>
          <p className="text-xs font-bold tracking-[0.12em] text-slate-700 uppercase">
            Xem trước xuất file
          </p>
          <p className="mt-1 text-xs text-slate-700">
            {preview.totalExportable.toLocaleString("vi-VN")} dòng sẽ được xuất
            {preview.truncated
              ? ` · hiển thị ${preview.rows.length.toLocaleString("vi-VN")} dòng đầu`
              : ""}
            {editedCellCount > 0
              ? ` · ${editedCellCount.toLocaleString("vi-VN")} ô đã sửa`
              : ""}
          </p>
        </div>
        <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600">
          <input
            type="checkbox"
            checked={fillsOnly}
            onChange={(event) => onFillsOnlyChange(event.target.checked)}
          />
          Chỉ ô sẽ điền
        </label>
      </div>

      {preview.rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-slate-700">
          Chưa có ô nào được chọn để xuất.
        </p>
      ) : (
        <div className="max-h-96 overflow-auto">
          <table className="w-full min-w-[40rem] divide-y divide-slate-200 text-xs">
            <thead className="sticky top-0 bg-slate-100 text-left font-bold text-slate-600 uppercase">
              <tr>
                <th className="px-3 py-2 whitespace-nowrap">Dòng</th>
                <th className="px-3 py-2 whitespace-nowrap">Sản phẩm</th>
                <th className="px-3 py-2 whitespace-nowrap">Trường</th>
                <th className="px-3 py-2 whitespace-nowrap">Trước</th>
                <th className="px-3 py-2 whitespace-nowrap">Sau / chỉnh sửa</th>
                <th className="px-3 py-2 whitespace-nowrap">Hành động</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {preview.rows.flatMap((row) =>
                row.cells.map((cell, cellIndex) => {
                  const rowEdits = sheetEdits[rowEditKey(row.originalRowIndex)];
                  const decision = decisions.get(row.originalRowIndex);
                  const isForced = decision?.overwriteFields?.has(cell.field) ?? false;
                  const currentValue = rowEdits?.[cell.field] ?? cell.after;
                  return (
                    <tr key={`${row.originalRowIndex}-${cell.field}`}>
                    <td className="px-3 py-2 font-semibold text-slate-700 tabular-nums whitespace-nowrap">
                      {row.originalRowIndex}
                    </td>
                    <td className="max-w-40 truncate px-3 py-2 text-slate-700">
                      {row.productName || "—"}
                    </td>
                    <td className="px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">
                      {FIELD_LABELS[cell.field]}
                    </td>
                    <td className="max-w-32 truncate px-3 py-2 text-slate-700">
                      {cell.before || "(trống)"}
                    </td>
                    <td className="min-w-48 px-3 py-2">
                      <input
                        type={cell.field === "defaultUnitPrice" ? "number" : "text"}
                        inputMode={
                          cell.field === "defaultUnitPrice" ? "decimal" : undefined
                        }
                        value={currentValue}
                        onChange={(event) =>
                          onSheetEdit(
                            row.originalRowIndex,
                            cell.field,
                            event.target.value,
                          )
                        }
                        className="w-full rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] px-2 py-1 text-xs font-medium text-emerald-700 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
                        aria-label={`Chỉnh ${FIELD_LABELS[cell.field]} dòng ${row.originalRowIndex}`}
                      />
                    </td>
                    <td className="px-3 py-2 text-slate-700 whitespace-nowrap">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span>{isForced ? "Ghi đè bắt buộc" : (actionLabels[cell.action] ?? cell.action)}</span>
                        <button
                          type="button"
                          onClick={() =>
                            onSheetEdit(row.originalRowIndex, cell.field, null)
                          }
                          className="rounded border border-slate-400 px-1.5 py-0.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
                        >
                          Reset ô
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            onSheetEdit(row.originalRowIndex, cell.field, "")
                          }
                          className="rounded border border-slate-400 px-1.5 py-0.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
                        >
                          Xóa giá trị
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            onToggleSheetOverwrite(row.originalRowIndex, cell.field)
                          }
                          className="rounded border border-slate-400 px-1.5 py-0.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
                        >
                          {isForced ? "Bỏ ghi đè" : "Ghi đè bắt buộc"}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            onSkipSheetField(row.originalRowIndex, cell.field)
                          }
                          className="rounded border border-slate-400 px-1.5 py-0.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
                        >
                          Bỏ qua field
                        </button>
                        {cellIndex === 0 ? (
                          <>
                            <button
                              type="button"
                              onClick={() => onResetRowSheetEdits(row.originalRowIndex)}
                              className="rounded border border-slate-400 px-1.5 py-0.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
                            >
                              Reset dòng
                            </button>
                            <button
                              type="button"
                              onClick={() => onSkipSheetRow(row.originalRowIndex)}
                              className="rounded border border-rose-200 px-1.5 py-0.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
                            >
                              Bỏ qua dòng
                            </button>
                          </>
                        ) : null}
                        <button
                          type="button"
                          onClick={() =>
                            preview.rows.forEach((targetRow) => {
                              const targetCell = targetRow.cells.find(
                                (item) => item.field === cell.field,
                              );
                              if (!targetCell || targetCell.before.trim()) return;
                              onSheetEdit(
                                targetRow.originalRowIndex,
                                cell.field,
                                currentValue,
                              );
                            })
                          }
                          className="rounded border border-slate-400 px-1.5 py-0.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
                        >
                          Áp dụng ô trống
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                }),
              )}
            </tbody>
          </table>
        </div>
      )}
      {preview.rows.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-400 bg-slate-50 px-4 py-2">
          <p className="text-xs text-slate-700">
            Chỉnh trực tiếp giá trị cuối cùng trước khi xuất. Giá trị sửa ở đây
            sẽ ưu tiên hơn kết quả catalog/web.
          </p>
          <Button
            variant="ghost"
            size="sm"
            disabled={editedCellCount === 0}
            onClick={() =>
              preview.rows.forEach((row) =>
                onResetRowSheetEdits(row.originalRowIndex),
              )
            }
          >
            Reset các ô đang hiển thị
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ExportStep({
  matchData,
  decisions,
  sheetEdits,
  onSheetEdit,
  onResetRowSheetEdits,
  onToggleSheetOverwrite,
  onSkipSheetField,
  onSkipSheetRow,
  fieldsToFill,
  matchedCount,
  pendingUnmatched,
  pendingReview,
  isExporting,
  isResearchExporting,
  hasResearchJob,
  researchJobId,
  onExport,
  onExportClean,
  onExportResearch,
  onBack,
}: {
  matchData: MatchResponse;
  decisions: Map<number, RowDecision>;
  sheetEdits: SheetEdits;
  onSheetEdit: (rowIndex: number, field: FillableField, value: string | null) => void;
  onResetRowSheetEdits: (rowIndex: number) => void;
  onToggleSheetOverwrite: (rowIndex: number, field: FillableField) => void;
  onSkipSheetField: (rowIndex: number, field: FillableField) => void;
  onSkipSheetRow: (rowIndex: number) => void;
  fieldsToFill: number;
  matchedCount: number;
  pendingUnmatched: number;
  pendingReview: number;
  isExporting: boolean;
  isResearchExporting: boolean;
  hasResearchJob: boolean;
  researchJobId: string | null;
  onExport: () => void;
  onExportClean: () => void;
  onExportResearch: () => void;
  onBack: () => void;
}) {
  const [fillsOnly, setFillsOnly] = useState(true);

  const researchRowsQuery = api.excelResearch.listRowResults.useQuery(
    { jobId: researchJobId ?? EMPTY_JOB_ID, limit: 50 },
    { enabled: researchJobId != null },
  );

  const stats: Array<{ label: string; value: number }> = [
    { label: "Tổng dòng", value: matchData.matchedRows },
    { label: "Đã khớp", value: matchedCount },
    { label: "Ô sẽ điền", value: fieldsToFill },
    { label: "Cần duyệt", value: pendingReview },
    { label: "Chưa khớp", value: pendingUnmatched },
  ];
  const nothingToExport = fieldsToFill === 0;
  const editedCellCount = Object.values(sheetEdits).reduce(
    (count, row) => count + Object.keys(row).length,
    0,
  );

  const researchApprovedCount =
    researchRowsQuery.data?.items.filter(
      (row) => row.status === "approved" || row.status === "matched",
    ).length ?? 0;

  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-slate-400 bg-slate-50 px-4 py-3">
        <h3 className="text-sm font-bold text-slate-900 text-balance">Xuất file</h3>
        <p className="mt-1 text-xs text-slate-700">
          Xem trước các ô sẽ điền, sau đó tải file đối chiếu catalog hoặc file
          nghiên cứu web nếu đã chạy bước 3.
        </p>
      </div>

      <div className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-5">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] p-3"
            >
              <p className="text-xs font-medium text-slate-700">{stat.label}</p>
              <p className="mt-1 text-xl font-bold text-slate-900 tabular-nums">
                {stat.value.toLocaleString("vi-VN")}
              </p>
            </div>
          ))}
        </div>

        <EnrichExportPreviewPanel
          matchData={matchData}
          decisions={decisions}
          sheetEdits={sheetEdits}
          fillsOnly={fillsOnly}
          onFillsOnlyChange={setFillsOnly}
          onSheetEdit={onSheetEdit}
          onResetRowSheetEdits={onResetRowSheetEdits}
          onToggleSheetOverwrite={onToggleSheetOverwrite}
          onSkipSheetField={onSkipSheetField}
          onSkipSheetRow={onSkipSheetRow}
        />

        <div className="grid gap-2 rounded border border-slate-400 bg-slate-50 p-3 text-xs text-slate-600 sm:grid-cols-2 lg:grid-cols-4">
          <span className="font-semibold text-slate-800">
            Sẵn sàng xuất: {nothingToExport ? "chưa" : "có"}
          </span>
          <span>{editedCellCount.toLocaleString("vi-VN")} ô đã sửa tay</span>
          <span>
            {(pendingUnmatched + pendingReview).toLocaleString("vi-VN")} dòng còn cảnh báo
          </span>
          <span>{fieldsToFill.toLocaleString("vi-VN")} ô được chọn điền</span>
        </div>

        {hasResearchJob ? (
          <p className="rounded border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-900">
            File nghiên cứu web:{" "}
            {researchApprovedCount.toLocaleString("vi-VN")} dòng đã duyệt/khớp
            sẽ được xuất (xem chi tiết ở bước 3).
          </p>
        ) : null}

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {hasResearchJob ? (
            <div className="flex flex-col gap-1.5 rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] p-3">
              <Button
                variant="primary"
                leftIcon={<Download className="h-4 w-4" />}
                isLoading={isResearchExporting}
                onClick={onExportResearch}
              >
                Xuất file nghiên cứu web (.xlsx)
              </Button>
              <p className="text-xs text-slate-700">
                Điền theo kết quả nghiên cứu web đã duyệt ở bước 3.
              </p>
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5 rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] p-3">
            <Button
              variant={hasResearchJob ? "secondary" : "primary"}
              leftIcon={<Download className="h-4 w-4" />}
              isLoading={isExporting}
              disabled={nothingToExport}
              onClick={onExport}
            >
              Xuất file đối chiếu catalog (.xlsx)
            </Button>
            <p className="text-xs text-slate-700">
              Giữ nguyên file gốc và điền các ô bạn đã chọn ở bước đối chiếu.
            </p>
          </div>

          <div className="flex flex-col gap-1.5 rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] p-3">
            <Button
              variant="secondary"
              disabled={isExporting || nothingToExport}
              onClick={onExportClean}
            >
              Tải bản chuẩn
            </Button>
            <p className="text-xs text-slate-700">
              Tạo file mới theo cột chuẩn, chỉ gồm dữ liệu đã đối chiếu.
            </p>
          </div>
        </div>

        <Button variant="ghost" onClick={onBack}>
          Quay lại nghiên cứu web
        </Button>
      </div>
    </section>
  );
}
