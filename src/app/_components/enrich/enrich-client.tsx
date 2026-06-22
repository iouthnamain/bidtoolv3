"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Globe,
  Loader2,
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
import {
  ManualProductForm,
  type ManualProductValues,
} from "~/app/_components/enrich/manual-product-dialog";
import { type EnrichCandidate } from "~/app/_components/enrich/product-candidate-card";
import {
  applySavedMaterialToDecision,
  applyWebSearchToDecision,
  buildExportPreviewRows,
  countFieldsToFill,
  countResolvedRows,
  effectiveAcceptedFieldValues,
  isExportableDecision,
  webFieldsAfterGapFill,
} from "~/lib/materials/enrich-gap-fill";
import {
  buildFillPlan,
  candidateToFields,
  FIELD_LABELS,
  type FillableField,
  FILLABLE_FIELDS,
} from "~/lib/materials/excel-enrich-fields";
import type { MaterialEnrichmentEvidence } from "~/lib/materials/material-enrichment-types";
import { parseOptionalNumber } from "~/lib/materials/format";
import { api, type RouterOutputs } from "~/trpc/react";

type EnrichPreview = RouterOutputs["material"]["enrichPreviewXlsx"];
type EnrichPreviewSheet = EnrichPreview["sheets"][number];
type MatchResponse = RouterOutputs["material"]["enrichMatchRows"];
type MatchRow = MatchResponse["results"][number];
type FillPlanCell = MatchRow["fillPlan"][number];

const STATUS_META: Record<
  MatchRow["status"],
  { label: string; tone: "success" | "warning" | "neutral" }
> = {
  auto: { label: "Tự động", tone: "success" },
  review: { label: "Cần duyệt", tone: "warning" },
  unmatched: { label: "Chưa khớp", tone: "neutral" },
};

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

// Per-row, user-editable decision state: chosen material + ticked fields.
type RowDecision = {
  materialId: number | null;
  acceptedFields: Set<FillableField>;
  // Fields the user chose to force-overwrite even though the sheet already has a
  // value (Contract O: fed into buildFillPlan as `forceOverwrite` and exported
  // as `overwriteFields`).
  overwriteFields?: Set<FillableField>;
  // Per-field inline edits: user-typed values that override the candidate's
  // value at export time. Threaded into the export decision as `valueOverrides`.
  editedValues?: Partial<Record<FillableField, string>>;
  webProposedFields?: Partial<Record<FillableField, string>>;
  webEvidence?: MaterialEnrichmentEvidence[];
  webSearchStatus?: "idle" | "pending" | "done" | "error";
  // User explicitly chose to skip this row (vs. simply not decided yet).
  skipped?: boolean;
};

/**
 * Derive a fill plan + the set of fillable fields for an arbitrary chosen
 * candidate, computed client-side. The server only returns a fill plan for the
 * row's auto/review match; when the user picks a different card (including a
 * manual-search result) we recompute against the sheet's own field values.
 */
