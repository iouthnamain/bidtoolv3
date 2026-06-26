"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import type { DragEvent, FormEvent } from "react";
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  FileText,
  FolderDown,
  HardDriveDownload,
  Link as LinkIcon,
  Pencil,
  RefreshCw,
  Save,
  Search,
  Trash2,
  Unlink,
  Upload,
  X,
} from "lucide-react";

import {
  Badge,
  Button,
  BulkActionBar,
  ConfirmDialog,
  EmptyState,
} from "~/app/_components/ui";
import { PermissionGate } from "~/app/_components/dashboard/permission-gate";
import { useToast } from "~/app/_components/ui/toast";
import { api, type RouterOutputs } from "~/trpc/react";

type CatalogDocumentListItem =
  RouterOutputs["catalogDocument"]["list"][number];

type StorageFilter = "all" | "local" | "url-only";
type SortKey = "recent" | "title" | "materials";

const sourceTypeLabel: Record<CatalogDocumentListItem["sourceType"], string> = {
  uploaded: "Đã upload",
  detected: "Tự phát hiện",
  manual_url: "URL thủ công",
  generated: "Tạo tự động",
};

const inputClass =
  "min-h-10 rounded border border-slate-400 bg-white px-3 py-2 text-sm text-slate-900 transition-colors placeholder:text-slate-600 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 focus:outline-none";

const selectClass = `${inputClass} cursor-pointer pr-8`;

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

function formatDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function isPdfFile(file: File) {
  return (
    file.type === "application/pdf" || /\.pdf$/i.test(file.name)
  );
}

