"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  FileSpreadsheet,
  Link as LinkIcon,
  PackagePlus,
  Plus,
  Search,
  Trash2,
  WalletCards,
} from "lucide-react";

import {
  Badge,
  BulkActionBar,
  Button,
  ConfirmDialog,
  EmptyState,
} from "~/app/_components/ui";
import { useToast } from "~/app/_components/ui/toast";
import { normalizeMaterialMetadata } from "~/lib/material-price-sources";
import { useRowSelection } from "~/lib/use-row-selection";
import { api } from "~/trpc/react";

function formatMoney(value: number | null | undefined, currency = "VND") {
  if (value == null) {
    return "-";
  }
  return `${value.toLocaleString("vi-VN")} ${currency}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString("vi-VN");
}

function getSourceCount(metadataJson: unknown, sourceUrl?: string | null) {
  const metadata = normalizeMaterialMetadata(metadataJson);
  return metadata.priceSources.length + (sourceUrl ? 1 : 0);
}

export function MaterialsListClient() {
  const [hasMounted, setHasMounted] = useState(false);
  const [keyword, setKeyword] = useState("");
  const utils = api.useUtils();
  const toast = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { data: materials = [], isLoading } =
    api.material.searchMaterials.useQuery({
      keyword,
      limit: 80,
      offset: 0,
    });

  useEffect(() => {
    setHasMounted(true);
  }, []);

  const visibleMaterials = useMemo(
    () => (hasMounted ? materials : []),
    [hasMounted, materials],
  );
  const showInitialLoading =
    !hasMounted || (isLoading && visibleMaterials.length === 0);
  const allIds = useMemo(
    () => visibleMaterials.map((m) => m.id),
    [visibleMaterials],
  );
  const sel = useRowSelection(allIds);

  const deleteMaterial = api.material.deleteMaterial.useMutation({
    onSuccess: async () => {
      toast.success("Đã xóa vật tư.");
      await utils.material.searchMaterials.invalidate();
    },
  });

  const deleteMany = api.material.deleteMany.useMutation({
    onSuccess: async (result) => {
      toast.success(`Đã xóa ${result.count} vật tư.`);
      sel.clear();
      setConfirmDelete(false);
      await utils.material.searchMaterials.invalidate();
    },
    onError: () => {
      toast.error("Không thể xóa vật tư.");
      setConfirmDelete(false);
    },
  });

  const summary = useMemo(() => {
    const categorySet = new Set(
      visibleMaterials
        .map((item) => item.category)
        .filter((value): value is string => Boolean(value)),
    );
    const priced = visibleMaterials.filter(
      (item) => item.defaultUnitPrice != null,
    ).length;
    const withSources = visibleMaterials.filter(
      (item) => getSourceCount(item.metadataJson, item.sourceUrl) > 0,
    ).length;

    return {
      total: visibleMaterials.length,
      priced,
      withSources,
      categories: categorySet.size,
    };
  }, [visibleMaterials]);

  const [singleDeleteTarget, setSingleDeleteTarget] = useState<{
    id: number;
    name: string;
  } | null>(null);

  return (
    <div className="space-y-4">
      <ConfirmDialog
        open={confirmDelete}
        title={`Xóa ${sel.selectedCount} vật tư?`}
        description="Vật tư đã xóa sẽ không hiển thị trong danh mục. Dữ liệu workspace không bị ảnh hưởng."
        confirmLabel="Xóa"
        variant="danger"
        isLoading={deleteMany.isPending}
        onConfirm={() => deleteMany.mutate({ ids: sel.selectedIds })}
        onCancel={() => setConfirmDelete(false)}
      />
      <ConfirmDialog
        open={singleDeleteTarget !== null}
        title={`Xóa vật tư "${singleDeleteTarget?.name ?? ""}"?`}
        variant="danger"
        confirmLabel="Xóa"
        isLoading={deleteMaterial.isPending}
        onConfirm={() => {
          if (singleDeleteTarget)
            deleteMaterial.mutate({ id: singleDeleteTarget.id });
          setSingleDeleteTarget(null);
        }}
        onCancel={() => setSingleDeleteTarget(null)}
      />

      <section id="material-summary" className="panel scroll-mt-6 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-950">
              Quản lý sản phẩm / vật tư
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Danh mục catalog, giá mặc định và link nguồn đang dùng cho Excel
              Workspace.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/materials/new"
              className="inline-flex items-center gap-1.5 rounded-lg bg-sky-700 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-800"
            >
              <Plus className="h-4 w-4" aria-hidden />
              Thêm thủ công
            </Link>
            <Link
              href="/materials/import"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <FileSpreadsheet className="h-4 w-4" aria-hidden />
              Nhập sheet
            </Link>
          </div>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-slate-500">Catalog</p>
              <PackagePlus className="h-4 w-4 text-slate-400" aria-hidden />
            </div>
            <p className="mt-1 text-2xl font-bold text-slate-950">
              {showInitialLoading ? "-" : summary.total.toLocaleString("vi-VN")}
            </p>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-emerald-700">Có giá</p>
              <WalletCards className="h-4 w-4 text-emerald-600" aria-hidden />
            </div>
            <p className="mt-1 text-2xl font-bold text-emerald-900">
              {showInitialLoading
                ? "-"
                : summary.priced.toLocaleString("vi-VN")}
            </p>
          </div>
          <div className="rounded-lg border border-sky-200 bg-sky-50/70 px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-sky-700">Có nguồn</p>
              <LinkIcon className="h-4 w-4 text-sky-600" aria-hidden />
            </div>
            <p className="mt-1 text-2xl font-bold text-sky-950">
              {showInitialLoading
                ? "-"
                : summary.withSources.toLocaleString("vi-VN")}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-slate-500">Nhóm</p>
              <Badge tone="neutral">Category</Badge>
            </div>
            <p className="mt-1 text-2xl font-bold text-slate-950">
              {showInitialLoading
                ? "-"
                : summary.categories.toLocaleString("vi-VN")}
            </p>
          </div>
        </div>
      </section>

      <section id="material-catalog" className="panel scroll-mt-6 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
          <div>
            <h2 className="text-sm font-bold text-slate-950">
              Danh mục vật tư
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              {showInitialLoading
                ? "Đang tải…"
                : `${visibleMaterials.length.toLocaleString("vi-VN")} vật tư trong kết quả hiện tại`}
            </p>
          </div>
          <label className="relative w-full sm:w-80">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <input
              className="w-full rounded-lg border border-slate-300 py-2 pr-3 pl-9 text-sm"
              placeholder="Tìm tên, mã, ĐVT hoặc nhóm"
              aria-label="Tìm sản phẩm hoặc vật tư"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
          </label>
        </div>

        {sel.someSelected ? (
          <div className="mt-3">
            <BulkActionBar count={sel.selectedCount} onClear={sel.clear}>
              <Button
                variant="danger"
                size="sm"
                leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                onClick={() => setConfirmDelete(true)}
              >
                Xóa đã chọn
              </Button>
            </BulkActionBar>
          </div>
        ) : null}

        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-100 text-left text-xs tracking-wide text-slate-600 uppercase">
              <tr>
                <th className="px-3 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={sel.allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = sel.indeterminate;
                    }}
                    onChange={sel.toggleAll}
                    disabled={visibleMaterials.length === 0}
                    className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-sky-600"
                    aria-label="Chọn tất cả vật tư"
                  />
                </th>
                <th className="px-3 py-2">Vật tư</th>
                <th className="px-3 py-2">Phân loại</th>
                <th className="px-3 py-2">Giá mặc định</th>
                <th className="px-3 py-2">Nguồn</th>
                <th className="px-3 py-2">Mặc định THVT</th>
                <th className="px-3 py-2">Cập nhật</th>
                <th className="px-3 py-2"> </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {visibleMaterials.map((item) => {
                const sourceCount = getSourceCount(
                  item.metadataJson,
                  item.sourceUrl,
                );
                const isSelected = sel.selected.has(item.id);
                return (
                  <tr
                    key={item.id}
                    className={`transition-colors ${isSelected ? "bg-sky-50/60" : "hover:bg-slate-50/80"}`}
                  >
                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => sel.toggle(item.id)}
                        className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-sky-600"
                        aria-label={`Chọn ${item.name}`}
                      />
                    </td>
                    <td className="max-w-[420px] px-3 py-2">
                      <Link
                        href={`/materials/${item.id}`}
                        className="font-bold [overflow-wrap:anywhere] text-slate-950 transition-colors hover:text-sky-700 hover:underline"
                      >
                        {item.name}
                      </Link>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        {item.code ? <span>{item.code}</span> : null}
                        {item.specText ? (
                          <span className="line-clamp-1 max-w-[320px]">
                            {item.specText}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-1">
                        <span className="font-semibold text-slate-800">
                          {item.unit}
                        </span>
                        <span className="text-xs text-slate-500">
                          {item.category ?? "-"}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2 font-semibold text-slate-900">
                      {formatMoney(item.defaultUnitPrice, item.currency)}
                    </td>
                    <td className="px-3 py-2">
                      {sourceCount > 0 ? (
                        <Badge tone="info" count={sourceCount}>
                          Link giá
                        </Badge>
                      ) : (
                        <Badge tone="neutral">Chưa có</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600">
                      KH{" "}
                      <span className="font-semibold text-slate-800">
                        {item.defaultDepreciation}
                      </span>{" "}
                      • dùng lại{" "}
                      <span className="font-semibold text-slate-800">
                        {item.defaultReusePct}%
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      {formatDate(item.updatedAt)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1.5">
                        <Link
                          href={`/materials/${item.id}`}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-sky-700"
                          aria-label={`Mở chi tiết ${item.name}`}
                        >
                          <ArrowUpRight className="h-4 w-4" aria-hidden />
                        </Link>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 px-0 text-rose-700 hover:bg-rose-50"
                          disabled={deleteMaterial.isPending}
                          onClick={() =>
                            setSingleDeleteTarget({
                              id: item.id,
                              name: item.name,
                            })
                          }
                          aria-label={`Xóa ${item.name}`}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!showInitialLoading && visibleMaterials.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8">
                    <EmptyState
                      title="Chưa có sản phẩm / vật tư."
                      description="Tạo thủ công hoặc nhập sheet để bắt đầu danh mục catalog."
                      cta={
                        <div className="flex flex-wrap justify-center gap-2">
                          <Link
                            href="/materials/new"
                            className="inline-flex items-center rounded-lg bg-sky-700 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-800"
                          >
                            Thêm thủ công
                          </Link>
                          <Link
                            href="/materials/import"
                            className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            Nhập sheet
                          </Link>
                        </div>
                      }
                    />
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
