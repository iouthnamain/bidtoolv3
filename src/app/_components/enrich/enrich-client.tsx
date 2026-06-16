"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
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
import {
  ProductCandidateCard,
  type EnrichCandidate,
} from "~/app/_components/enrich/product-candidate-card";
import {
  buildFillPlan,
  candidateToFields,
  FIELD_LABELS,
  FILLABLE_FIELDS,
  type FillableField,
} from "~/lib/materials/excel-enrich-fields";
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
  const plan = buildFillPlan(sheetFields, materialFields) as FillPlanCell[];
  const fillable = new Set<FillableField>(
    plan
      .filter((cell) => cell.action === "filled")
      .map((cell) => cell.field),
  );
  return { plan, fillable };
}

const EMPTY_JOB_ID = "00000000-0000-0000-0000-000000000000";

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
    setSelectedRowIndex(null);
    setResearchJobId(null);
    setError(null);
    setSheetName("");
    setStep(1);
    setMaxReached(1);
    if (!next) return;

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
          // Seed decisions: auto + review pre-select the top candidate and
          // tick all "filled" fields; unmatched start empty.
          const seeded = new Map<number, RowDecision>();
          for (const row of result.results) {
            const acceptedFields = new Set<FillableField>(
              row.fillPlan
                .filter((cell) => cell.action === "filled")
                .map((cell) => cell.field),
            );
            seeded.set(row.originalRowIndex, {
              materialId:
                row.status === "unmatched"
                  ? null
                  : (row.topCandidate?.materialId ?? null),
              acceptedFields,
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

  const fieldsToFill = useMemo(() => {
    let count = 0;
    for (const decision of decisions.values()) {
      if (decision.materialId != null) count += decision.acceptedFields.size;
    }
    return count;
  }, [decisions]);

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
      }))
      .filter((d) => d.materialId != null && d.fields.length > 0);

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
    const unmatched = matchData?.summary.unmatched ?? 0;
    if (unmatched > 0) {
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
    <div className="space-y-4">
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
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          selectedRowIndex={selectedRowIndex}
          setSelectedRowIndex={setSelectedRowIndex}
          fieldsToFill={fieldsToFill}
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
          unmatchedCount={matchData?.summary.unmatched ?? 0}
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
          fieldsToFill={fieldsToFill}
          isExporting={exportXlsx.isPending}
          isResearchExporting={exportResearchXlsx.isPending}
          hasResearchJob={researchJobId != null}
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
        title={`${matchData?.summary.unmatched ?? 0} dòng chưa khớp`}
        description="Các dòng chưa khớp sẽ được giữ nguyên trong file xuất ra. Tiếp tục?"
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
    <section className="panel overflow-hidden">
      <div className="border-b border-sky-200 bg-sky-50 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-sky-700 text-white">
            <FileSpreadsheet className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <h3 className="text-sm font-bold text-sky-950">
              Tải lên & map cột
            </h3>
            <p className="text-xs text-sky-800">
              Upload `.xlsx` còn thiếu trường; hệ thống tự dò header và map cột.
            </p>
          </div>
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
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
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
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm text-slate-500">
              {isPreviewLoading ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Đang đọc file…
                </span>
              ) : (
                "Chọn file để xem cột nhận diện được."
              )}
            </div>
          )}

          {activeSheet ? (
            <div className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              <p className="font-bold text-slate-800">Cột nhận diện</p>
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
    </section>
  );
}