export function CatalogPdfLibraryClient({
  view = "library",
  initialDocumentId,
}: {
  view?: "library" | "new" | "detail";
  initialDocumentId?: number;
} = {}) {
  const utils = api.useUtils();
  const toast = useToast();

  const router = useRouter();
  const [keyword, setKeyword] = useState("");
  const [sourceFilter, setSourceFilter] = useState<
    "all" | CatalogDocumentListItem["sourceType"]
  >("all");
  const [storageFilter, setStorageFilter] = useState<StorageFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("recent");
  const [selectedId, setSelectedId] = useState<number | null>(
    initialDocumentId ?? null,
  );
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [deleteTarget, setDeleteTarget] =
    useState<CatalogDocumentListItem | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  const [newUrl, setNewUrl] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newSupplier, setNewSupplier] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  const listQuery = api.catalogDocument.list.useQuery({
    keyword: keyword.trim() || undefined,
    limit: 100,
  });
  const summaryQuery = api.catalogDocument.summary.useQuery(undefined, {
    enabled: view === "library",
  });
  const documents = useMemo(() => listQuery.data ?? [], [listQuery.data]);

  const visibleDocuments = useMemo(() => {
    const filtered = documents.filter((document) => {
      if (sourceFilter !== "all" && document.sourceType !== sourceFilter) {
        return false;
      }
      if (storageFilter === "local" && !document.localFilePath) {
        return false;
      }
      if (storageFilter === "url-only" && document.localFilePath) {
        return false;
      }
      return true;
    });

    const sorted = [...filtered];
    if (sortKey === "title") {
      sorted.sort((a, b) => a.title.localeCompare(b.title, "vi"));
    } else if (sortKey === "materials") {
      sorted.sort((a, b) => b.linkedMaterialCount - a.linkedMaterialCount);
    }
    // "recent" keeps server order (updatedAt desc).
    return sorted;
  }, [documents, sourceFilter, storageFilter, sortKey]);

  const visibleIds = useMemo(
    () => visibleDocuments.map((document) => document.id),
    [visibleDocuments],
  );
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));

  const refresh = async () => {
    await Promise.all([
      utils.catalogDocument.list.invalidate(),
      utils.catalogDocument.summary.invalidate(),
      selectedId != null
        ? utils.catalogDocument.getById.invalidate({ id: selectedId })
        : Promise.resolve(),
      utils.catalogDocument.listByMaterial.invalidate(),
    ]);
  };

  const toggleRow = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        visibleIds.forEach((id) => next.delete(id));
      } else {
        visibleIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const createDocument = api.catalogDocument.create.useMutation({
    onSuccess: async (document) => {
      toast.success("Đã tạo tài liệu catalog.");
      setNewUrl("");
      setNewTitle("");
      setNewSupplier("");
      if (view === "new") {
        router.push(`/catalog-pdfs/${document.id}`);
      } else {
        setSelectedId(document.id);
      }
      await refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  const uploadDocument = api.catalogDocument.uploadPdf.useMutation({
    onSuccess: async (document) => {
      toast.success("Đã upload tài liệu PDF.");
      setUploadFile(null);
      setUploadTitle("");
      if (document) {
        if (view === "new") {
          router.push(`/catalog-pdfs/${document.id}`);
        } else {
          setSelectedId(document.id);
        }
      }
      await refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteDocument = api.catalogDocument.delete.useMutation({
    onSuccess: async (result) => {
      toast.success("Đã xóa tài liệu catalog.");
      setDeleteTarget(null);
      if (selectedId === result.id) {
        setSelectedId(null);
      }
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(result.id);
        return next;
      });
      await refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  const bulkDelete = api.catalogDocument.bulkDelete.useMutation({
    onSuccess: async (result) => {
      toast.success(`Đã xóa ${result.deleted} tài liệu.`);
      setBulkDeleteOpen(false);
      setSelectedIds(new Set());
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
      supplier: newSupplier.trim() || undefined,
    });
  };

  const pickUploadFile = (file: File | null) => {
    if (!file) {
      setUploadFile(null);
      return;
    }
    if (!isPdfFile(file)) {
      toast.error("Chỉ chấp nhận tệp PDF.");
      return;
    }
    setUploadFile(file);
  };

  const onDropFile = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) {
      pickUploadFile(file);
    }
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
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Không đọc được tệp PDF.",
      );
    }
  };

  return (
    <div className="space-y-4">
      <ConfirmDialog
        open={deleteTarget !== null}
        title={`Xóa tài liệu "${deleteTarget?.title ?? ""}"?`}
        description="Tài liệu và toàn bộ liên kết vật tư sẽ bị gỡ. Không thể hoàn tác."
        confirmLabel="Xóa tài liệu"
        variant="danger"
        isLoading={deleteDocument.isPending}
        onConfirm={() => {
          if (deleteTarget) {
            deleteDocument.mutate({ id: deleteTarget.id });
          }
        }}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={bulkDeleteOpen}
        title={`Xóa ${selectedIds.size} tài liệu đã chọn?`}
        description="Toàn bộ tài liệu đã chọn và liên kết vật tư của chúng sẽ bị gỡ. Không thể hoàn tác."
        confirmLabel="Xóa tất cả"
        variant="danger"
        isLoading={bulkDelete.isPending}
        onConfirm={() =>
          bulkDelete.mutate({ ids: Array.from(selectedIds) })
        }
        onCancel={() => setBulkDeleteOpen(false)}
      />

      {view === "new" ? (
        <NewDocumentView
          newUrl={newUrl}
          setNewUrl={setNewUrl}
          newTitle={newTitle}
          setNewTitle={setNewTitle}
          newSupplier={newSupplier}
          setNewSupplier={setNewSupplier}
          uploadFile={uploadFile}
          uploadTitle={uploadTitle}
          setUploadTitle={setUploadTitle}
          isDragging={isDragging}
          setIsDragging={setIsDragging}
          onPickFile={pickUploadFile}
          onDropFile={onDropFile}
          onSubmitUrl={submitUrlDocument}
          onSubmitUpload={submitUpload}
          isCreating={createDocument.isPending}
          isUploading={uploadDocument.isPending}
        />
      ) : null}

      {view === "library" ? (
        <>
          <KpiStrip
            total={summaryQuery.data?.total ?? documents.length}
            withLocalFile={
              summaryQuery.data?.withLocalFile ??
              documents.filter((d) => d.localFilePath).length
            }
            urlOnly={
              (summaryQuery.data?.total ?? documents.length) -
              (summaryQuery.data?.withLocalFile ??
                documents.filter((d) => d.localFilePath).length)
            }
          />

          <section className="panel p-2">
            <div className="flex flex-wrap items-center justify-between gap-1">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-slate-700" aria-hidden />
                <h3 className="text-base font-bold text-slate-950">Thư viện</h3>
                <Badge tone="info">{visibleDocuments.length} tài liệu</Badge>
              </div>
              <div className="relative w-full max-w-sm">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-600"
                  aria-hidden
                />
                <input
                  type="search"
                  className={`${inputClass} w-full pl-9`}
                  placeholder="Tìm theo tên, NCC, URL hoặc ghi chú…"
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                />
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <select
                aria-label="Lọc theo nguồn"
                className={selectClass}
                value={sourceFilter}
                onChange={(event) =>
                  setSourceFilter(
                    event.target.value as typeof sourceFilter,
                  )
                }
              >
                <option value="all">Mọi nguồn</option>
                <option value="uploaded">Đã upload</option>
                <option value="manual_url">URL thủ công</option>
                <option value="detected">Tự phát hiện</option>
              </select>
              <select
                aria-label="Lọc theo bản lưu"
                className={selectClass}
                value={storageFilter}
                onChange={(event) =>
                  setStorageFilter(event.target.value as StorageFilter)
                }
              >
                <option value="all">Mọi bản lưu</option>
                <option value="local">Có bản cục bộ</option>
                <option value="url-only">Chỉ URL</option>
              </select>
              <select
                aria-label="Sắp xếp"
                className={selectClass}
                value={sortKey}
                onChange={(event) =>
                  setSortKey(event.target.value as SortKey)
                }
              >
                <option value="recent">Mới cập nhật</option>
                <option value="title">Tên A→Z</option>
                <option value="materials">Nhiều vật tư nhất</option>
              </select>
              {(sourceFilter !== "all" ||
                storageFilter !== "all" ||
                sortKey !== "recent" ||
                keyword.trim()) ? (
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<X className="h-3.5 w-3.5" />}
                  onClick={() => {
                    setSourceFilter("all");
                    setStorageFilter("all");
                    setSortKey("recent");
                    setKeyword("");
                  }}
                >
                  Xóa lọc
                </Button>
              ) : null}
            </div>

            {selectedIds.size > 0 ? (
              <div className="mt-3">
                <BulkActionBar
                  count={selectedIds.size}
                  onClear={() => setSelectedIds(new Set())}
                >
                  <PermissionGate permission="catalog:write">
                    <Button
                      variant="danger"
                      size="sm"
                      leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                      onClick={() => setBulkDeleteOpen(true)}
                    >
                      Xóa đã chọn
                    </Button>
                  </PermissionGate>
                </BulkActionBar>
              </div>
            ) : null}

            {listQuery.isLoading ? (
              <p className="mt-4 text-sm text-slate-700">Đang tải…</p>
            ) : documents.length === 0 ? (
              <EmptyState
                className="mt-4"
                title="Chưa có tài liệu catalog nào."
                description="Thêm tài liệu từ URL PDF hoặc upload tệp."
                icon={<FileText className="h-5 w-5" aria-hidden />}
                cta={
                  <PermissionGate permission="catalog:write">
                    <Button
                      size="sm"
                      leftIcon={<Upload className="h-3.5 w-3.5" />}
                      onClick={() => router.push("/catalog-pdfs/new")}
                    >
                      Thêm tài liệu
                    </Button>
                  </PermissionGate>
                }
              />
            ) : visibleDocuments.length === 0 ? (
              <EmptyState
                className="mt-4"
                title="Không có tài liệu khớp bộ lọc."
                description="Thử nới lỏng bộ lọc hoặc xóa từ khóa tìm kiếm."
                icon={<Search className="h-5 w-5" aria-hidden />}
              />
            ) : (
              <div className="mt-4 overflow-hidden">
                <table className="w-full table-fixed text-left text-sm break-words">
                  <thead>
                    <tr className="border-b border-slate-400 text-xs font-semibold tracking-wide text-slate-700 uppercase">
                      <th className="w-8 px-2 py-2">
                        <input
                          type="checkbox"
                          aria-label="Chọn tất cả"
                          className="h-4 w-4 cursor-pointer rounded border-slate-400 text-blue-600 focus:ring-blue-500"
                          checked={allVisibleSelected}
                          onChange={toggleAllVisible}
                        />
                      </th>
                      <th className="px-2 py-2">Tài liệu</th>
                      <th className="px-2 py-2">Nguồn</th>
                      <th className="px-2 py-2">Bản cục bộ</th>
                      <th className="px-2 py-2">Vật tư</th>
                      <th className="px-2 py-2 text-right">Hành động</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleDocuments.map((document) => {
                      const fileSizeLabel = formatFileSize(document.fileSize);
                      const isSelected = selectedId === document.id;
                      const isChecked = selectedIds.has(document.id);
                      const updatedLabel = formatDate(document.updatedAt);
                      return (
                        <tr
                          key={document.id}
                          className={`border-b border-slate-400 ${
                            isChecked
                              ? "bg-blue-50"
                              : isSelected
                                ? "bg-blue-50/70"
                                : "hover:bg-slate-50"
                          }`}
                        >
                          <td className="px-2 py-2.5 align-top">
                            <input
                              type="checkbox"
                              aria-label={`Chọn ${document.title}`}
                              className="mt-1 h-4 w-4 cursor-pointer rounded border-slate-400 text-blue-600 focus:ring-blue-500"
                              checked={isChecked}
                              onChange={() => toggleRow(document.id)}
                            />
                          </td>
                          <td className="px-2 py-2.5">
                            <button
                              type="button"
                              className="text-left font-semibold text-slate-900 [overflow-wrap:anywhere] hover:text-blue-700"
                              onClick={() =>
                                router.push(`/catalog-pdfs/${document.id}`)
                              }
                            >
                              {document.title}
                            </button>
                            <div className="mt-1 flex flex-wrap items-center gap-1">
                              <Badge tone="neutral">
                                {sourceTypeLabel[document.sourceType]}
                              </Badge>
                              {document.supplier ? (
                                <Badge tone="neutral">
                                  {document.supplier}
                                </Badge>
                              ) : null}
                              {document.tagsJson.map((tag) => (
                                <Badge key={tag} tone="info">
                                  {tag}
                                </Badge>
                              ))}
                              {updatedLabel ? (
                                <span className="text-xs text-slate-600">
                                  {updatedLabel}
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-2 py-2.5">
                            {document.sourceUrl ? (
                              <a
                                href={document.sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-900"
                              >
                                <ExternalLink
                                  className="h-3.5 w-3.5"
                                  aria-hidden
                                />
                                Mở URL
                              </a>
                            ) : (
                              <span className="text-xs text-slate-600">-</span>
                            )}
                          </td>
                          <td className="px-2 py-2.5">
                            {document.localFilePath ? (
                              <a
                                href={`/api/catalog-pdfs/${document.id}/file`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-900"
                              >
                                <Download
                                  className="h-3.5 w-3.5"
                                  aria-hidden
                                />
                                PDF{fileSizeLabel ? ` (${fileSizeLabel})` : ""}
                              </a>
                            ) : (
                              <Badge tone="warning">Chỉ URL</Badge>
                            )}
                          </td>
                          <td className="px-2 py-2.5">
                            <Badge
                              tone={
                                document.linkedMaterialCount === 0
                                  ? "neutral"
                                  : "info"
                              }
                            >
                              {document.linkedMaterialCount}
                            </Badge>
                          </td>
                          <td className="px-2 py-2.5">
                            <div className="flex items-center justify-end gap-1.5">
                              <Button
                                variant="secondary"
                                size="sm"
                                leftIcon={<Pencil className="h-3.5 w-3.5" />}
                                onClick={() =>
                                  router.push(`/catalog-pdfs/${document.id}`)
                                }
                              >
                                Chi tiết
                              </Button>
                              <PermissionGate permission="catalog:write">
                                <Button
                                  variant="danger"
                                  size="sm"
                                  leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                                  onClick={() => setDeleteTarget(document)}
                                >
                                  Xóa
                                </Button>
                              </PermissionGate>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}

      {view === "detail" && selectedId != null ? (
        <CatalogPdfDetailPanel
          documentId={selectedId}
          onClose={() => router.push("/catalog-pdfs")}
          onChanged={refresh}
        />
      ) : null}
    </div>
  );
}

function KpiStrip({
  total,
  withLocalFile,
  urlOnly,
}: {
  total: number;
  withLocalFile: number;
  urlOnly: number;
}) {
  const items = [
    { label: "Tổng tài liệu", value: total, tone: "text-slate-900" },
    { label: "Có bản cục bộ", value: withLocalFile, tone: "text-emerald-700" },
    { label: "Chỉ URL", value: urlOnly, tone: "text-amber-700" },
  ];
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
      {items.map((item) => (
        <div key={item.label} className="panel px-4 py-3">
          <p className="text-xs font-semibold tracking-wide text-slate-700 uppercase">
            {item.label}
          </p>
          <p className={`mt-1 text-2xl font-bold tabular-nums ${item.tone}`}>
            {item.value}
          </p>
        </div>
      ))}
    </div>
  );
}

function NewDocumentView({
  newUrl,
  setNewUrl,
  newTitle,
  setNewTitle,
  newSupplier,
  setNewSupplier,
  uploadFile,
  uploadTitle,
  setUploadTitle,
  isDragging,
  setIsDragging,
  onPickFile,
  onDropFile,
  onSubmitUrl,
  onSubmitUpload,
  isCreating,
  isUploading,
}: {
  newUrl: string;
  setNewUrl: (value: string) => void;
  newTitle: string;
  setNewTitle: (value: string) => void;
  newSupplier: string;
  setNewSupplier: (value: string) => void;
  uploadFile: File | null;
  uploadTitle: string;
  setUploadTitle: (value: string) => void;
  isDragging: boolean;
  setIsDragging: (value: boolean) => void;
  onPickFile: (file: File | null) => void;
  onDropFile: (event: DragEvent<HTMLDivElement>) => void;
  onSubmitUrl: (event: FormEvent<HTMLFormElement>) => void;
  onSubmitUpload: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  isCreating: boolean;
  isUploading: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileSizeLabel = uploadFile ? formatFileSize(uploadFile.size) : null;

  return (
    <section className="panel p-2">
      <h3 className="text-base font-bold text-slate-950">Thêm tài liệu</h3>
      <div className="mt-4 grid gap-2 md:grid-cols-2">
        <form
          className="rounded border border-slate-400 bg-slate-50/60 p-4"
          onSubmit={onSubmitUrl}
        >
          <h4 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            <LinkIcon className="h-4 w-4 text-slate-700" aria-hidden />
            Từ URL PDF
          </h4>
          <div className="mt-3 grid gap-2">
            <input
              type="url"
              className={inputClass}
              placeholder="https://… (.pdf)"
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
            <input
              type="text"
              className={inputClass}
              placeholder="Nhà cung cấp (tùy chọn)"
              value={newSupplier}
              onChange={(event) => setNewSupplier(event.target.value)}
            />
            <Button
              type="submit"
              variant="primary"
              size="sm"
              isLoading={isCreating}
              disabled={!newUrl.trim()}
            >
              Tạo tài liệu URL
            </Button>
          </div>
        </form>

        <form
          className="rounded border border-slate-400 bg-slate-50/60 p-4"
          onSubmit={(event) => void onSubmitUpload(event)}
        >
          <h4 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            <Upload className="h-4 w-4 text-slate-700" aria-hidden />
            Upload tệp PDF (tối đa 50 MB)
          </h4>
          <div className="mt-3 grid gap-2">
            <div
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={onDropFile}
              className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded border-2 border-dashed px-4 py-6 text-center transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none ${
                isDragging
                  ? "border-blue-400 bg-blue-50"
                  : "border-slate-400 bg-white hover:border-blue-300 hover:bg-blue-50/40"
              }`}
            >
              <Upload className="h-5 w-5 text-slate-600" aria-hidden />
              {uploadFile ? (
                <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                  <FileText className="h-4 w-4 text-emerald-600" aria-hidden />
                  {uploadFile.name}
                  {fileSizeLabel ? (
                    <span className="font-normal text-slate-700">
                      ({fileSizeLabel})
                    </span>
                  ) : null}
                </span>
              ) : (
                <>
                  <span className="text-sm font-semibold text-slate-700">
                    Kéo thả PDF vào đây
                  </span>
                  <span className="text-xs text-slate-700">
                    hoặc bấm để chọn tệp
                  </span>
                </>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,application/pdf"
                className="hidden"
                onChange={(event) =>
                  onPickFile(event.target.files?.[0] ?? null)
                }
              />
            </div>
            {uploadFile ? (
              <button
                type="button"
                className="self-start text-xs font-semibold text-slate-700 hover:text-rose-600"
                onClick={() => onPickFile(null)}
              >
                Bỏ tệp đã chọn
              </button>
            ) : null}
            <input
              type="text"
              className={inputClass}
              placeholder="Tên tài liệu (tùy chọn)"
              value={uploadTitle}
              onChange={(event) => setUploadTitle(event.target.value)}
            />
            <PermissionGate permission="catalog:write">
              <Button
                type="submit"
                variant="primary"
                size="sm"
                isLoading={isUploading}
                disabled={!uploadFile}
              >
                Upload PDF
              </Button>
            </PermissionGate>
          </div>
        </form>
      </div>
    </section>
  );
}

function CatalogPdfDetailPanel({
  documentId,
  onClose,
  onChanged,
}: {
  documentId: number;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const utils = api.useUtils();
  const toast = useToast();
  const reuploadInputRef = useRef<HTMLInputElement>(null);

  const detailQuery = api.catalogDocument.getById.useQuery({ id: documentId });
  const document = detailQuery.data;

  const [form, setForm] = useState<{
    title: string;
    supplier: string;
    sourceUrl: string;
    notes: string;
    tags: string;
  } | null>(null);
  const [materialKeyword, setMaterialKeyword] = useState("");
  const [copied, setCopied] = useState<"url" | "local" | null>(null);

  const editForm =
    form ??
    (document
      ? {
          title: document.title,
          supplier: document.supplier ?? "",
          sourceUrl: document.sourceUrl ?? "",
          notes: document.notes,
          tags: document.tagsJson.join(", "),
        }
      : null);

  const refreshDetail = async () => {
    await utils.catalogDocument.getById.invalidate({ id: documentId });
    await onChanged();
  };

  const updateDocument = api.catalogDocument.update.useMutation({
    onSuccess: async () => {
      toast.success("Đã lưu tài liệu.");
      setForm(null);
      await refreshDetail();
    },
    onError: (error) => toast.error(error.message),
  });

  const downloadToLocal = api.catalogDocument.downloadToLocal.useMutation({
    onSuccess: async () => {
      toast.success("Đã lưu bản PDF cục bộ.");
      await refreshDetail();
    },
    onError: (error) => toast.error(error.message),
  });

  const reuploadPdf = api.catalogDocument.reuploadPdf.useMutation({
    onSuccess: async () => {
      toast.success("Đã thay tệp PDF cục bộ.");
      await refreshDetail();
    },
    onError: (error) => toast.error(error.message),
  });

  const attachMaterials = api.catalogDocument.attachToMaterials.useMutation({
    onSuccess: async (result) => {
      toast.success(`Đã gắn ${result.linked} vật tư.`);
      setMaterialKeyword("");
      await refreshDetail();
    },
    onError: (error) => toast.error(error.message),
  });

  const detachMaterial = api.catalogDocument.detachFromMaterial.useMutation({
    onSuccess: async () => {
      toast.success("Đã gỡ liên kết vật tư.");
      await refreshDetail();
    },
    onError: (error) => toast.error(error.message),
  });

  const materialSearch = api.material.searchMaterials.useQuery(
    {
      keyword: materialKeyword.trim() || undefined,
      priceStatus: "all",
      sourceStatus: "all",
      limit: 10,
      offset: 0,
    },
    { enabled: materialKeyword.trim().length > 0 },
  );

  const linkedMaterialIds = new Set(
    (document?.linkedMaterials ?? []).map((material) => material.id),
  );
  const materialCandidates = (materialSearch.data ?? []).filter(
    (material) => !linkedMaterialIds.has(material.id),
  );

  const localFileUrl = document?.localFilePath
    ? `/api/catalog-pdfs/${documentId}/file${
        document.checksum ? `?v=${document.checksum.slice(0, 12)}` : ""
      }`
    : null;

  const copyToClipboard = async (value: string, kind: "url" | "local") => {
    try {
      const absolute =
        kind === "local" && typeof window !== "undefined"
          ? new URL(value, window.location.origin).toString()
          : value;
      await navigator.clipboard.writeText(absolute);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.error("Không sao chép được liên kết.");
    }
  };

  const handleReupload = async (file: File | null) => {
    if (!file) {
      return;
    }
    if (!isPdfFile(file)) {
      toast.error("Chỉ chấp nhận tệp PDF.");
      return;
    }
    try {
      const fileBase64 = await fileToBase64(file);
      reuploadPdf.mutate({ id: documentId, fileName: file.name, fileBase64 });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Không đọc được tệp PDF.",
      );
    } finally {
      if (reuploadInputRef.current) {
        reuploadInputRef.current.value = "";
      }
    }
  };

  const saveMetadata = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editForm) {
      return;
    }
    updateDocument.mutate({
      id: documentId,
      patch: {
        title: editForm.title.trim() || "Catalog PDF",
        supplier: editForm.supplier,
        sourceUrl: editForm.sourceUrl,
        notes: editForm.notes,
        tags: editForm.tags
          .split(/[,;]/)
          .map((tag) => tag.trim())
          .filter(Boolean),
      },
    });
  };

  return (
    <section id="catalog-pdf-detail" className="space-y-4 scroll-mt-6">
      <div className="panel flex flex-wrap items-center justify-between gap-1 p-2">
        <div className="min-w-0">
          <h3 className="truncate text-base font-bold text-slate-950">
            {document?.title ?? `Chi tiết tài liệu #${documentId}`}
          </h3>
          {document ? (
            <p className="mt-0.5 text-xs text-slate-700">
              #{documentId} · {sourceTypeLabel[document.sourceType]}
            </p>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<X className="h-4 w-4" />}
          onClick={onClose}
        >
          Đóng
        </Button>
      </div>

      {detailQuery.isLoading || !document || !editForm ? (
        <div className="panel p-2">
          <p className="text-sm text-slate-700">Đang tải…</p>
        </div>
      ) : (
        <>
          <MetadataFacts
            document={document}
            onCopyUrl={() =>
              document.sourceUrl
                ? void copyToClipboard(document.sourceUrl, "url")
                : undefined
            }
            onCopyLocal={() =>
              localFileUrl
                ? void copyToClipboard(localFileUrl, "local")
                : undefined
            }
            copied={copied}
          />

          <div className="grid gap-2 xl:grid-cols-2">
            <form
              className="panel p-2"
              onSubmit={saveMetadata}
            >
              <h4 className="text-sm font-semibold text-slate-900">Metadata</h4>
              <div className="mt-3 grid gap-2">
                <label className="grid gap-1 text-xs font-semibold text-slate-600">
                  Tên tài liệu
                  <input
                    type="text"
                    className={inputClass}
                    value={editForm.title}
                    onChange={(event) =>
                      setForm({ ...editForm, title: event.target.value })
                    }
                    required
                  />
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-600">
                  Nhà cung cấp
                  <input
                    type="text"
                    className={inputClass}
                    value={editForm.supplier}
                    onChange={(event) =>
                      setForm({ ...editForm, supplier: event.target.value })
                    }
                  />
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-600">
                  URL nguồn
                  <input
                    type="url"
                    className={inputClass}
                    value={editForm.sourceUrl}
                    onChange={(event) =>
                      setForm({ ...editForm, sourceUrl: event.target.value })
                    }
                  />
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-600">
                  Tags (phân tách bằng dấu phẩy)
                  <input
                    type="text"
                    className={inputClass}
                    value={editForm.tags}
                    onChange={(event) =>
                      setForm({ ...editForm, tags: event.target.value })
                    }
                  />
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-600">
                  Ghi chú
                  <textarea
                    className={`${inputClass} min-h-20`}
                    value={editForm.notes}
                    onChange={(event) =>
                      setForm({ ...editForm, notes: event.target.value })
                    }
                  />
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    leftIcon={<Save className="h-3.5 w-3.5" />}
                    isLoading={updateDocument.isPending}
                  >
                    Lưu metadata
                  </Button>
                  {document.sourceUrl ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      leftIcon={
                        document.localFilePath ? (
                          <HardDriveDownload className="h-3.5 w-3.5" />
                        ) : (
                          <FolderDown className="h-3.5 w-3.5" />
                        )
                      }
                      isLoading={downloadToLocal.isPending}
                      onClick={() => downloadToLocal.mutate({ id: documentId })}
                    >
                      {document.localFilePath
                        ? "Tải lại từ URL"
                        : "Tải bản cục bộ"}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
                    isLoading={reuploadPdf.isPending}
                    onClick={() => reuploadInputRef.current?.click()}
                  >
                    {document.localFilePath ? "Thay tệp" : "Upload tệp"}
                  </Button>
                  <input
                    ref={reuploadInputRef}
                    type="file"
                    accept=".pdf,application/pdf"
                    className="hidden"
                    onChange={(event) =>
                      void handleReupload(event.target.files?.[0] ?? null)
                    }
                  />
                </div>
              </div>
            </form>

            <div className="panel p-2">
              <h4 className="text-sm font-semibold text-slate-900">
                Vật tư liên kết ({document.linkedMaterials.length})
              </h4>
              <div className="relative mt-3">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-600"
                  aria-hidden
                />
                <input
                  type="search"
                  className={`${inputClass} w-full pl-9`}
                  placeholder="Tìm vật tư để gắn thêm…"
                  value={materialKeyword}
                  onChange={(event) => setMaterialKeyword(event.target.value)}
                />
              </div>
              {materialKeyword.trim() ? (
                <ul className="mt-2 space-y-1">
                  {materialSearch.isLoading ? (
                    <li className="px-2 py-1 text-xs text-slate-700">
                      Đang tìm…
                    </li>
                  ) : materialCandidates.length === 0 ? (
                    <li className="px-2 py-1 text-xs text-slate-700">
                      Không có vật tư phù hợp (hoặc đã gắn hết).
                    </li>
                  ) : (
                    materialCandidates.map((material) => (
                      <li key={material.id}>
                        <button
                          type="button"
                          className="flex w-full items-center justify-between gap-2 rounded border border-slate-400 bg-white px-3 py-2 text-left text-sm text-slate-800 transition-colors hover:border-blue-300 hover:bg-blue-50"
                          onClick={() =>
                            attachMaterials.mutate({
                              documentId,
                              materialIds: [material.id],
                            })
                          }
                          disabled={attachMaterials.isPending}
                        >
                          <span className="min-w-0 flex-1 truncate font-medium">
                            {material.name}
                          </span>
                          <span className="shrink-0 text-xs text-slate-700">
                            {material.unit}
                          </span>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              ) : null}

              {document.linkedMaterials.length === 0 ? (
                <EmptyState
                  className="mt-3"
                  title="Chưa gắn vật tư nào."
                  description="Tìm vật tư ở trên để liên kết với tài liệu này."
                />
              ) : (
                <ul className="mt-3 space-y-1.5">
                  {document.linkedMaterials.map((material) => (
                    <li
                      key={material.id}
                      className="flex items-center justify-between gap-2 rounded border border-slate-400 bg-slate-50/50 px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/materials/${material.id}`}
                          className="block truncate text-sm font-semibold text-slate-900 hover:text-blue-700"
                        >
                          {material.name}
                        </Link>
                        <span className="text-xs text-slate-700">
                          {material.code ? `${material.code} · ` : ""}
                          {material.unit}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        leftIcon={<Unlink className="h-3.5 w-3.5" />}
                        isLoading={
                          detachMaterial.isPending &&
                          detachMaterial.variables?.materialId === material.id
                        }
                        onClick={() =>
                          detachMaterial.mutate({
                            documentId,
                            materialId: material.id,
                          })
                        }
                      >
                        Gỡ
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {localFileUrl ? (
            <div className="panel overflow-hidden p-0">
              <div className="flex items-center justify-between gap-2 border-b border-slate-400 px-4 py-2.5">
                <h4 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                  <FileText className="h-4 w-4 text-slate-700" aria-hidden />
                  Xem trước PDF
                </h4>
                <a
                  href={localFileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-900"
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  Mở tab mới
                </a>
              </div>
              <iframe
                title={`Xem trước ${document.title}`}
                src={localFileUrl}
                className="h-[70vh] w-full border-0 bg-slate-100"
              />
            </div>
          ) : (
            <EmptyState
              title="Chưa có bản PDF cục bộ để xem trước."
              description="Tải bản cục bộ từ URL hoặc upload tệp để xem trước trực tiếp tại đây."
              icon={<FileText className="h-5 w-5" aria-hidden />}
            />
          )}
        </>
      )}
    </section>
  );
}

function MetadataFacts({
  document,
  onCopyUrl,
  onCopyLocal,
  copied,
}: {
  document: RouterOutputs["catalogDocument"]["getById"];
  onCopyUrl: () => void;
  onCopyLocal: () => void;
  copied: "url" | "local" | null;
}) {
  const facts: { label: string; value: string }[] = [];
  const size = formatFileSize(document.fileSize);
  if (size) {
    facts.push({ label: "Kích thước", value: size });
  }
  if (document.mimeType) {
    facts.push({ label: "Định dạng", value: document.mimeType });
  }
  const created = formatDate(document.createdAt);
  if (created) {
    facts.push({ label: "Tạo lúc", value: created });
  }
  const updated = formatDate(document.updatedAt);
  if (updated) {
    facts.push({ label: "Cập nhật", value: updated });
  }
  if (document.checksum) {
    facts.push({
      label: "Checksum",
      value: `${document.checksum.slice(0, 12)}…`,
    });
  }

  return (
    <div className="panel p-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={document.localFilePath ? "success" : "warning"}>
          {document.localFilePath ? "Có bản cục bộ" : "Chỉ URL"}
        </Badge>
        {document.supplier ? (
          <Badge tone="neutral">{document.supplier}</Badge>
        ) : null}
        {document.tagsJson.map((tag) => (
          <Badge key={tag} tone="info">
            {tag}
          </Badge>
        ))}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {document.sourceUrl ? (
            <Button
              variant="ghost"
              size="sm"
              leftIcon={
                copied === "url" ? (
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )
              }
              onClick={onCopyUrl}
            >
              {copied === "url" ? "Đã chép" : "Chép URL"}
            </Button>
          ) : null}
          {document.localFilePath ? (
            <Button
              variant="ghost"
              size="sm"
              leftIcon={
                copied === "local" ? (
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                ) : (
                  <LinkIcon className="h-3.5 w-3.5" />
                )
              }
              onClick={onCopyLocal}
            >
              {copied === "local" ? "Đã chép" : "Chép link cục bộ"}
            </Button>
          ) : null}
        </div>
      </div>

      {facts.length > 0 ? (
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-5">
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt className="text-xs font-semibold tracking-wide text-slate-700 uppercase">
                {fact.label}
              </dt>
              <dd className="mt-0.5 truncate text-sm font-medium text-slate-900 [overflow-wrap:anywhere]">
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
