"use client";

import Link from "next/link";
import { useState } from "react";
import type { FormEvent } from "react";
import {
  Download,
  ExternalLink,
  FileText,
  HardDriveDownload,
  Link as LinkIcon,
  Pencil,
  Save,
  Search,
  Trash2,
  Unlink,
  Upload,
  X,
} from "lucide-react";

import { Badge, Button, ConfirmDialog, EmptyState } from "~/app/_components/ui";
import { useToast } from "~/app/_components/ui/toast";
import { api, type RouterOutputs } from "~/trpc/react";

type CatalogDocumentListItem =
  RouterOutputs["catalogDocument"]["list"][number];

const sourceTypeLabel: Record<CatalogDocumentListItem["sourceType"], string> = {
  uploaded: "Đã upload",
  detected: "Tự phát hiện",
  manual_url: "URL thủ công",
};

const inputClass =
  "min-h-10 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 transition-colors placeholder:text-slate-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-100 focus:outline-none";

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

export function CatalogPdfLibraryClient() {
  const utils = api.useUtils();
  const toast = useToast();

  const [keyword, setKeyword] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] =
    useState<CatalogDocumentListItem | null>(null);

  const [newUrl, setNewUrl] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newSupplier, setNewSupplier] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");

  const listQuery = api.catalogDocument.list.useQuery({
    keyword: keyword.trim() || undefined,
    limit: 100,
  });
  const documents = listQuery.data ?? [];

  const refresh = async () => {
    await Promise.all([
      utils.catalogDocument.list.invalidate(),
      selectedId != null
        ? utils.catalogDocument.getById.invalidate({ id: selectedId })
        : Promise.resolve(),
      utils.catalogDocument.listByMaterial.invalidate(),
    ]);
  };

  const createDocument = api.catalogDocument.create.useMutation({
    onSuccess: async (document) => {
      toast.success("Đã tạo tài liệu catalog.");
      setNewUrl("");
      setNewTitle("");
      setNewSupplier("");
      setSelectedId(document.id);
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
        setSelectedId(document.id);
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

      <section id="catalog-pdf-create" className="panel scroll-mt-6 p-5">
        <h3 className="text-base font-bold text-slate-950">Thêm tài liệu</h3>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <form
            className="rounded-lg border border-slate-200 bg-slate-50/60 p-4"
            onSubmit={submitUrlDocument}
          >
            <h4 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
              <LinkIcon className="h-4 w-4 text-slate-500" aria-hidden />
              Từ URL PDF
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
                isLoading={createDocument.isPending}
                disabled={!newUrl.trim()}
              >
                Tạo tài liệu URL
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
                variant="primary"
                size="sm"
                isLoading={uploadDocument.isPending}
                disabled={!uploadFile}
              >
                Upload PDF
              </Button>
            </div>
          </form>
        </div>
      </section>

      <section id="catalog-pdf-list" className="panel scroll-mt-6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-slate-500" aria-hidden />
            <h3 className="text-base font-bold text-slate-950">Thư viện</h3>
            <Badge tone="info">{documents.length} tài liệu</Badge>
          </div>
          <div className="relative w-full max-w-sm">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <input
              type="search"
              className={`${inputClass} w-full pl-9`}
              placeholder="Tìm theo tên, NCC, URL hoặc ghi chú..."
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
          </div>
        </div>

        {listQuery.isLoading ? (
          <p className="mt-4 text-sm text-slate-500">Đang tải...</p>
        ) : documents.length === 0 ? (
          <EmptyState
            className="mt-4"
            title="Chưa có tài liệu catalog nào."
            description="Thêm tài liệu từ URL PDF hoặc upload tệp ở phía trên."
            icon={<FileText className="h-5 w-5" aria-hidden />}
          />
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  <th className="px-2 py-2">Tài liệu</th>
                  <th className="px-2 py-2">Nguồn</th>
                  <th className="px-2 py-2">Bản cục bộ</th>
                  <th className="px-2 py-2">Vật tư</th>
                  <th className="px-2 py-2 text-right">Hành động</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((document) => {
                  const fileSizeLabel = formatFileSize(document.fileSize);
                  const isSelected = selectedId === document.id;
                  return (
                    <tr
                      key={document.id}
                      className={`border-b border-slate-100 ${isSelected ? "bg-sky-50/70" : "hover:bg-slate-50"}`}
                    >
                      <td className="px-2 py-2.5">
                        <button
                          type="button"
                          className="text-left font-semibold text-slate-900 [overflow-wrap:anywhere] hover:text-sky-700"
                          onClick={() =>
                            setSelectedId(isSelected ? null : document.id)
                          }
                        >
                          {document.title}
                        </button>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <Badge tone="neutral">
                            {sourceTypeLabel[document.sourceType]}
                          </Badge>
                          {document.supplier ? (
                            <Badge tone="neutral">{document.supplier}</Badge>
                          ) : null}
                          {document.tagsJson.map((tag) => (
                            <Badge key={tag} tone="info">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="px-2 py-2.5">
                        {document.sourceUrl ? (
                          <a
                            href={document.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:text-sky-900"
                          >
                            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                            Mở URL
                          </a>
                        ) : (
                          <span className="text-xs text-slate-400">-</span>
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
                            <Download className="h-3.5 w-3.5" aria-hidden />
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
                              setSelectedId(isSelected ? null : document.id)
                            }
                          >
                            {isSelected ? "Đóng" : "Chi tiết"}
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                            onClick={() => setDeleteTarget(document)}
                          >
                            Xóa
                          </Button>
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

      {selectedId != null ? (
        <CatalogPdfDetailPanel
          documentId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={refresh}
        />
      ) : null}
    </div>
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
    <section id="catalog-pdf-detail" className="panel scroll-mt-6 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-bold text-slate-950">
          Chi tiết tài liệu #{documentId}
        </h3>
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
        <p className="mt-4 text-sm text-slate-500">Đang tải...</p>
      ) : (
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <form
            className="rounded-lg border border-slate-200 bg-slate-50/60 p-4"
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
                {document.sourceUrl && !document.localFilePath ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    leftIcon={<HardDriveDownload className="h-3.5 w-3.5" />}
                    isLoading={downloadToLocal.isPending}
                    onClick={() => downloadToLocal.mutate({ id: documentId })}
                  >
                    Tải bản cục bộ
                  </Button>
                ) : null}
                {document.localFilePath ? (
                  <a
                    href={`/api/catalog-pdfs/${document.id}/file`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-8 items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden />
                    Mở PDF cục bộ
                  </a>
                ) : null}
              </div>
            </div>
          </form>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h4 className="text-sm font-semibold text-slate-900">
              Vật tư liên kết ({document.linkedMaterials.length})
            </h4>
            <div className="relative mt-3">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden
              />
              <input
                type="search"
                className={`${inputClass} w-full pl-9`}
                placeholder="Tìm vật tư để gắn thêm..."
                value={materialKeyword}
                onChange={(event) => setMaterialKeyword(event.target.value)}
              />
            </div>
            {materialKeyword.trim() ? (
              <ul className="mt-2 space-y-1">
                {materialSearch.isLoading ? (
                  <li className="px-2 py-1 text-xs text-slate-500">
                    Đang tìm...
                  </li>
                ) : materialCandidates.length === 0 ? (
                  <li className="px-2 py-1 text-xs text-slate-500">
                    Không có vật tư phù hợp (hoặc đã gắn hết).
                  </li>
                ) : (
                  materialCandidates.map((material) => (
                    <li key={material.id}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-800 transition-colors hover:border-sky-300 hover:bg-sky-50"
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
                        <span className="shrink-0 text-xs text-slate-500">
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
                    className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50/50 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/materials/${material.id}`}
                        className="block truncate text-sm font-semibold text-slate-900 hover:text-sky-700"
                      >
                        {material.name}
                      </Link>
                      <span className="text-xs text-slate-500">
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
      )}
    </section>
  );
}
