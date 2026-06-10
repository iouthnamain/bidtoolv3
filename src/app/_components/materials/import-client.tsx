"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  Database,
  FileSpreadsheet,
  Info,
  TableProperties,
  Upload,
} from "lucide-react";

import { Button } from "~/app/_components/ui";
import { api, type RouterOutputs } from "~/trpc/react";

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

const csvHeader =
  "code,name,unit,category,spec_text,manufacturer,origin_country,default_unit_price,currency,source_url,default_depreciation,default_reuse_pct";

const csvExample = `${csvHeader}
M001,Dây điện 2.5mm,Cái,Điện,Dây đồng bọc PVC,NCC A,Việt Nam,25000,VND,https://example.com/day-dien,1,0`;

type ImportResult = {
  source: "Excel" | "CSV";
  inserted: number;
  skipped: number;
  errors: string[];
  warnings?: string[];
};
type XlsxPreview = RouterOutputs["material"]["previewMaterialsXlsx"];
type XlsxPreviewSheet = XlsxPreview["sheets"][number];

function ResultPanel({ result }: { result: ImportResult | null }) {
  if (!result) {
    return null;
  }

  const hasErrors = result.errors.length > 0;
  const hasWarnings = (result.warnings?.length ?? 0) > 0;

  return (
    <div
      className={`rounded-xl border px-4 py-3 ${
        hasErrors
          ? "border-rose-200 bg-rose-50 text-rose-900"
          : hasWarnings
            ? "border-amber-200 bg-amber-50 text-amber-900"
            : "border-emerald-200 bg-emerald-50 text-emerald-900"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          {hasErrors ? (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          ) : (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          )}
          <div>
            <p className="text-sm font-bold">Kết quả nhập {result.source}</p>
            <p className="mt-1 text-xs leading-5">
              Đã nhập {result.inserted.toLocaleString("vi-VN")} dòng, bỏ qua{" "}
              {result.skipped.toLocaleString("vi-VN")} dòng, lỗi{" "}
              {result.errors.length.toLocaleString("vi-VN")} dòng.
            </p>
          </div>
        </div>
        <Link
          href="/materials"
          className="rounded-md bg-white/70 px-2.5 py-1.5 text-xs font-bold text-slate-800 hover:bg-white"
        >
          Xem danh mục
        </Link>
      </div>
      {result.errors[0] ? (
        <p className="mt-2 rounded-lg bg-white/60 px-3 py-2 text-xs">
          {result.errors[0]}
        </p>
      ) : null}
      {result.warnings?.[0] ? (
        <p className="mt-2 rounded-lg bg-white/60 px-3 py-2 text-xs">
          {result.warnings[0]}
        </p>
      ) : null}
    </div>
  );
}

function XlsxPreviewPanel({
  sheet,
  isLoading,
}: {
  sheet: XlsxPreviewSheet | undefined;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <section
        id="materials-xlsx-preview"
        className="panel scroll-mt-6 rounded-xl border border-sky-200 bg-sky-50 px-4 py-4 text-sm text-sky-900"
      >
        Đang đọc file và tạo preview…
      </section>
    );
  }

  if (!sheet) {
    return null;
  }

  const mappingEntries = [
    ["Tên", sheet.suggestedMapping.materialName],
    ["ĐVT", sheet.suggestedMapping.unit],
    ["Thông số", sheet.suggestedMapping.specText],
    ["Chi tiết", sheet.suggestedMapping.notes],
    ["NCC", sheet.suggestedMapping.vendorHint],
    ["Xuất xứ", sheet.suggestedMapping.originHint],
    ["Đơn giá", sheet.suggestedMapping.unitPrice],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));

  return (
    <section
      id="materials-xlsx-preview"
      className="panel scroll-mt-6 overflow-hidden border-sky-100"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 bg-gradient-to-r from-white via-sky-50 to-emerald-50 px-4 py-4">
        <div>
          <p className="text-xs font-bold tracking-[0.12em] text-slate-500 uppercase">
            Preview trước khi nhập
          </p>
          <p className="mt-1 text-lg font-bold text-slate-950">{sheet.name}</p>
          <p className="mt-0.5 text-sm text-slate-500">
            Header dòng {sheet.activeHeaderRowIndex};{" "}
            {sheet.rowCount.toLocaleString("vi-VN")} dòng dữ liệu đọc được.
          </p>
        </div>
        <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-bold text-sky-800 tabular-nums">
          {sheet.previewRows.length.toLocaleString("vi-VN")} dòng preview
        </span>
      </div>

      <div className="grid gap-3 p-4">
        {mappingEntries.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {mappingEntries.map(([label, value]) => (
              <span
                key={`${label}-${value}`}
                className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700"
              >
                {label}: {value}
              </span>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Chưa nhận diện được cột tên vật tư. Kiểm tra lại header trước khi
            nhập.
          </div>
        )}

        {sheet.warnings.length > 0 ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {sheet.warnings[0]}
          </div>
        ) : null}

        {sheet.previewRows.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[1280px] divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-100 text-left text-slate-600 uppercase">
                <tr>
                  <th className="px-3 py-2">Dòng</th>
                  <th className="px-3 py-2">Tên vật tư</th>
                  <th className="px-3 py-2">ĐVT</th>
                  <th className="px-3 py-2">Thông số</th>
                  <th className="px-3 py-2">Chi tiết</th>
                  <th className="px-3 py-2">NCC</th>
                  <th className="px-3 py-2">Xuất xứ</th>
                  <th className="px-3 py-2">Giá</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {sheet.previewRows.map((row) => (
                  <tr key={`${sheet.name}-${row.rowNumber}`}>
                    <td className="px-3 py-2 font-semibold text-slate-500 tabular-nums">
                      {row.rowNumber}
                    </td>
                    <td className="max-w-72 px-3 py-2 font-semibold text-slate-900">
                      <span className="line-clamp-2">{row.name}</span>
                    </td>
                    <td className="px-3 py-2 text-slate-700">{row.unit}</td>
                    <td className="max-w-96 px-3 py-2 text-slate-600">
                      <span className="line-clamp-2">
                        {row.specText || "-"}
                      </span>
                    </td>
                    <td className="max-w-80 px-3 py-2 text-slate-600">
                      <span className="line-clamp-2">{row.details || "-"}</span>
                    </td>
                    <td className="max-w-52 px-3 py-2 text-slate-600">
                      <span className="line-clamp-2">
                        {row.manufacturer ?? "-"}
                      </span>
                    </td>
                    <td className="max-w-36 px-3 py-2 text-slate-600">
                      <span className="line-clamp-2">
                        {row.originCountry ?? "-"}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-semibold text-slate-800 tabular-nums">
                      {row.defaultUnitPrice?.toLocaleString("vi-VN") ?? "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm text-slate-500">
            Không có dòng preview phù hợp với mapping hiện tại.
          </div>
        )}
      </div>
    </section>
  );
}

export function MaterialImportClient() {
  const utils = api.useUtils();
  const previewRequestIdRef = useRef(0);
  const [xlsxFile, setXlsxFile] = useState<File | null>(null);
  const [xlsxBase64, setXlsxBase64] = useState<string | null>(null);
  const [xlsxPreview, setXlsxPreview] = useState<XlsxPreview | null>(null);
  const [sheetName, setSheetName] = useState("");
  const [csv, setCsv] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<ImportResult | null>(null);
  const csvRowCount = useMemo(() => {
    const trimmed = csv.trim();
    if (!trimmed) {
      return 0;
    }
    return Math.max(0, trimmed.split(/\r?\n/).length - 1);
  }, [csv]);
  const activePreviewSheet =
    xlsxPreview?.sheets.find((sheet) => sheet.name === sheetName) ??
    xlsxPreview?.sheets[0];

  const previewXlsx = api.material.previewMaterialsXlsx.useMutation();

  const importXlsx = api.material.importMaterialsXlsx.useMutation({
    onSuccess: async (result) => {
      setLastResult({
        source: "Excel",
        inserted: result.inserted,
        skipped: result.skipped,
        errors: result.errors,
        warnings: result.warnings,
      });
      setImportError(null);
      setXlsxFile(null);
      setXlsxBase64(null);
      setXlsxPreview(null);
      setSheetName("");
      await Promise.all([
        utils.material.searchMaterials.invalidate(),
        utils.material.getMaterialSummary.invalidate(),
        utils.material.getMaterialFilterOptions.invalidate(),
      ]);
    },
    onError: (error) => {
      setLastResult(null);
      setImportError(error.message || "Không thể nhập file Excel.");
    },
  });

  const importCsv = api.material.importMaterialsCsv.useMutation({
    onSuccess: async (result) => {
      setLastResult({
        source: "CSV",
        inserted: result.inserted,
        skipped: result.skipped,
        errors: result.errors,
      });
      setImportError(null);
      setCsv("");
      await Promise.all([
        utils.material.searchMaterials.invalidate(),
        utils.material.getMaterialSummary.invalidate(),
        utils.material.getMaterialFilterOptions.invalidate(),
      ]);
    },
    onError: (error) => {
      setLastResult(null);
      setImportError(error.message || "Không thể nhập CSV.");
    },
  });

  const handleExcelFile = async (file: File | null | undefined) => {
    const requestId = previewRequestIdRef.current + 1;
    previewRequestIdRef.current = requestId;
    const requestedSheetName = xlsxPreview ? "" : sheetName.trim();
    setXlsxFile(file ?? null);
    setXlsxBase64(null);
    setXlsxPreview(null);
    setLastResult(null);
    setImportError(null);
    setSheetName(requestedSheetName);

    if (!file) {
      setSheetName("");
      return;
    }

    try {
      const workbookBase64 = await fileToBase64(file);
      if (requestId !== previewRequestIdRef.current) {
        return;
      }
      setXlsxBase64(workbookBase64);
      previewXlsx.mutate(
        {
          fileName: file.name,
          workbookBase64,
          sheetName: requestedSheetName || undefined,
        },
        {
          onSuccess: (result) => {
            if (requestId !== previewRequestIdRef.current) {
              return;
            }
            setXlsxPreview(result);
            setSheetName(result.selectedSheetName);
            setImportError(null);
          },
          onError: (error) => {
            if (requestId !== previewRequestIdRef.current) {
              return;
            }
            setXlsxPreview(null);
            setImportError(error.message || "Không thể tạo preview Excel.");
          },
        },
      );
    } catch (error) {
      if (requestId !== previewRequestIdRef.current) {
        return;
      }
      setImportError(
        error instanceof Error ? error.message : "Không đọc được tệp Excel.",
      );
    }
  };

  const uploadExcel = async () => {
    if (!xlsxFile) {
      return;
    }

    setLastResult(null);
    setImportError(null);
    try {
      const workbookBase64 = xlsxBase64 ?? (await fileToBase64(xlsxFile));
      importXlsx.mutate({
        fileName: xlsxFile.name,
        workbookBase64,
        sheetName: sheetName.trim() || undefined,
      });
    } catch (error) {
      setImportError(
        error instanceof Error ? error.message : "Không đọc được tệp Excel.",
      );
    }
  };

  return (
    <div className="space-y-4">
      <section className="grid gap-3 md:grid-cols-[1fr_auto] md:items-start">
        <ResultPanel result={lastResult} />
        {importError ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p>{importError}</p>
            </div>
          </div>
        ) : lastResult ? null : (
          <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
            <div className="flex items-start gap-2">
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p>
                Excel tự dò header; CSV cần dùng đúng tên cột ở mẫu bên dưới.
              </p>
            </div>
          </div>
        )}
        <Link
          href="/materials/new"
          className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
        >
          Thêm thủ công
        </Link>
      </section>

      <section className="grid gap-4">
        <article className="panel overflow-hidden">
          <div className="border-b border-sky-200 bg-sky-50 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-sky-700 text-white">
                <FileSpreadsheet className="h-4 w-4" aria-hidden />
              </span>
              <div>
                <h3 className="text-sm font-bold text-sky-950">Upload Excel</h3>
                <p className="text-xs text-sky-800">
                  Hỗ trợ `.xlsx`; nhập tên sheet nếu workbook có nhiều trang.
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.75fr)] lg:items-start">
            <label
              htmlFor="material-import-xlsx"
              className={`flex min-h-44 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-4 py-6 text-center transition-colors ${
                xlsxFile
                  ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                  : "border-sky-300 bg-gradient-to-br from-sky-50 to-white text-sky-900 hover:bg-sky-100"
              }`}
            >
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-white shadow-sm">
                {xlsxFile ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-700" aria-hidden />
                ) : (
                  <Upload className="h-5 w-5 text-sky-700" aria-hidden />
                )}
              </span>
              <span className="text-sm font-bold">Chọn file Excel</span>
              <span className="max-w-full truncate text-xs font-medium text-slate-600">
                {xlsxFile ? xlsxFile.name : ".xlsx"}
              </span>
            </label>
            <input
              id="material-import-xlsx"
              type="file"
              accept=".xlsx"
              className="sr-only"
              onChange={(event) =>
                void handleExcelFile(event.target.files?.[0] ?? null)
              }
            />
            <div className="grid gap-3">
              {xlsxPreview ? (
                <label className="grid gap-1">
                  <span className="text-xs font-bold tracking-[0.12em] text-slate-500 uppercase">
                    Sheet preview
                  </span>
                  <select
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={activePreviewSheet?.name ?? ""}
                    onChange={(event) => setSheetName(event.target.value)}
                  >
                    {xlsxPreview.sheets.map((sheet) => (
                      <option key={sheet.name} value={sheet.name}>
                        {sheet.name} ({sheet.rowCount.toLocaleString("vi-VN")}{" "}
                        dòng)
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label className="grid gap-1">
                  <span className="text-xs font-bold tracking-[0.12em] text-slate-500 uppercase">
                    Sheet cần nhập
                  </span>
                  <input
                    name="sheetName"
                    autoComplete="off"
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:ring-2 focus:ring-sky-100 focus:outline-none"
                    placeholder="Tên sheet tuỳ chọn…"
                    value={sheetName}
                    onChange={(event) => setSheetName(event.target.value)}
                  />
                </label>
              )}
              <div className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                <p className="font-bold text-slate-800">
                  Cột Excel được nhận diện
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    "Tên vật tư",
                    "ĐVT",
                    "Thông số",
                    "Chi tiết",
                    "Nhà cung cấp",
                    "Xuất xứ",
                    "Đơn giá",
                  ].map((label) => (
                    <span
                      key={label}
                      className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-slate-600"
                    >
                      {label}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  leftIcon={<Upload className="h-4 w-4" />}
                  disabled={!xlsxFile}
                  isLoading={importXlsx.isPending || previewXlsx.isPending}
                  onClick={() => void uploadExcel()}
                >
                  {previewXlsx.isPending ? "Đang preview…" : "Nhập Excel"}
                </Button>
                {xlsxFile ? (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      previewRequestIdRef.current += 1;
                      setXlsxFile(null);
                      setXlsxBase64(null);
                      setXlsxPreview(null);
                      setSheetName("");
                    }}
                  >
                    Bỏ file
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </article>
      </section>

      <XlsxPreviewPanel
        sheet={activePreviewSheet}
        isLoading={previewXlsx.isPending}
      />

      <section className="grid gap-4">
        <article className="panel overflow-hidden">
          <div className="border-b border-emerald-200 bg-emerald-50 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-700 text-white">
                <TableProperties className="h-4 w-4" aria-hidden />
              </span>
              <div>
                <h3 className="text-sm font-bold text-emerald-950">Dán CSV</h3>
                <p className="text-xs text-emerald-800">
                  Dán dữ liệu có header; mỗi dòng là một vật tư catalog.
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-start">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-bold text-slate-700">Header CSV</p>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-md bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100"
                  onClick={() => setCsv(csvExample)}
                >
                  <Clipboard className="h-3.5 w-3.5" aria-hidden />
                  Dùng mẫu
                </button>
              </div>
              <code className="mt-2 block rounded-lg bg-white px-3 py-2 text-[11px] leading-5 break-words whitespace-pre-wrap text-slate-600">
                {csvHeader}
              </code>
            </div>

            <div>
              <textarea
                className="h-56 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs leading-5 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                name="materialsCsv"
                autoComplete="off"
                value={csv}
                onChange={(event) => setCsv(event.target.value)}
                placeholder="Dán CSV tại đây…"
                aria-label="Nội dung CSV sản phẩm hoặc vật tư"
              />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                  <Database className="h-3.5 w-3.5" aria-hidden />
                  {csvRowCount.toLocaleString("vi-VN")} dòng dữ liệu
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    disabled={!csv.trim()}
                    isLoading={importCsv.isPending}
                    onClick={() => {
                      setLastResult(null);
                      setImportError(null);
                      importCsv.mutate({ csv });
                    }}
                  >
                    Nhập CSV
                  </Button>
                  <Link
                    href="/materials"
                    className="inline-flex items-center rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100"
                  >
                    Xem danh mục
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </article>
      </section>
    </div>
  );
}
