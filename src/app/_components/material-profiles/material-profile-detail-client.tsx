"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  Download,
  FileSpreadsheet,
  FolderOpen,
  Loader2,
  Search,
  Upload,
} from "lucide-react";

import { Badge, Button, EmptyState } from "~/app/_components/ui";
import { useToast } from "~/app/_components/ui/toast";
import { api, type RouterOutputs } from "~/trpc/react";

type WorkspaceDetail = RouterOutputs["materialProfile"]["get"];
type WorkspaceItem = WorkspaceDetail["items"][number];
type Sheet = WorkspaceDetail["workbook"]["sheets"][number];
type CellEdits = Record<string, Record<string, string>>;

const mappingFields = [
  { key: "materialName", label: "Tên vật tư" },
  { key: "code", label: "Mã vật tư" },
  { key: "unit", label: "ĐVT" },
  { key: "category", label: "Nhóm" },
  { key: "specText", label: "Thông số" },
  { key: "vendorHint", label: "NCC" },
  { key: "originHint", label: "Xuất xứ" },
  { key: "unitPrice", label: "Đơn giá" },
  { key: "sourceUrl", label: "Nguồn" },
  { key: "catalogPdfUrls", label: "Catalog URLs" },
] as const;

const statusLabel: Record<WorkspaceItem["matchStatus"], string> = {
  unmatched: "Chưa match",
  candidates_found: "Cần duyệt",
  matched: "Tự động",
  manual: "Thủ công",
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
      reject(new Error("Không đọc được file Excel."));
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("Không đọc được file Excel."));
    reader.readAsDataURL(file);
  });
}

function cellKey(rowIndex: number, colIndex: number) {
  return `${rowIndex + 1}:${colIndex + 1}`;
}

function editedCellValue(
  sheetName: string,
  rawValue: string | undefined,
  edits: CellEdits,
  rowIndex: number,
  colIndex: number,
) {
  const key = cellKey(rowIndex, colIndex);
  return edits[sheetName]?.[key] ?? rawValue ?? "";
}

function candidatesFromItem(item: WorkspaceItem) {
  const snapshot = item.enrichedSnapshotJson;
  if (!snapshot || typeof snapshot !== "object") return [];
  const candidates = (snapshot as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates)) return [];
  return candidates
    .map((candidate) =>
      candidate && typeof candidate === "object"
        ? (candidate as {
            materialId?: unknown;
            name?: unknown;
            score?: unknown;
            unit?: unknown;
            manufacturer?: unknown;
          })
        : null,
    )
    .filter(
      (
        candidate,
      ): candidate is {
        materialId: number;
        name?: unknown;
        score?: unknown;
        unit?: unknown;
        manufacturer?: unknown;
      } => typeof candidate?.materialId === "number",
    );
}