function ReviewStep({
  matchData,
  decisions,
  updateDecision,
  statusFilter,
  setStatusFilter,
  selectedRowIndex,
  setSelectedRowIndex,
  fieldsToFill,
  onContinue,
}: {
  matchData: MatchResponse;
  decisions: Map<number, RowDecision>;
  updateDecision: (rowIndex: number, next: RowDecision) => void;
  statusFilter: MatchRow["status"] | "all";
  setStatusFilter: (value: MatchRow["status"] | "all") => void;
  selectedRowIndex: number | null;
  setSelectedRowIndex: (value: number | null) => void;
  fieldsToFill: number;
  onContinue: () => void;
}) {
  const rows = matchData.results;

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

  const filtered =
    statusFilter === "all"
      ? rows
      : rows.filter((row) => row.status === statusFilter);

  const filters: Array<{
    id: MatchRow["status"] | "all";
    label: string;
    count: number;
  }> = [
    { id: "all", label: "Tất cả", count: rows.length },
    { id: "auto", label: "Tự động", count: matchData.summary.auto },
    { id: "review", label: "Cần duyệt", count: matchData.summary.review },
    { id: "unmatched", label: "Chưa khớp", count: matchData.summary.unmatched },
  ];

  const selectedRow =
    rows.find((row) => row.originalRowIndex === selectedRowIndex) ?? null;

  const confirmAllAuto = () => {
    for (const row of rows) {
      if (row.status !== "auto" || !row.topCandidate) continue;
      const accepted = new Set<FillableField>(
        row.fillPlan
          .filter((cell) => cell.action === "filled")
          .map((cell) => cell.field),
      );
      updateDecision(row.originalRowIndex, {
        materialId: row.topCandidate.materialId,
        acceptedFields: accepted,
      });
    }
  };

  const skipAllUnmatched = () => {
    for (const row of rows) {
      if (row.status !== "unmatched") continue;
      updateDecision(row.originalRowIndex, {
        materialId: null,
        acceptedFields: new Set(),
      });
    }
  };

  const matched = matchData.summary.auto + matchData.summary.review;

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900">
            Xét duyệt & chọn sản phẩm
          </h3>
          <p className="mt-1 flex flex-wrap gap-3 text-xs text-slate-500">
            <span>{matchData.matchedRows.toLocaleString("vi-VN")} dòng</span>
            <span>{matched.toLocaleString("vi-VN")} khớp</span>
            <span>{fieldsToFill.toLocaleString("vi-VN")} ô sẽ điền</span>
            <span>
              {matchData.summary.unmatched.toLocaleString("vi-VN")} chưa khớp
            </span>
          </p>
        </div>
        <Button
          variant="primary"
          size="sm"
          leftIcon={<Download className="h-3.5 w-3.5" />}
          disabled={fieldsToFill === 0}
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
            variant="ghost"
            size="sm"
            disabled={matchData.summary.unmatched === 0}
            onClick={skipAllUnmatched}
          >
            Bỏ qua chưa khớp
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
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900">
                    {name}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Dòng {row.originalRowIndex}
                    {decision?.materialId != null
                      ? ` · đã chọn (${decision.acceptedFields.size} ô)`
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
              row={selectedRow}
              decision={decisions.get(selectedRow.originalRowIndex)}
              onChange={(next) =>
                updateDecision(selectedRow.originalRowIndex, next)
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
}: {
  row: MatchRow;
  decision: RowDecision | undefined;
  onChange: (next: RowDecision) => void;
}) {
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

  const selectedId = decision?.materialId ?? null;
  const accepted = decision?.acceptedFields ?? new Set<FillableField>();

  const sheetFields: Partial<Record<FillableField, string>> = row.sheetFields;

  // Cards from match candidates; manual search swaps in its own results.
  const searchCandidates = (searchQuery.data?.candidates ??
    []) as EnrichCandidate[];
  const showingSearch = debounced.length > 0;
  const cards: EnrichCandidate[] = showingSearch
    ? searchCandidates
    : row.candidates;

  // The currently selected candidate may come from either list.
  const selectedCandidate =
    cards.find((c) => c.materialId === selectedId) ??
    row.candidates.find((c) => c.materialId === selectedId) ??
    searchCandidates.find((c) => c.materialId === selectedId) ??
    null;

  const choose = (candidate: EnrichCandidate) => {
    const { fillable } = planForCandidate(sheetFields, candidate);
    onChange({ materialId: candidate.materialId, acceptedFields: fillable });
  };

  // The fill plan shown reflects the chosen candidate (recomputed locally so
  // manual-search picks get a plan too).
  const plan = selectedCandidate
    ? planForCandidate(sheetFields, selectedCandidate).plan
    : row.fillPlan;

  const toggleField = (field: FillableField) => {
    const next = new Set(accepted);
    if (next.has(field)) next.delete(field);
    else next.add(field);
    onChange({ materialId: selectedId, acceptedFields: next });
  };

  return (
    <div className="space-y-4">
      {/* Excel row */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
        <p className="text-xs font-bold tracking-[0.12em] text-slate-500 uppercase">
          Dòng Excel {row.originalRowIndex}
        </p>
        <p className="mt-1 text-sm font-semibold text-slate-900">
          {row.name || "(không có tên)"}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {FILLABLE_FIELDS.filter((f) => f !== "currency").map((field) => {
            const value = sheetFields[field]?.trim() ?? "";
            return (
              <span
                key={field}
                className={`rounded border px-1.5 py-0.5 text-[11px] ${
                  value
                    ? "border-slate-200 bg-white text-slate-600"
                    : "border-dashed border-slate-300 bg-transparent text-slate-400"
                }`}
              >
                {FIELD_LABELS[field]}: {value.length > 0 ? value : "(trống)"}
              </span>
            );
          })}
        </div>
      </div>

      {/* Manual search */}
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400"
          aria-hidden
        />
        <input
          type="search"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder="Tìm sản phẩm khác trong catalog…"
          className="w-full rounded-lg border border-slate-300 py-2 pr-3 pl-9 text-sm focus:ring-2 focus:ring-sky-500 focus:outline-none"
        />
      </div>

      {/* Candidate cards */}
      {showingSearch && searchQuery.isLoading ? (
        <p className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Đang tìm…
        </p>
      ) : cards.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-center text-xs text-slate-500">
          {showingSearch
            ? "Không tìm thấy sản phẩm phù hợp."
            : "Không có ứng viên ghép tự động — hãy tìm thủ công ở trên."}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map((candidate, index) => {
            const { fillable } = planForCandidate(sheetFields, candidate);
            return (
              <ProductCandidateCard
                key={candidate.materialId}
                candidate={candidate}
                isSelected={candidate.materialId === selectedId}
                isRecommended={
                  !showingSearch &&
                  index === 0 &&
                  row.topCandidate?.materialId === candidate.materialId
                }
                fillCount={fillable.size}
                onChoose={() => choose(candidate)}
                hotkeyIndex={index + 1}
              />
            );
          })}
        </div>
      )}

      {/* Fill plan for the chosen candidate */}
      {selectedId != null ? (
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs font-bold tracking-[0.12em] text-slate-500 uppercase">
            Sẽ điền vào dòng
          </p>
          <div className="mt-2 grid gap-1.5">
            {plan.map((cell) => {
              const field = cell.field;
              const isFillable =
                cell.action === "filled" || cell.action === "overwritten";
              return (
                <label
                  key={cell.field}
                  className={`flex items-center gap-2 rounded-md px-2 py-1 text-xs ${
                    isFillable ? "bg-slate-50" : "opacity-60"
                  }`}
                >
                  <input
                    type="checkbox"
                    disabled={!isFillable}
                    checked={isFillable && accepted.has(field)}
                    onChange={() => toggleField(field)}
                  />
                  <span className="w-20 shrink-0 font-semibold text-slate-600">
                    {FIELD_LABELS[field]}
                  </span>
                  <span className="truncate text-slate-500">
                    {cell.before || "(trống)"}
                  </span>
                  {isFillable ? (
                    <>
                      <span className="text-slate-400">→</span>
                      <span className="truncate font-medium text-emerald-700">
                        {cell.after}
                      </span>
                    </>
                  ) : (
                    <span className="ml-auto text-[11px] text-slate-400">
                      {cell.action === "kept" ? "giữ nguyên" : ""}
                    </span>
                  )}
                </label>
              );
            })}
            {plan.length === 0 ? (
              <p className="text-xs text-slate-500">
                Không có ô trống nào để điền cho lựa chọn này.
              </p>
            ) : null}
          </div>
          <div className="mt-2 flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                onChange({ materialId: null, acceptedFields: new Set() })
              }
            >
              Bỏ ghép dòng này
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ExportStep({
  matchData,
  fieldsToFill,
  isExporting,
  isResearchExporting,
  hasResearchJob,
  onExport,
  onExportClean,
  onExportResearch,
  onBack,
}: {
  matchData: MatchResponse;
  fieldsToFill: number;
  isExporting: boolean;
  isResearchExporting: boolean;
  hasResearchJob: boolean;
  onExport: () => void;
  onExportClean: () => void;
  onExportResearch: () => void;
  onBack: () => void;
}) {
  const matched = matchData.summary.auto + matchData.summary.review;
  const stats: Array<{ label: string; value: number }> = [
    { label: "Tổng dòng", value: matchData.matchedRows },
    { label: "Đã khớp", value: matched },
    { label: "Ô sẽ điền", value: fieldsToFill },
    { label: "Chưa khớp", value: matchData.summary.unmatched },
  ];

  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
        <h3 className="text-sm font-bold text-slate-900">Xuất file</h3>
        <p className="mt-1 text-xs text-slate-500">
          Xuất theo quyết định đối chiếu catalog, hoặc file đã nghiên cứu web nếu
          đã chạy bước 3.
        </p>
      </div>

      <div className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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

        <div className="flex flex-wrap gap-2">
          {hasResearchJob ? (
            <Button
              variant="primary"
              leftIcon={<Download className="h-4 w-4" />}
              isLoading={isResearchExporting}
              onClick={onExportResearch}
            >
              Xuất file nghiên cứu web (.xlsx)
            </Button>
          ) : null}
          <Button
            variant={hasResearchJob ? "secondary" : "primary"}
            leftIcon={<Download className="h-4 w-4" />}
            isLoading={isExporting}
            disabled={fieldsToFill === 0}
            onClick={onExport}
          >
            Xuất file đối chiếu catalog (.xlsx)
          </Button>
          <Button variant="secondary" disabled={isExporting} onClick={onExportClean}>
            Tải bản chuẩn
          </Button>
          <Button variant="ghost" onClick={onBack}>
            Quay lại nghiên cứu web
          </Button>
        </div>
      </div>
    </section>
  );
}
