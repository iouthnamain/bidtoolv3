"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowLeft,
  FileSpreadsheet,
  TableProperties,
  Upload,
} from "lucide-react";

import { Badge, Button } from "~/app/_components/ui";
import { api } from "~/trpc/react";

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

export function MaterialImportClient() {
  const utils = api.useUtils();
  const [xlsxFile, setXlsxFile] = useState<File | null>(null);
  const [sheetName, setSheetName] = useState("");
  const [csv, setCsv] = useState("");
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const importXlsx = api.material.importMaterialsXlsx.useMutation({
    onSuccess: async (result) => {
      const warningText =
        result.warnings.length > 0 ? ` Cảnh báo: ${result.warnings[0]}` : "";
      setImportMessage(
        `Đã nhập ${result.inserted}, bỏ qua ${result.skipped}, lỗi ${result.errors.length}.${warningText}`,
      );
      setImportError(result.errors[0] ?? null);
      setXlsxFile(null);
      await utils.material.searchMaterials.invalidate();
    },
    onError: (error) => {
      setImportMessage(null);
      setImportError(error.message || "Không thể nhập file Excel.");
    },
  });

  const importCsv = api.material.importMaterialsCsv.useMutation({
    onSuccess: async (result) => {
      setImportMessage(
        `Đã nhập ${result.inserted}, bỏ qua ${result.skipped}, lỗi ${result.errors.length}.`,
      );
      setImportError(result.errors[0] ?? null);
      setCsv("");
      await utils.material.searchMaterials.invalidate();
    },
    onError: (error) => {
      setImportMessage(null);
      setImportError(error.message || "Không thể nhập CSV.");
    },
  });

  const uploadExcel = async () => {
    if (!xlsxFile) {
      return;
    }

    setImportMessage(null);
    setImportError(null);
    try {
      const workbookBase64 = await fileToBase64(xlsxFile);
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
      <section className="panel p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link
              href="/materials"
              className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 transition-colors hover:text-slate-900"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
              Quay lại danh mục
            </Link>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold text-slate-950">
                Nhập sản phẩm / vật tư từ sheet
              </h2>
              <Badge tone="info">Excel</Badge>
              <Badge tone="neutral">CSV</Badge>
            </div>
            <p className="mt-1 text-sm text-slate-600">
              Nhập nhanh catalog từ Excel hoặc CSV; hệ thống tự dò header và ánh
              xạ các cột vật tư phổ biến.
            </p>
          </div>
          <Link
            href="/materials/new"
            className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            Thêm thủ công
          </Link>
        </div>

        {importMessage ? (
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {importMessage}
          </div>
        ) : null}
        {importError ? (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {importError}
          </div>
        ) : null}
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <article className="panel p-4">
          <div className="border-b border-slate-200 pb-3">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-sky-700" aria-hidden />
              <h3 className="text-sm font-bold text-slate-950">Upload Excel</h3>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Hỗ trợ `.xlsx`; có thể nhập tên sheet nếu workbook có nhiều trang
              tính.
            </p>
          </div>

          <div className="mt-4 grid gap-3">
            <label
              htmlFor="material-import-xlsx"
              className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-dashed border-sky-300 bg-sky-50 px-3 py-4 text-sm font-semibold text-sky-800 hover:bg-sky-100"
            >
              <span className="inline-flex items-center gap-2">
                <Upload className="h-4 w-4" aria-hidden />
                Chọn file Excel
              </span>
              <span className="max-w-[48%] truncate text-xs font-medium text-slate-600">
                {xlsxFile ? xlsxFile.name : ".xlsx"}
              </span>
            </label>
            <input
              id="material-import-xlsx"
              type="file"
              accept=".xlsx"
              className="sr-only"
              onChange={(event) => setXlsxFile(event.target.files?.[0] ?? null)}
            />
            <input
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Tên sheet (tuỳ chọn)"
              value={sheetName}
              onChange={(event) => setSheetName(event.target.value)}
            />
            <Button
              variant="primary"
              leftIcon={<Upload className="h-4 w-4" />}
              disabled={!xlsxFile}
              isLoading={importXlsx.isPending}
              onClick={() => void uploadExcel()}
            >
              Nhập Excel
            </Button>
          </div>
        </article>

        <article className="panel p-4">
          <div className="border-b border-slate-200 pb-3">
            <div className="flex items-center gap-2">
              <TableProperties className="h-4 w-4 text-sky-700" aria-hidden />
              <h3 className="text-sm font-bold text-slate-950">Dán CSV</h3>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Header khuyến nghị:
              code,name,unit,category,spec_text,manufacturer,origin_country,default_unit_price,currency,source_url,default_depreciation,default_reuse_pct
            </p>
          </div>

          <textarea
            className="mt-4 h-72 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
            value={csv}
            onChange={(event) => setCsv(event.target.value)}
            placeholder="Dán CSV tại đây"
            aria-label="Nội dung CSV sản phẩm hoặc vật tư"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={!csv.trim()}
              isLoading={importCsv.isPending}
              onClick={() => importCsv.mutate({ csv })}
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
        </article>
      </section>
    </div>
  );
}