function WorkbookGrid({
  sheet,
  edits,
  onEdit,
}: {
  sheet: Sheet;
  edits: CellEdits;
  onEdit: (rowIndex: number, colIndex: number, value: string) => void;
}) {
  const maxColumns = Math.max(...sheet.rawRows.map((row) => row.length), 1);
  return (
    <div className="max-h-[560px] overflow-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full border-separate border-spacing-0 text-xs">
        <tbody>
          {sheet.rawRows.map((row, rowIndex) => (
            <tr key={`${sheet.name}-${rowIndex}`}>
              <th className="sticky left-0 z-10 border-r border-b border-slate-200 bg-slate-100 px-2 py-1 text-right font-semibold text-slate-500 tabular-nums">
                {rowIndex + 1}
              </th>
              {Array.from({ length: maxColumns }).map((_, colIndex) => (
                <td
                  key={`${sheet.name}-${rowIndex}-${colIndex}`}
                  className="min-w-36 border-r border-b border-slate-100"
                >
                  <input
                    value={editedCellValue(
                      sheet.name,
                      row[colIndex],
                      edits,
                      rowIndex,
                      colIndex,
                    )}
                    onChange={(event) =>
                      onEdit(rowIndex, colIndex, event.target.value)
                    }
                    className={`h-8 w-full px-2 text-xs outline-none focus:bg-sky-50 ${
                      rowIndex + 1 === sheet.activeHeaderRowIndex
                        ? "bg-slate-50 font-bold text-slate-900"
                        : "bg-white text-slate-700"
                    }`}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MaterialProfileDetailClient({
  workspaceId,
}: {
  workspaceId: number;
}) {
  const toast = useToast();
  const utils = api.useUtils();
  const query = api.materialProfile.get.useQuery(
    { workspaceId },
    { refetchOnWindowFocus: false },
  );
  const [selectedSheetName, setSelectedSheetName] = useState("");
  const [headerRowIndex, setHeaderRowIndex] = useState(1);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [edits, setEdits] = useState<CellEdits>({});
  const [lastExport, setLastExport] = useState<
    RouterOutputs["materialProfile"]["export"] | null
  >(null);

  const upload = api.materialProfile.uploadWorkbook.useMutation({
    onSuccess: async () => {
      await utils.materialProfile.get.invalidate({ workspaceId });
      toast.success("Đã upload và đọc workbook.");
    },
    onError: (error) => toast.error(error.message),
  });
  const updateState = api.materialProfile.updateState.useMutation({
    onSuccess: async () => {
      await utils.materialProfile.get.invalidate({ workspaceId });
      toast.success("Đã lưu trạng thái workbook.");
    },
    onError: (error) => toast.error(error.message),
  });
  const match = api.materialProfile.match.useMutation({
    onSuccess: async () => {
      await utils.materialProfile.get.invalidate({ workspaceId });
      toast.success("Đã match vật tư từ catalog.");
    },
    onError: (error) => toast.error(error.message),
  });
  const updateItem = api.materialProfile.updateItem.useMutation({
    onSuccess: async () => {
      await utils.materialProfile.get.invalidate({ workspaceId });
    },
    onError: (error) => toast.error(error.message),
  });
  const exportWorkspace = api.materialProfile.export.useMutation({
    onSuccess: async (result) => {
      setLastExport(result);
      await utils.materialProfile.get.invalidate({ workspaceId });
      if (result.missingCount > 0 || result.warnings.length > 0) {
        toast.warning("Đã export, nhưng có cảnh báo catalog cần xem report.");
      } else {
        toast.success("Đã export Excel và Catalog folder.");
      }
    },
    onError: (error) => toast.error(error.message),
  });

  const detail = query.data;
  const sheets = useMemo(
    () => detail?.workbook.sheets ?? [],
    [detail?.workbook.sheets],
  );
  const activeSheet = useMemo(
    () =>
      sheets.find((sheet) => sheet.name === selectedSheetName) ??
      sheets.find(
        (sheet) => sheet.name === detail?.workspace.sourceSheetName,
      ) ??
      sheets[0],
    [detail?.workspace.sourceSheetName, selectedSheetName, sheets],
  );

  useEffect(() => {
    if (!detail) return;
    const nextSheet =
      detail.workspace.sourceSheetName ?? detail.workbook.sheets[0]?.name ?? "";
    setSelectedSheetName((current) => current || nextSheet);
    const sheet =
      detail.workbook.sheets.find((item) => item.name === nextSheet) ??
      detail.workbook.sheets[0];
    setHeaderRowIndex(sheet?.activeHeaderRowIndex ?? 1);
    setMapping(detail.workspace.columnMappingJson);
    setEdits(detail.workspace.editStateJson);
  }, [detail]);

  const saveState = () => {
    updateState.mutate({
      workspaceId,
      sheetName: activeSheet?.name,
      headerRowIndex,
      mapping,
      editState: edits,
    });
  };

  const handleFile = async (file: File | null) => {
    if (!file) return;
    try {
      const workbookBase64 = await fileToBase64(file);
      upload.mutate({ workspaceId, fileName: file.name, workbookBase64 });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Không đọc được file.",
      );
    }
  };

  if (query.isLoading || !detail) {
    return (
      <div className="panel p-5 text-sm text-slate-600">Đang tải hồ sơ…</div>
    );
  }

  const workspace = detail.workspace;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/material-profiles"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-sky-700 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Quay lại danh sách
        </Link>
        <Badge tone="info">{workspace.noticeNumber ?? workspace.name}</Badge>
      </div>

      <section className="panel p-4 sm:p-5">
        <p className="section-title">1. Import Excel</p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-950">
              File làm việc
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {workspace.sourceFileName
                ? `Đang dùng: ${workspace.sourceFileName}`
                : "Chọn file .xlsx để bắt đầu map vật tư."}
            </p>
          </div>
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-[var(--shadow-flat)] hover:bg-slate-50">
            {upload.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Upload className="h-4 w-4" aria-hidden />
            )}
            Upload Excel
            <input
              type="file"
              accept=".xlsx"
              className="sr-only"
              onChange={(event) => handleFile(event.target.files?.[0] ?? null)}
            />
          </label>
        </div>
      </section>

      {sheets.length === 0 || !activeSheet ? (
        <EmptyState
          title="Chưa có workbook"
          description="Upload Excel để xem sheet, chỉnh cell và match vật tư."
          icon={<FileSpreadsheet className="h-6 w-6" aria-hidden />}
        />
      ) : (
        <>
          <section className="panel p-4 sm:p-5">
            <p className="section-title">2. Sheet, mapping và editable Excel</p>
            <div className="mt-3 grid gap-3 lg:grid-cols-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold tracking-[0.12em] text-slate-600 uppercase">
                  Sheet vật tư
                </span>
                <select
                  value={activeSheet.name}
                  onChange={(event) => {
                    const sheet = sheets.find(
                      (item) => item.name === event.target.value,
                    );
                    setSelectedSheetName(event.target.value);
                    setHeaderRowIndex(sheet?.activeHeaderRowIndex ?? 1);
                    setMapping(sheet?.suggestedMapping ?? {});
                  }}
                  className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                >
                  {sheets.map((sheet) => (
                    <option key={sheet.name} value={sheet.name}>
                      {sheet.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold tracking-[0.12em] text-slate-600 uppercase">
                  Header row
                </span>
                <input
                  type="number"
                  min={1}
                  value={headerRowIndex}
                  onChange={(event) =>
                    setHeaderRowIndex(Math.max(1, Number(event.target.value)))
                  }
                  className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                />
              </label>
              <div className="flex items-end gap-2">
                <Button
                  variant="secondary"
                  onClick={saveState}
                  isLoading={updateState.isPending}
                  leftIcon={<Check className="h-4 w-4" />}
                >
                  Lưu chỉnh sửa
                </Button>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {mappingFields.map((field) => (
                <label key={field.key} className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold tracking-[0.12em] text-slate-600 uppercase">
                    {field.label}
                  </span>
                  <select
                    value={mapping[field.key] ?? ""}
                    onChange={(event) =>
                      setMapping((prev) => ({
                        ...prev,
                        [field.key]: event.target.value || null,
                      }))
                    }
                    className="h-9 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-900"
                  >
                    <option value="">Không map</option>
                    {activeSheet.headers.map((header) => (
                      <option key={`${field.key}-${header}`} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>

            <div className="mt-4">
              <WorkbookGrid
                sheet={activeSheet}
                edits={edits}
                onEdit={(rowIndex, colIndex, value) => {
                  const key = cellKey(rowIndex, colIndex);
                  setEdits((prev) => ({
                    ...prev,
                    [activeSheet.name]: {
                      ...(prev[activeSheet.name] ?? {}),
                      [key]: value,
                    },
                  }));
                }}
              />
            </div>
          </section>

          <section className="panel p-4 sm:p-5">
            <p className="section-title">3. Match vật tư</p>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-slate-600">
                Tự động chọn candidate confidence cao, các dòng còn lại cho
                duyệt thủ công.
              </p>
              <Button
                onClick={() =>
                  match.mutate({
                    workspaceId,
                    sheetName: activeSheet.name,
                    headerRowIndex,
                    mapping,
                  })
                }
                isLoading={match.isPending}
                leftIcon={<Search className="h-4 w-4" />}
              >
                Chạy match
              </Button>
            </div>

            {detail.items.length === 0 ? (
              <EmptyState
                className="mt-4"
                title="Chưa có kết quả match"
                description="Lưu mapping rồi chạy match để tạo danh sách dòng cần duyệt."
              />
            ) : (
              <div className="mt-4 max-h-[520px] overflow-auto rounded-lg border border-slate-200">
                <table className="w-full min-w-[900px] divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-bold text-slate-500 uppercase">
                    <tr>
                      <th className="px-3 py-2">Dòng</th>
                      <th className="px-3 py-2">Vật tư Excel</th>
                      <th className="px-3 py-2">Trạng thái</th>
                      <th className="px-3 py-2">Material ID</th>
                      <th className="px-3 py-2">Candidates</th>
                      <th className="px-3 py-2 text-center">Export</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {detail.items.map((item) => (
                      <tr key={item.id}>
                        <td className="px-3 py-2 font-semibold tabular-nums">
                          {item.originalRowIndex}
                        </td>
                        <td className="max-w-80 px-3 py-2">
                          <p className="font-semibold text-slate-950">
                            {item.productName}
                          </p>
                          <p className="line-clamp-2 text-xs text-slate-500">
                            {item.specText || item.unit}
                          </p>
                        </td>
                        <td className="px-3 py-2">
                          <Badge
                            tone={
                              item.matchStatus === "matched" ||
                              item.matchStatus === "manual"
                                ? "success"
                                : item.matchStatus === "candidates_found"
                                  ? "warning"
                                  : "neutral"
                            }
                          >
                            {statusLabel[item.matchStatus]}
                          </Badge>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min={1}
                            defaultValue={item.materialId ?? ""}
                            onBlur={(event) => {
                              const value = Number(event.target.value);
                              updateItem.mutate({
                                itemId: item.id,
                                materialId:
                                  Number.isInteger(value) && value > 0
                                    ? value
                                    : null,
                              });
                            }}
                            className="h-9 w-24 rounded-md border border-slate-300 px-2 text-sm"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1.5">
                            {candidatesFromItem(item)
                              .slice(0, 3)
                              .map((candidate) => (
                                <button
                                  key={`${item.id}-${candidate.materialId}`}
                                  type="button"
                                  onClick={() =>
                                    updateItem.mutate({
                                      itemId: item.id,
                                      materialId: candidate.materialId,
                                    })
                                  }
                                  className="rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-800 hover:bg-sky-100"
                                >
                                  #{candidate.materialId}{" "}
                                  {typeof candidate.name === "string"
                                    ? candidate.name.slice(0, 32)
                                    : ""}
                                </button>
                              ))}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={item.includedInExport}
                            onChange={(event) =>
                              updateItem.mutate({
                                itemId: item.id,
                                includedInExport: event.target.checked,
                              })
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel p-4 sm:p-5">
            <p className="section-title">4. Export</p>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm leading-6 text-slate-600">
                Xuất Excel theo Số TBMT và tạo folder Catalog đã dedupe. Nếu
                thiếu PDF, hệ thống sẽ tạo report cảnh báo trong folder output.
              </p>
              <Button
                onClick={() => exportWorkspace.mutate({ workspaceId })}
                isLoading={exportWorkspace.isPending}
                leftIcon={<Download className="h-4 w-4" />}
              >
                Export local folder
              </Button>
            </div>
            {(lastExport ?? workspace.outputDirPath) ? (
              <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-900">
                <p className="flex items-center gap-2 font-bold">
                  <FolderOpen className="h-4 w-4" aria-hidden />
                  Output folder
                </p>
                <p className="mt-1 font-mono text-xs break-all">
                  {lastExport?.outputDirPath ?? workspace.outputDirPath}
                </p>
                {lastExport ? (
                  <p className="mt-2 text-xs">
                    Catalog: {lastExport.catalogCount} file, thiếu/cảnh báo:{" "}
                    {lastExport.missingCount}
                  </p>
                ) : null}
              </div>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}
