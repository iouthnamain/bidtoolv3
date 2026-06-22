"use client";

import Link from "next/link";
import { useState } from "react";
import type { FormEvent } from "react";
import {
  ChevronDown,
  Download,
  ExternalLink,
  FileText,
  HardDriveDownload,
  Link as LinkIcon,
  Paperclip,
  Search,
  Trash2,
  Upload,
} from "lucide-react";

import { Badge, Button, ConfirmDialog, EmptyState } from "~/app/_components/ui";
import { useToast } from "~/app/_components/ui/toast";
import { api, type RouterOutputs } from "~/trpc/react";

type LinkedDocument =
  RouterOutputs["catalogDocument"]["listByMaterial"][number];

const linkSourceLabel: Record<LinkedDocument["linkSource"], string> = {
  manual: "Thủ công",
  scrape: "Scrape",
  import: "Import",
};

const sourceTypeLabel: Record<LinkedDocument["sourceType"], string> = {
  uploaded: "Đã upload",
  detected: "Tự phát hiện",
  manual_url: "URL thủ công",
  generated: "Tạo tự động",
};

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = reader.result;
      if (typeof value === "string") {
        resolve(value);
      } else {
        reject(new Error("Không đọc được tệp PDF."));
      }
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("Không đọc được tệp PDF."));
    reader.readAsDataURL(file);
  });
}

