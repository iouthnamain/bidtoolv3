"use client";

import { useState, type FormEvent } from "react";

import { Button } from "~/app/_components/ui/button";
import { formatNumber } from "~/lib/datetime";
import { api, type RouterInputs } from "~/trpc/react";

type DocumentCategory = NonNullable<
  RouterInputs["materialControl"]["uploadDocument"]["category"]
>;

const categoryLabels: Record<DocumentCategory, string> = {
  general: "Chung",
  requirement: "Nhu cầu vật tư",
  purchase: "Mua hàng",
  shipment: "Giao nhận",
  installation: "Lắp đặt",
  export: "Tệp xuất",
};

// Match the server limit so oversized files are rejected before encoding.
const maxFileSizeMb = 50;

type UploadState =
  | { status: "idle" | "pending" | "success" }
  | { status: "error"; message: string };

type DownloadState =
  | { status: "idle" }
  | { status: "pending" | "error"; id: number };

function isDocumentCategory(
  value: FormDataEntryValue | null,
): value is DocumentCategory {
  return typeof value === "string" && Object.hasOwn(categoryLabels, value);
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Không đọc được tệp tài liệu."));
      }
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("Không đọc được tệp tài liệu."));
    reader.readAsDataURL(file);
  });
}

export function MaterialControlDocumentsClient({
  projectId,
}: {
  projectId: number;
}) {
  const utils = api.useUtils();
  const documents = api.materialControl.listDocuments.useQuery({ projectId });
  const [uploadState, setUploadState] = useState<UploadState>({
    status: "idle",
  });
  const [downloadState, setDownloadState] = useState<DownloadState>({
    status: "idle",
  });
  const isUploading = uploadState.status === "pending";
  const rows = documents.data ?? [];

  async function submitUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isUploading) return;

    const form = event.currentTarget;
    const formData = new FormData(form);
    const file = formData.get("file");
    const category = formData.get("category");
    if (!isDocumentCategory(category)) return;
    if (!(file instanceof File) || file.size === 0) {
      setUploadState({
        status: "error",
        message: "Tệp tải lên không được để trống.",
      });
      return;
    }
    if (file.size > maxFileSizeMb * 1024 * 1024) {
      setUploadState({
        status: "error",
        message: `Tệp vượt quá giới hạn ${maxFileSizeMb} MB.`,
      });
      return;
    }

    setUploadState({ status: "pending" });
    try {
      await utils.client.materialControl.uploadDocument.mutate({
        projectId,
        category,
        fileName: file.name,
        fileBase64: await fileToBase64(file),
        mimeType: file.type || undefined,
      });
      await utils.materialControl.listDocuments.invalidate({ projectId });
      form.reset();
      setUploadState({ status: "success" });
    } catch {
      setUploadState({
        status: "error",
        message: "Không tải được tài liệu lên. Vui lòng thử lại.",
      });
    }
  }

  async function downloadDocument(id: number) {
    if (downloadState.status === "pending") return;

    setDownloadState({ status: "pending", id });
    try {
      const { document: file, contentBase64 } =
        await utils.client.materialControl.downloadDocument.query({ id });
      const binary = atob(contentBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const url = URL.createObjectURL(
        new Blob([bytes], { type: file.mimeType }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
      setDownloadState({ status: "idle" });
    } catch {
      setDownloadState({ status: "error", id });
    }
  }

  return (
    <section
      className="panel overflow-hidden"
      aria-labelledby="project-documents-heading"
    >
      <div className="border-b border-slate-200 p-4">
        <h2 id="project-documents-heading" className="text-lg font-extrabold">
          Tài liệu dự án
        </h2>
      </div>
      <form className="border-b border-slate-200 p-4" onSubmit={submitUpload}>
        <fieldset
          disabled={isUploading}
          className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] sm:items-end"
        >
          <label className="block min-w-0 text-sm font-bold text-slate-800">
            Loại tài liệu
            <select
              name="category"
              defaultValue="general"
              className="focus-ring mt-1 min-h-11 w-full rounded border border-slate-500 bg-white px-3 py-2 font-normal"
            >
              {Object.entries(categoryLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="block min-w-0 text-sm font-bold text-slate-800">
            Tệp tài liệu
            <input
              name="file"
              type="file"
              required
              onChange={() => setUploadState({ status: "idle" })}
              className="focus-ring mt-1 block min-h-11 w-full rounded border border-slate-500 bg-white px-3 py-2 font-normal file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1 file:font-semibold"
            />
          </label>
          <Button type="submit" aria-busy={isUploading}>
            {isUploading ? "Đang tải lên…" : "Tải lên"}
          </Button>
        </fieldset>
        <p
          role="status"
          className={
            uploadState.status === "success"
              ? "mt-2 text-sm text-slate-700"
              : "sr-only"
          }
        >
          {isUploading ? "Đang tải tài liệu lên…" : null}
          {uploadState.status === "success" ? "Đã tải tài liệu lên." : null}
        </p>
        {uploadState.status === "error" ? (
          <p role="alert" className="mt-2 text-sm text-rose-700">
            {uploadState.message}
          </p>
        ) : null}
      </form>
      <p role="status" className="sr-only">
        {downloadState.status === "pending" ? "Đang tải tài liệu xuống…" : null}
      </p>
      {documents.isLoading ? (
        <p role="status" className="p-6 text-sm text-slate-600">
          Đang tải tài liệu…
        </p>
      ) : null}
      {documents.isError ? (
        <p role="alert" className="p-6 text-sm text-rose-700">
          Không tải được danh sách tài liệu.
        </p>
      ) : null}
      {documents.isSuccess && rows.length === 0 ? (
        <p className="p-6 text-sm text-slate-600">Chưa có tài liệu.</p>
      ) : null}
      {rows.length > 0 ? (
        <ul role="list" className="divide-y divide-slate-200">
          {rows.map((row) => {
            const isDownloading =
              downloadState.status === "pending" && downloadState.id === row.id;
            return (
              <li key={row.id} className="p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1 basis-48 wrap-anywhere">
                    <p className="font-bold">{row.originalFileName}</p>
                    <p className="text-xs text-slate-600">
                      {categoryLabels[row.category]} · {row.mimeType} ·{" "}
                      {formatNumber(row.fileSize)} byte
                    </p>
                  </div>
                  <span className="text-xs text-slate-500">
                    {row.checksum.slice(0, 12)}…
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={downloadState.status === "pending"}
                    aria-busy={isDownloading}
                    onClick={() => void downloadDocument(row.id)}
                  >
                    {isDownloading ? "Đang tải xuống…" : "Tải xuống"}
                    <span className="sr-only"> {row.originalFileName}</span>
                  </Button>
                </div>
                {downloadState.status === "error" &&
                downloadState.id === row.id ? (
                  <p role="alert" className="mt-2 text-sm text-rose-700">
                    Không tải được tệp xuống. Vui lòng thử lại.
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