function planForCandidate(
  sheetFields: Partial<Record<FillableField, string>>,
  candidate: EnrichCandidate | null,
): { plan: FillPlanCell[]; fillable: Set<FillableField> } {
  if (!candidate) return { plan: [], fillable: new Set() };
  const materialFields = candidateToFields(candidate);
  const plan = buildFillPlan(sheetFields, materialFields);
  const fillable = new Set<FillableField>(
    plan
      .filter((cell) => cell.action === "filled")
      .map((cell) => cell.field),
  );
  return { plan, fillable };
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
  const [statusFilter, setStatusFilter] = useState<MatchRow["status"] | "all">(
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

  const previewRequestRef = useRef(0);

  const activeSheet: EnrichPreviewSheet | undefined =
    preview?.sheets.find((s) => s.name === sheetName) ?? preview?.sheets[0];

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
          },
          onError: (err) =>
            setError(err.message || "Không tạo được preview Excel."),
        },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không đọc được tệp Excel.");
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
        mapping: activeSheet.suggestedMapping as Record<string, string | null>,
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
          if (result.truncated) {
            toast.warning(
              `Chỉ đối chiếu ${result.matchedRows.toLocaleString("vi-VN")}/${result.totalRows.toLocaleString("vi-VN")} dòng (giới hạn).`,
            );
          }
        },
        onError: (err) => setError(err.message || "Không đối chiếu được."),
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

  const updateDecision = (rowIndex: number, next: RowDecision) => {
    setDecisions((prev) => {
      const map = new Map(prev);
      map.set(rowIndex, next);
      return map;
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
        valueOverrides: decision.editedValues ?? {},
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
        mapping: activeSheet.suggestedMapping as Record<string, string | null>,
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

  return (
    <div className="animate-rise space-y-4">
      <StepHeader current={step} maxReached={maxReached} onJump={setStep} />

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
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
          isPreviewLoading={previewXlsx.isPending}
          isMatching={matchRowsMutation.isPending}
          onFile={handleFile}
          onSheetChange={setSheetName}
          onMatch={runMatch}
        />
      ) : null}

      {step === 2 && matchData ? (
        <ReviewStep
          matchData={matchData}
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
          onContinue={() => reach(3)}
        />
      ) : null}

      {step === 3 && file && base64 && activeSheet ? (
        <EnrichResearchStep
          fileName={file.name}
          workbookBase64={base64}
          sheetName={activeSheet.name}
          headerRowIndex={activeSheet.activeHeaderRowIndex}
          mapping={
            activeSheet.suggestedMapping as Record<string, string | null>
          }
          unmatchedCount={pendingUnmatched}
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
  isPreviewLoading,
  isMatching,
  onFile,
  onSheetChange,
  onMatch,
}: {
  file: File | null;
  preview: EnrichPreview | null;
  activeSheet: EnrichPreviewSheet | undefined;
  isPreviewLoading: boolean;
  isMatching: boolean;
  onFile: (file: File | null) => void;
  onSheetChange: (name: string) => void;
  onMatch: () => void;
}) {
  const hasNameColumn = Boolean(activeSheet?.suggestedMapping.materialName);

  return (
    <section className="panel overflow-hidden rounded-xl shadow-[var(--shadow-flat)]">
      <div className="border-b border-sky-200 bg-sky-50 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-sky-700 text-white">
            <FileSpreadsheet className="h-4 w-4" aria-hidden />
          </span>
          <h3 className="text-sm font-extrabold text-slate-900 text-balance">
            Tải lên & map cột
          </h3>
        </div>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.7fr)] lg:items-start">
        <label
          className={`relative flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-4 text-center transition-colors focus-within:ring-2 focus-within:ring-sky-500 sm:min-h-44 ${
            file
              ? "border-emerald-300 bg-emerald-50 text-emerald-900"
              : "border-sky-300 bg-gradient-to-br from-sky-50 to-white text-sky-900 hover:bg-sky-100"
          }`}
        >
          <input
            type="file"
            accept=".xlsx"
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            onChange={(event) => onFile(event.target.files?.[0] ?? null)}
          />
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-white shadow-sm">
            {file ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-700" aria-hidden />
            ) : (
              <Upload className="h-5 w-5 text-sky-700" aria-hidden />
            )}
          </span>
          <span className="text-sm font-bold">Chọn file Excel</span>
          <span className="max-w-full truncate text-xs font-medium text-slate-600">
            {file ? file.name : ".xlsx"}
          </span>
        </label>

        <div className="grid gap-3">
          {preview ? (
            <label className="grid gap-1">
              <span className="text-xs font-bold tracking-[0.12em] text-slate-500 uppercase">
                Sheet
              </span>
              <select
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
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
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm text-slate-500 shadow-[var(--shadow-flat)]">
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
            <div className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 shadow-[var(--shadow-flat)]">
              <p className="font-extrabold text-slate-900">Cột nhận diện</p>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ["Tên", activeSheet.suggestedMapping.materialName],
                    ["Mã", activeSheet.suggestedMapping.code],
                    ["ĐVT", activeSheet.suggestedMapping.unit],
                    ["Nhóm", activeSheet.suggestedMapping.category],
                    ["Thông số", activeSheet.suggestedMapping.specText],
                    ["NSX", activeSheet.suggestedMapping.vendorHint],
                    ["Xuất xứ", activeSheet.suggestedMapping.originHint],
                    ["Đơn giá", activeSheet.suggestedMapping.unitPrice],
                  ] as Array<[string, string | null | undefined]>
                )
                  .filter(([, value]) => Boolean(value))
                  .map(([label, value]) => (
                    <span
                      key={label}
                      className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-slate-600"
                    >
                      {label}: {value}
                    </span>
                  ))}
              </div>
              {!hasNameColumn ? (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-amber-800">
                  Chưa nhận diện được cột tên vật tư — không thể đối chiếu.
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
      <div className="border-t border-slate-200 px-4 py-4">
        <div className="flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
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
    <div className="border-t border-slate-200">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
        <div>
          <p className="text-xs font-bold tracking-[0.12em] text-slate-500 uppercase">
            Xem trước Excel
          </p>
          <p className="mt-1 text-sm font-bold text-slate-900">{sheet.name}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            Header dòng {sheet.activeHeaderRowIndex};{" "}
            {sheet.rowCount.toLocaleString("vi-VN")} dòng dữ liệu.
          </p>
        </div>
        <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-bold text-sky-800 tabular-nums">
          {sheet.previewRows.length.toLocaleString("vi-VN")} dòng preview
        </span>
      </div>

      <div className="px-4 pb-4">
        {sheet.warnings.length > 0 ? (
          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {sheet.warnings[0]}
          </div>
        ) : null}

        {sheet.previewRows.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
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
                          ? "bg-sky-100 text-sky-900"
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
                    <td className="sticky left-0 z-10 bg-white px-3 py-2 font-semibold text-slate-500 tabular-nums whitespace-nowrap">
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
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm text-slate-500">
            Không có dòng dữ liệu để preview trên sheet này.
          </div>
        )}
      </div>
    </div>
  );
}