function formatFileSize(size: number | null) {
  if (size == null) {
    return null;
  }
  if (size < 1024 * 1024) {
    return `${Math.max(1, Math.round(size / 1024))} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

const inputClass =
  "min-h-10 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 transition-colors placeholder:text-slate-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-100 focus:outline-none";

export function MaterialCatalogPdfSection({
  materialId,
  defaultExpanded = false,
}: {
  materialId: number;
  defaultExpanded?: boolean;
}) {
  const utils = api.useUtils();
  const toast = useToast();

  const [attachKeyword, setAttachKeyword] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [detachTarget, setDetachTarget] = useState<LinkedDocument | null>(null);
  const [isSectionOpen, setIsSectionOpen] = useState(defaultExpanded);

  const linkedQuery = api.catalogDocument.listByMaterial.useQuery({
    materialId,
  });
  const linkedDocuments = linkedQuery.data ?? [];
  const linkedIds = new Set(linkedDocuments.map((document) => document.id));

  const pickerQuery = api.catalogDocument.list.useQuery(
    { keyword: attachKeyword || undefined, limit: 10 },
    { enabled: attachKeyword.trim().length > 0 },
  );
  const pickerCandidates = (pickerQuery.data ?? []).filter(
    (document) => !linkedIds.has(document.id),
  );

  const refresh = async () => {
    await Promise.all([
      utils.catalogDocument.listByMaterial.invalidate({ materialId }),
      utils.catalogDocument.list.invalidate(),
    ]);
  };

  const attachDocument = api.catalogDocument.attachToMaterials.useMutation({
    onSuccess: async () => {
      toast.success("Đã gắn tài liệu vào vật tư.");
      setAttachKeyword("");
      await refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  const createDocument = api.catalogDocument.create.useMutation({
    onSuccess: async () => {
      toast.success("Đã thêm tài liệu catalog từ URL.");
      setNewUrl("");
      setNewTitle("");
      await refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  const uploadDocument = api.catalogDocument.uploadPdf.useMutation({
    onSuccess: async () => {
      toast.success("Đã upload tài liệu PDF.");
      setUploadTitle("");
      setUploadFile(null);
      await refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  const downloadToLocal = api.catalogDocument.downloadToLocal.useMutation({
    onSuccess: async () => {
      toast.success("Đã lưu bản PDF cục bộ.");
      await refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  const detachDocument = api.catalogDocument.detachFromMaterial.useMutation({
    onSuccess: async () => {
      toast.success("Đã gỡ tài liệu khỏi vật tư.");
      setDetachTarget(null);
      await refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  const submitUrlDocument = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const url = newUrl.trim();
    if (!url) {
      return;
    }
    createDocument.mutate({
      title: newTitle.trim() || url,
      sourceUrl: url,
      materialIds: [materialId],
    });
  };

  const submitUpload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!uploadFile) {
      return;
    }
    try {
      const fileBase64 = await fileToBase64(uploadFile);
      uploadDocument.mutate({
        title: uploadTitle.trim() || uploadFile.name.replace(/\.pdf$/i, ""),
        fileName: uploadFile.name,
        fileBase64,
        materialIds: [materialId],
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Không đọc được tệp PDF.",
      );
    }
  };

  return (
    <section id="material-documents" className="panel scroll-mt-6 overflow-hidden">
      <ConfirmDialog
        open={detachTarget !== null}
        title={`Gỡ tài liệu "${detachTarget?.title ?? ""}" khỏi vật tư?`}
        description="Tài liệu vẫn còn trong thư viện catalog PDF, chỉ gỡ liên kết với vật tư này."
        confirmLabel="Gỡ liên kết"
        variant="danger"
        isLoading={detachDocument.isPending}
        onConfirm={() => {
          if (detachTarget) {
            detachDocument.mutate({
              documentId: detachTarget.id,
              materialId,
            });
          }
        }}
        onCancel={() => setDetachTarget(null)}
      />

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left transition-colors hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
          onClick={() => setIsSectionOpen((open) => !open)}
          aria-expanded={isSectionOpen}
          aria-controls="material-documents-content"
        >
          <FileText className="h-4 w-4 shrink-0 text-violet-700" aria-hidden />
          <h3 className="text-base font-bold text-slate-950">Catalog PDFs</h3>
          <Badge tone={linkedDocuments.length === 0 ? "warning" : "info"}>
            {linkedDocuments.length} tài liệu
          </Badge>
          <ChevronDown
            className={`ml-auto h-4 w-4 shrink-0 text-slate-500 transition-transform duration-200 ${
              isSectionOpen ? "rotate-180" : ""
            }`}
            aria-hidden
          />
        </button>
        <Link
          href="/catalog-pdfs"
          className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-sky-700 hover:text-sky-900"
        >
          Mở thư viện catalog PDF
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>

      {isSectionOpen ? (
        <div
          id="material-documents-content"
          className="grid gap-4 p-5 xl:grid-cols-[0.85fr_1.15fr]"
        >
        <div className="space-y-4">
          <article className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
            <h4 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
              <Paperclip className="h-4 w-4 text-slate-500" aria-hidden />
              Gắn tài liệu có sẵn
            </h4>
            <div className="relative mt-3">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden
              />
              <input
                type="search"
                className={`${inputClass} w-full pl-9`}
                placeholder="Tìm theo tên, NCC hoặc URL..."
                value={attachKeyword}
                onChange={(event) => setAttachKeyword(event.target.value)}
              />
            </div>
            {attachKeyword.trim() ? (
              <ul className="mt-2 space-y-1">
                {pickerQuery.isLoading ? (
                  <li className="px-2 py-1 text-xs text-slate-500">
                    Đang tìm...
                  </li>
                ) : pickerCandidates.length === 0 ? (
                  <li className="px-2 py-1 text-xs text-slate-500">
                    Không có tài liệu phù hợp (hoặc đã gắn hết).
                  </li>
                ) : (
                  pickerCandidates.map((document) => (
                    <li key={document.id}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-800 transition-colors hover:border-sky-300 hover:bg-sky-50"
                        onClick={() =>
                          attachDocument.mutate({
                            documentId: document.id,
                            materialIds: [materialId],
                          })
                        }
                        disabled={attachDocument.isPending}
                      >
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {document.title}
                        </span>
                        <span className="shrink-0 text-xs text-slate-500">
                          {document.linkedMaterialCount} vật tư
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            ) : null}
          </article>

          <form
            className="rounded-lg border border-slate-200 bg-slate-50/60 p-4"
            onSubmit={submitUrlDocument}
          >
            <h4 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
              <LinkIcon className="h-4 w-4 text-slate-500" aria-hidden />
              Thêm từ URL PDF
            </h4>
            <div className="mt-3 grid gap-2">
              <input
                type="url"
                className={inputClass}
                placeholder="https://... (.pdf)"
                value={newUrl}
                onChange={(event) => setNewUrl(event.target.value)}
                required
              />
              <input
                type="text"
                className={inputClass}
                placeholder="Tên tài liệu (tùy chọn)"
                value={newTitle}
                onChange={(event) => setNewTitle(event.target.value)}
              />
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                isLoading={createDocument.isPending}
                disabled={!newUrl.trim()}
              >
                Thêm và gắn vào vật tư
              </Button>
            </div>
          </form>

          <form
            className="rounded-lg border border-slate-200 bg-slate-50/60 p-4"
            onSubmit={(event) => void submitUpload(event)}
          >
            <h4 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
              <Upload className="h-4 w-4 text-slate-500" aria-hidden />
              Upload tệp PDF (tối đa 50 MB)
            </h4>
            <div className="mt-3 grid gap-2">
              <input
                type="file"
                accept=".pdf,application/pdf"
                className="text-sm text-slate-700 file:mr-3 file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-slate-700"
                onChange={(event) =>
                  setUploadFile(event.target.files?.[0] ?? null)
                }
              />
              <input
                type="text"
                className={inputClass}
                placeholder="Tên tài liệu (tùy chọn)"
                value={uploadTitle}
                onChange={(event) => setUploadTitle(event.target.value)}
              />
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                isLoading={uploadDocument.isPending}
                disabled={!uploadFile}
              >
                Upload và gắn vào vật tư
              </Button>
            </div>
          </form>
        </div>

        <article className="rounded-lg border border-slate-200 bg-white p-4">
          <h4 className="text-sm font-semibold text-slate-900">
            Tài liệu đã gắn
          </h4>
          {linkedQuery.isLoading ? (
            <p className="mt-3 text-sm text-slate-500">Đang tải...</p>
          ) : linkedDocuments.length === 0 ? (
            <EmptyState
              className="mt-3"
              title="Chưa có catalog PDF nào."
              description="Gắn tài liệu có sẵn, thêm từ URL hoặc upload tệp PDF."
              icon={<FileText className="h-5 w-5" aria-hidden />}
            />
          ) : (
            <ul className="mt-3 space-y-2">
              {linkedDocuments.map((document) => {
                const fileSizeLabel = formatFileSize(document.fileSize);
                return (
                  <li
                    key={document.id}
                    className="rounded-lg border border-slate-200 bg-slate-50/50 p-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold [overflow-wrap:anywhere] text-slate-900">
                          {document.title}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <Badge tone="neutral">
                            {sourceTypeLabel[document.sourceType]}
                          </Badge>
                          <Badge tone="info">
                            {linkSourceLabel[document.linkSource]}
                          </Badge>
                          {document.localFilePath ? (
                            <Badge tone="success">
                              Bản cục bộ{fileSizeLabel ? ` · ${fileSizeLabel}` : ""}
                            </Badge>
                          ) : (
                            <Badge tone="warning">Chỉ URL ngoài</Badge>
                          )}
                          {document.supplier ? (
                            <Badge tone="neutral">{document.supplier}</Badge>
                          ) : null}
                        </div>
                        {document.notes ? (
                          <p className="mt-1 text-xs text-slate-600">
                            {document.notes}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                        {document.sourceUrl ? (
                          <a
                            href={document.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex min-h-8 items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                            Mở URL
                          </a>
                        ) : null}
                        {document.localFilePath ? (
                          <a
                            href={`/api/catalog-pdfs/${document.id}/file`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex min-h-8 items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                          >
                            <Download className="h-3.5 w-3.5" aria-hidden />
                            Mở PDF
                          </a>
                        ) : null}
                        {document.sourceUrl && !document.localFilePath ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            leftIcon={
                              <HardDriveDownload className="h-3.5 w-3.5" />
                            }
                            isLoading={
                              downloadToLocal.isPending &&
                              downloadToLocal.variables?.id === document.id
                            }
                            onClick={() =>
                              downloadToLocal.mutate({ id: document.id })
                            }
                          >
                            Lưu cục bộ
                          </Button>
                        ) : null}
                        <Button
                          variant="ghost"
                          size="sm"
                          leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                          onClick={() => setDetachTarget(document)}
                        >
                          Gỡ
                        </Button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </article>
        </div>
      ) : null}
    </section>
  );
}