function ReviewStep({
  matchData,
  decisions,
  updateDecision,
  applyDecisions,
  statusFilter,
  setStatusFilter,
  selectedRowIndex,
  setSelectedRowIndex,
  fieldsToFill,
  matchedCount,
  pendingUnmatched,
  onContinue,
}: {
  matchData: MatchResponse;
  decisions: Map<number, RowDecision>;
  updateDecision: (rowIndex: number, next: RowDecision) => void;
  applyDecisions: (
    updater: (prev: Map<number, RowDecision>) => Map<number, RowDecision>,
  ) => void;
  statusFilter: MatchRow["status"] | "all";
  setStatusFilter: (value: MatchRow["status"] | "all") => void;
  selectedRowIndex: number | null;
  setSelectedRowIndex: (value: number | null) => void;
  fieldsToFill: number;
  matchedCount: number;
  pendingUnmatched: number;
  onContinue: () => void;
}) {
  const toast = useToast();
  const webSearch = api.material.enrichWebSearchRow.useMutation();
  const selectedRowIndexRef = useRef(selectedRowIndex);
  selectedRowIndexRef.current = selectedRowIndex;
  const rows = matchData.results;

  const filtered =
    statusFilter === "all"
      ? rows
      : rows.filter((row) => row.status === statusFilter);

  // Reset selection to the first filtered row when the active filter excludes
  // the currently-selected row (so the detail pane never shows a hidden row).
  useEffect(() => {
    if (filtered.length === 0) return;
    if (!filtered.some((row) => row.originalRowIndex === selectedRowIndex)) {
      setSelectedRowIndex(filtered[0]!.originalRowIndex);
    }
  }, [filtered, selectedRowIndex, setSelectedRowIndex]);

  if (rows.length === 0) {
    return (
      <section className="panel p-5">
        <EmptyState
          title="Không có dòng để đối chiếu"
          description="File không có dòng dữ liệu hợp lệ với cột tên vật tư đã chọn."
        />
      </section>
    );
  }

  // Counts derived from the user's decisions so chips/headers reflect manual
  // picks and skips, not just the server's static classification.
  const reviewCount = rows.filter((row) => row.status === "review").length;
  const filters: Array<{
    id: MatchRow["status"] | "all";
    label: string;
    count: number;
  }> = [
    { id: "all", label: "Tất cả", count: rows.length },
    { id: "auto", label: STATUS_META.auto.label, count: matchData.summary.auto },
    { id: "review", label: STATUS_META.review.label, count: reviewCount },
    { id: "unmatched", label: STATUS_META.unmatched.label, count: pendingUnmatched },
  ];

  const selectedRow =
    rows.find((row) => row.originalRowIndex === selectedRowIndex) ?? null;

  const catalogFieldsForRow = (
    row: MatchRow,
    materialId: number | null,
  ): Partial<Record<FillableField, string>> | null => {
    if (materialId == null) return null;
    const candidate =
      row.candidates.find((c) => c.materialId === materialId) ?? null;
    return candidate ? candidateToFields(candidate) : null;
  };

  const handleWebSearch = (row: MatchRow) => {
    const rowIndex = row.originalRowIndex;
    const decision = decisions.get(rowIndex) ?? {
      materialId: null,
      acceptedFields: new Set<FillableField>(),
    };
    updateDecision(rowIndex, {
      ...decision,
      webSearchStatus: "pending",
      webEvidence: [],
    });

    const catalogFieldsAtStart = catalogFieldsForRow(row, decision.materialId);

    webSearch.mutate(
      {
        name: row.name,
        code: row.sheetFields.code,
        manufacturer: row.sheetFields.manufacturer,
        specText: row.sheetFields.specText,
        unit: row.sheetFields.unit,
        category: row.sheetFields.category,
      },
      {
        onSuccess: (result) => {
          applyDecisions((prev) => {
            const current = prev.get(rowIndex);
            if (!current) return prev;
            const targetRow = rows.find(
              (r) => r.originalRowIndex === rowIndex,
            );
            if (!targetRow) return prev;

            if (Object.keys(result.fields).length === 0) {
              const next = new Map(prev);
              next.set(rowIndex, {
                ...current,
                webSearchStatus: "error",
              });
              return next;
            }

            const catalog = catalogFieldsForRow(
              targetRow,
              current.materialId,
            );
            const next = new Map(prev);
            next.set(
              rowIndex,
              applyWebSearchToDecision(
                current,
                targetRow.sheetFields,
                catalog,
                result,
              ),
            );
            return next;
          });

          if (rowIndex === selectedRowIndexRef.current) {
            if (Object.keys(result.fields).length === 0) {
              toast.warning("Không tìm thấy thông tin sản phẩm trên web.");
            } else {
              const gapCount = Object.keys(
                webFieldsAfterGapFill(
                  row.sheetFields,
                  catalogFieldsAtStart,
                  result.fields,
                ),
              ).length;
              toast.success(`Đã điền ${gapCount} trường từ web.`);
            }
          }
        },
        onError: (error) => {
          applyDecisions((prev) => {
            const current = prev.get(rowIndex);
            if (!current) return prev;
            const next = new Map(prev);
            next.set(rowIndex, {
              ...current,
              webSearchStatus: "error",
            });
            return next;
          });
          if (rowIndex === selectedRowIndexRef.current) {
            toast.error(
              error.message || "Không tìm được thông tin trên web.",
            );
          }
        },
      },
    );
  };

  const confirmAllAuto = () => {
    applyDecisions((prev) => {
      const next = new Map(prev);
      for (const row of rows) {
        if (row.status !== "auto" || !row.topCandidate) continue;
        const accepted = new Set<FillableField>(
          row.fillPlan
            .filter((cell) => cell.action === "filled")
            .map((cell) => cell.field),
        );
        next.set(row.originalRowIndex, {
          materialId: row.topCandidate.materialId,
          acceptedFields: accepted,
        });
      }
      return next;
    });
  };

  const skipAllUnmatched = () => {
    applyDecisions((prev) => {
      const next = new Map(prev);
      for (const row of rows) {
        if (row.status !== "unmatched") continue;
        // Don't clobber an unmatched row the user already matched manually.
        if (prev.get(row.originalRowIndex)?.materialId != null) continue;
        next.set(row.originalRowIndex, {
          materialId: null,
          acceptedFields: new Set(),
          skipped: true,
        });
      }
      return next;
    });
  };

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900 text-balance">
            Xét duyệt & chọn sản phẩm
          </h3>
          <p className="mt-1 flex flex-wrap gap-3 text-xs text-slate-500">
            <span className="tabular-nums">{matchData.matchedRows.toLocaleString("vi-VN")} dòng</span>
            <span className="tabular-nums">{matchedCount.toLocaleString("vi-VN")} đã chọn</span>
            <span className="tabular-nums">{fieldsToFill.toLocaleString("vi-VN")} ô sẽ điền</span>
            <span className="tabular-nums">
              {pendingUnmatched.toLocaleString("vi-VN")} chưa khớp
            </span>
          </p>
        </div>
        <Button
          variant="primary"
          size="sm"
          leftIcon={<Download className="h-3.5 w-3.5" />}
          disabled={rows.length === 0}
          onClick={onContinue}
        >
          Tiếp tục xuất file
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-2">
        <div className="flex flex-wrap gap-1.5">
          {filters.map((filter) => (
            <button
              key={filter.id}
              type="button"
              onClick={() => setStatusFilter(filter.id)}
              className={`rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ${
                statusFilter === filter.id
                  ? "bg-slate-800 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {filter.label} ({filter.count.toLocaleString("vi-VN")})
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap gap-1.5">
          <Button
            variant="secondary"
            size="sm"
            disabled={matchData.summary.auto === 0}
            onClick={confirmAllAuto}
          >
            Xác nhận tất cả ≥ 85%
          </Button>
          <Button
            variant="warning"
            size="sm"
            disabled={pendingUnmatched === 0}
            onClick={skipAllUnmatched}
          >
            Bỏ qua chưa khớp
            {pendingUnmatched > 0 ? ` (${pendingUnmatched.toLocaleString("vi-VN")})` : ""}
          </Button>
        </div>
      </div>

      <div className="grid lg:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)]">
        {/* Master: row list */}
        <div className="max-h-[32rem] divide-y divide-slate-100 overflow-y-auto border-b border-slate-200 lg:max-h-[40rem] lg:border-b-0 lg:border-r">
          {filtered.map((row) => {
            const meta = STATUS_META[row.status];
            const decision = decisions.get(row.originalRowIndex);
            const isSelected = row.originalRowIndex === selectedRowIndex;
            const name = row.name.trim()
              ? row.name
              : (row.topCandidate?.name ?? `Dòng ${row.originalRowIndex}`);
            return (
              <button
                key={row.originalRowIndex}
                type="button"
                onClick={() => setSelectedRowIndex(row.originalRowIndex)}
                className={`flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors ${
                  isSelected ? "bg-sky-50" : "hover:bg-slate-50"
                }`}
              >
                <Badge tone={meta.tone}>{meta.label}</Badge>
                {decision?.webSearchStatus === "pending" ? (
                  <Badge tone="info">Đang tìm web</Badge>
                ) : decision?.webSearchStatus === "error" ? (
                  <Badge tone="critical">Web lỗi</Badge>
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900">
                    {name}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Dòng {row.originalRowIndex}
                    {decision?.materialId != null
                      ? ` · đã chọn (${decision.acceptedFields.size} ô)`
                      : decision?.skipped
                        ? " · đã bỏ qua"
                        : decision &&
                            isExportableDecision(decision)
                          ? ` · đã điền (${decision.acceptedFields.size} ô)`
                          : decision?.webSearchStatus === "error"
                            ? " · tìm web thất bại"
                            : row.status === "unmatched"
                            ? " · chưa chọn"
                            : ""}
                  </p>
                </div>
              </button>
            );
          })}
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-slate-500">
              Không có dòng nào ở bộ lọc này.
            </p>
          ) : null}
        </div>

        {/* Detail: chooser for the selected row */}
        <div className="min-w-0 p-4">
          {selectedRow ? (
            <MatchChooser
              key={selectedRow.originalRowIndex}
              row={selectedRow}
              decision={decisions.get(selectedRow.originalRowIndex)}
              onChange={(next) =>
                updateDecision(selectedRow.originalRowIndex, next)
              }
              onWebSearch={() => handleWebSearch(selectedRow)}
              isWebSearchPending={
                decisions.get(selectedRow.originalRowIndex)?.webSearchStatus ===
                "pending"
              }
            />
          ) : (
            <EmptyState
              title="Chọn một dòng"
              description="Chọn một dòng ở danh sách bên trái để xem ứng viên ghép."
            />
          )}
        </div>
      </div>
    </section>
  );
}

function MatchChooser({
  row,
  decision,
  onChange,
  onWebSearch,
  isWebSearchPending,
}: {
  row: MatchRow;
  decision: RowDecision | undefined;
  onChange: (next: RowDecision) => void;
  onWebSearch: () => void;
  isWebSearchPending: boolean;
}) {
  const toast = useToast();
  const utils = api.useUtils();
  const [searchTerm, setSearchTerm] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const id = setTimeout(() => setDebounced(searchTerm.trim()), 300);
    return () => clearTimeout(id);
  }, [searchTerm]);

  const searchQuery = api.material.enrichSearchMaterials.useQuery(
    { query: debounced },
    { enabled: debounced.length > 0 },
  );
  const upsertMaterial = api.material.upsertMaterial.useMutation();

  const selectedId = decision?.materialId ?? null;
  const accepted = decision?.acceptedFields ?? new Set<FillableField>();
  const overwrite = decision?.overwriteFields ?? new Set<FillableField>();
  const editedValues = decision?.editedValues ?? {};
  const webProposedFields = decision?.webProposedFields ?? {};
  const webEvidence = decision?.webEvidence ?? [];
  const webSearchStatus = decision?.webSearchStatus;

  const sheetFields: Partial<Record<FillableField, string>> = row.sheetFields;

  const searchCandidates = (searchQuery.data?.candidates ??
    []) as EnrichCandidate[];
  const showingSearch = debounced.length > 0;
  const cards: EnrichCandidate[] = showingSearch
    ? searchCandidates
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

  const choose = (candidate: EnrichCandidate) => {
    const { fillable } = planForCandidate(sheetFields, candidate);
    const candidateFields = candidateToFields(candidate);
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
      acceptedFields: nextAccepted,
      overwriteFields: new Set(),
      editedValues: nextEdited,
      webProposedFields,
      webEvidence,
      webSearchStatus,
    });
  };

  const isSkipped = decision?.skipped === true;

  const toggleSkip = () => {
    onChange({
      materialId: null,
      acceptedFields: new Set(),
      overwriteFields: new Set(),
      editedValues: {},
      webProposedFields: {},
      webEvidence: [],
      skipped: !isSkipped,
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
      acceptedFields: next,
      overwriteFields: nextOverwrite,
      editedValues,
      webProposedFields,
      webEvidence,
      webSearchStatus,
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
      acceptedFields: nextAccepted,
      overwriteFields: nextOverwrite,
      editedValues,
      webProposedFields,
      webEvidence,
      webSearchStatus,
    });
  };

  const editValue = (field: FillableField, value: string) => {
    const nextEdited = { ...editedValues, [field]: value };
    const nextAccepted = new Set(accepted);
    nextAccepted.add(field);
    onChange({
      materialId: selectedId,
      acceptedFields: nextAccepted,
      overwriteFields: overwrite,
      editedValues: nextEdited,
      webProposedFields,
      webEvidence,
      webSearchStatus,
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
      acceptedFields: nextAccepted,
      overwriteFields: new Set(),
      editedValues: nextEdited,
      webProposedFields: {},
      webEvidence: [],
    });
  };

  const runWebSearch = () => {
    onWebSearch();
  };

  const saveCurrentToMaterials = () => {
    const effective = effectiveAcceptedFieldValues(
      sheetFields,
      catalogFields,
      {
        acceptedFields: accepted,
        editedValues,
        webProposedFields,
        overwriteFields: overwrite,
      },
    );
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
    if (accepted.size === 0) {
      toast.error("Chọn ít nhất một trường trước khi lưu.");
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
          toast.error(error.message || "Không lưu được vật tư.");
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
      acceptedFields: new Set(),
      overwriteFields: new Set(),
      editedValues: {},
      webProposedFields: {},
      webEvidence: [],
    });
  };

  const hasWebOrManualDecision =
    Object.keys(webProposedFields).length > 0 ||
    (selectedId == null &&
      (accepted.size > 0 ||
        Object.values(editedValues).some(
          (value) => (value ?? "").trim().length > 0,
        )));

  const canSaveToMaterials = accepted.size > 0 && !isWebSearchPending;
  const isSavingMaterial = upsertMaterial.isPending;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={runWebSearch}
          disabled={isWebSearchPending || !row.name.trim()}
        >
          {isWebSearchPending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Globe className="h-4 w-4" aria-hidden />
          )}
          Tìm web
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={saveCurrentToMaterials}
          disabled={!canSaveToMaterials || isSavingMaterial}
          title={
            canSaveToMaterials
              ? "Lưu các trường đã chọn vào danh mục vật tư"
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
        proposedFields={webProposedFields}
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
      />

      {webEvidence.length > 0 && !isWebSearchPending ? (
        <div className="space-y-2">
          <p className="text-xs font-bold text-slate-700">Bằng chứng web</p>
          {webEvidence.slice(0, 6).map((item, index) => (
            <div
              key={`${item.field}-${item.sourceUrl ?? index}`}
              className="rounded-lg border border-slate-200 bg-white p-2 text-xs"
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
                  className="mt-1 inline-block text-sky-700 hover:underline"
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

function EnrichExportPreviewPanel({
  matchData,
  decisions,
  fillsOnly,
  onFillsOnlyChange,
}: {
  matchData: MatchResponse;
  decisions: Map<number, RowDecision>;
  fillsOnly: boolean;
  onFillsOnlyChange: (value: boolean) => void;
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
        { fillsOnly },
      ),
    [matchData.results, decisions, fillsOnly],
  );

  const actionLabels: Record<string, string> = {
    filled: "Điền mới",
    overwritten: "Ghi đè",
    kept: "Giữ nguyên",
    "missing-both": "—",
  };

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
        <div>
          <p className="text-xs font-bold tracking-[0.12em] text-slate-500 uppercase">
            Xem trước xuất file
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {preview.totalExportable.toLocaleString("vi-VN")} dòng sẽ được xuất
            {preview.truncated
              ? ` · hiển thị ${preview.rows.length.toLocaleString("vi-VN")} dòng đầu`
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
        <p className="px-4 py-6 text-center text-xs text-slate-500">
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
                <th className="px-3 py-2 whitespace-nowrap">Sau</th>
                <th className="px-3 py-2 whitespace-nowrap">Hành động</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {preview.rows.flatMap((row) =>
                row.cells.map((cell) => (
                  <tr key={`${row.originalRowIndex}-${cell.field}`}>
                    <td className="px-3 py-2 font-semibold text-slate-500 tabular-nums whitespace-nowrap">
                      {row.originalRowIndex}
                    </td>
                    <td className="max-w-40 truncate px-3 py-2 text-slate-700">
                      {row.productName || "—"}
                    </td>
                    <td className="px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">
                      {FIELD_LABELS[cell.field]}
                    </td>
                    <td className="max-w-32 truncate px-3 py-2 text-slate-500">
                      {cell.before || "(trống)"}
                    </td>
                    <td className="max-w-32 truncate px-3 py-2 font-medium text-emerald-700">
                      {cell.after || "—"}
                    </td>
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">
                      {actionLabels[cell.action] ?? cell.action}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ExportStep({
  matchData,
  decisions,
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

  const researchApprovedCount =
    researchRowsQuery.data?.items.filter(
      (row) => row.status === "approved" || row.status === "matched",
    ).length ?? 0;

  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
        <h3 className="text-sm font-bold text-slate-900 text-balance">Xuất file</h3>
        <p className="mt-1 text-xs text-slate-500">
          Xem trước các ô sẽ điền, sau đó tải file đối chiếu catalog hoặc file
          nghiên cứu web nếu đã chạy bước 3.
        </p>
      </div>

      <div className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl border border-slate-200 bg-white p-3"
            >
              <p className="text-xs font-medium text-slate-500">{stat.label}</p>
              <p className="mt-1 text-xl font-bold text-slate-900 tabular-nums">
                {stat.value.toLocaleString("vi-VN")}
              </p>
            </div>
          ))}
        </div>

        <EnrichExportPreviewPanel
          matchData={matchData}
          decisions={decisions}
          fillsOnly={fillsOnly}
          onFillsOnlyChange={setFillsOnly}
        />

        {hasResearchJob ? (
          <p className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-900">
            File nghiên cứu web:{" "}
            {researchApprovedCount.toLocaleString("vi-VN")} dòng đã duyệt/khớp
            sẽ được xuất (xem chi tiết ở bước 3).
          </p>
        ) : null}

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {hasResearchJob ? (
            <div className="flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-white p-3">
              <Button
                variant="primary"
                leftIcon={<Download className="h-4 w-4" />}
                isLoading={isResearchExporting}
                onClick={onExportResearch}
              >
                Xuất file nghiên cứu web (.xlsx)
              </Button>
              <p className="text-xs text-slate-500">
                Điền theo kết quả nghiên cứu web đã duyệt ở bước 3.
              </p>
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-white p-3">
            <Button
              variant={hasResearchJob ? "secondary" : "primary"}
              leftIcon={<Download className="h-4 w-4" />}
              isLoading={isExporting}
              disabled={nothingToExport}
              onClick={onExport}
            >
              Xuất file đối chiếu catalog (.xlsx)
            </Button>
            <p className="text-xs text-slate-500">
              Giữ nguyên file gốc và điền các ô bạn đã chọn ở bước đối chiếu.
            </p>
          </div>

          <div className="flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-white p-3">
            <Button
              variant="secondary"
              disabled={isExporting || nothingToExport}
              onClick={onExportClean}
            >
              Tải bản chuẩn
            </Button>
            <p className="text-xs text-slate-500">
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
