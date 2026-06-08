"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  FileSpreadsheet,
  Filter,
  Link as LinkIcon,
  PackagePlus,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  SquareCheckBig,
  Trash2,
  WalletCards,
} from "lucide-react";

import { Badge, Button, ConfirmDialog, EmptyState } from "~/app/_components/ui";
import { useToast } from "~/app/_components/ui/toast";
import { normalizeMaterialMetadata } from "~/lib/material-price-sources";
import { useRowSelection } from "~/lib/use-row-selection";
import { api, type RouterInputs } from "~/trpc/react";

type MaterialSearchInput = RouterInputs["material"]["searchMaterials"];
type MaterialSortBy = NonNullable<MaterialSearchInput["sortBy"]>;
type SortOrder = NonNullable<MaterialSearchInput["sortOrder"]>;
type PriceStatus = NonNullable<MaterialSearchInput["priceStatus"]>;

const materialSortOptions: Array<{ value: MaterialSortBy; label: string }> = [
  { value: "updatedAt", label: "Mới cập nhật" },
  { value: "name", label: "Tên vật tư" },
  { value: "unit", label: "Đơn vị tính" },
  { value: "category", label: "Nhóm" },
  { value: "manufacturer", label: "NCC" },
  { value: "originCountry", label: "Xuất xứ" },
  { value: "defaultUnitPrice", label: "Đơn giá" },
];

const priceStatusOptions: Array<{ value: PriceStatus; label: string }> = [
  { value: "all", label: "Tất cả giá" },
  { value: "priced", label: "Đã có giá" },
  { value: "missing", label: "Chưa có giá" },
];

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
  const normalizedSourceUrl = sourceUrl?.trim();
  const hasStandaloneSourceUrl =
    Boolean(normalizedSourceUrl) &&
    !metadata.priceSources.some(
      (source) => source.url.trim() === normalizedSourceUrl,
    );

  return metadata.priceSources.length + (hasStandaloneSourceUrl ? 1 : 0);
}

export function MaterialsListClient() {
  const [hasMounted, setHasMounted] = useState(false);
  const [keyword, setKeyword] = useState("");
  const deferredKeyword = useDeferredValue(keyword);
  const [unitFilter, setUnitFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [manufacturerFilter, setManufacturerFilter] = useState("");
  const [originFilter, setOriginFilter] = useState("");
  const [priceStatus, setPriceStatus] = useState<PriceStatus>("all");
  const [sortBy, setSortBy] = useState<MaterialSortBy>("updatedAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const utils = api.useUtils();
  const toast = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const materialSearchInput = useMemo(
    (): MaterialSearchInput => ({
      keyword: deferredKeyword.trim() || undefined,
      unit: unitFilter || undefined,
      category: categoryFilter || undefined,
      manufacturer: manufacturerFilter || undefined,
      originCountry: originFilter || undefined,
      priceStatus,
      sortBy,
      sortOrder,
      limit: 80,
      offset: 0,
    }),
    [
      deferredKeyword,
      unitFilter,
      categoryFilter,
      manufacturerFilter,
      originFilter,
      priceStatus,
      sortBy,
      sortOrder,
    ],
  );
  const { data: materials = [], isLoading } =
    api.material.searchMaterials.useQuery(materialSearchInput);
  const { data: filterOptions } =
    api.material.getMaterialFilterOptions.useQuery();

  useEffect(() => {
    setHasMounted(true);
  }, []);

  const visibleMaterials = useMemo(
    () => (hasMounted ? materials : []),
    [hasMounted, materials],
  );
  const showInitialLoading =
    !hasMounted || (isLoading && visibleMaterials.length === 0);
  const activeFilterCount = [
    keyword.trim(),
    unitFilter,
    categoryFilter,
    manufacturerFilter,
    originFilter,
    priceStatus !== "all" ? priceStatus : "",
  ].filter(Boolean).length;
  const hasActiveViewControls =
    activeFilterCount > 0 || sortBy !== "updatedAt" || sortOrder !== "desc";
  const allIds = useMemo(
    () => visibleMaterials.map((m) => m.id),
    [visibleMaterials],
  );
  const sel = useRowSelection(allIds);

  const resetViewControls = () => {
    setKeyword("");
    setUnitFilter("");
    setCategoryFilter("");
    setManufacturerFilter("");
    setOriginFilter("");
    setPriceStatus("all");
    setSortBy("updatedAt");
    setSortOrder("desc");
  };

  const removeMaterialsFromCurrentList = (ids: number[]) => {
    const deletedIds = new Set(ids);
    utils.material.searchMaterials.setData(materialSearchInput, (current) =>
      current?.filter((item) => !deletedIds.has(item.id)),
    );
  };

  const deleteMaterial = api.material.deleteMaterial.useMutation({
    onSuccess: (_result, variables) => {
      removeMaterialsFromCurrentList([variables.id]);
      setSingleDeleteTarget(null);
      toast.success("Đã xóa vật tư.");
      void utils.material.searchMaterials.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || "Không thể xóa vật tư.");
      setSingleDeleteTarget(null);
    },
  });

  const deleteMany = api.material.deleteMany.useMutation({
    onSuccess: (result, variables) => {
      removeMaterialsFromCurrentList(variables.ids);
      toast.success(`Đã xóa ${result.count} vật tư.`);
      sel.clear();
      setConfirmDelete(false);
      void utils.material.searchMaterials.invalidate();
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
    const manufacturerSet = new Set(
      visibleMaterials
        .map((item) => item.manufacturer)
        .filter((value): value is string => Boolean(value)),
    );
    const originSet = new Set(
      visibleMaterials
        .map((item) => item.originCountry)
        .filter((value): value is string => Boolean(value)),
    );

    return {
      total: visibleMaterials.length,
      priced,
      withSources,
      categories: categorySet.size,
      manufacturers: manufacturerSet.size,
      origins: originSet.size,
      missingPrice: visibleMaterials.length - priced,
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
        description="Vật tư đã xóa sẽ không hiển thị trong danh mục. Dữ liệu nguồn đã upload không bị ảnh hưởng."
        confirmLabel="Xóa"
        variant="danger"
        isLoading={deleteMany.isPending}
        onConfirm={() => {
          if (sel.selectedIds.length > 0) {
            deleteMany.mutate({ ids: sel.selectedIds });
          }
        }}
        onCancel={() => setConfirmDelete(false)}
      />
      <ConfirmDialog
        open={singleDeleteTarget !== null}
        title={`Xóa vật tư "${singleDeleteTarget?.name ?? ""}"?`}
        variant="danger"
        confirmLabel="Xóa"
        isLoading={deleteMaterial.isPending}
        onConfirm={() => {
          if (singleDeleteTarget) {
            deleteMaterial.mutate({ id: singleDeleteTarget.id });
          }
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
              Danh mục catalog, giá mặc định và link nguồn dùng cho nhập liệu và
              chuẩn hóa vật tư.
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

        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
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
          <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-amber-700">Thiếu giá</p>
              <WalletCards className="h-4 w-4 text-amber-600" aria-hidden />
            </div>
            <p className="mt-1 text-2xl font-bold text-amber-900">
              {showInitialLoading
                ? "-"
                : summary.missingPrice.toLocaleString("vi-VN")}
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
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-slate-500">NCC</p>
              <Badge tone="neutral">Maker</Badge>
            </div>
            <p className="mt-1 text-2xl font-bold text-slate-950">
              {showInitialLoading
                ? "-"
                : summary.manufacturers.toLocaleString("vi-VN")}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-slate-500">Xuất xứ</p>
              <Badge tone="neutral">Origin</Badge>
            </div>
            <p className="mt-1 text-2xl font-bold text-slate-950">
              {showInitialLoading
                ? "-"
                : summary.origins.toLocaleString("vi-VN")}
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

        <div
          id="material-catalog"
          className="-mx-4 mt-4 scroll-mt-6 border-t border-slate-200 bg-white px-4 pt-4"
        >
          <div className="grid gap-3 border-b border-slate-200 pb-3 lg:grid-cols-[minmax(18rem,1fr)_auto] lg:items-end">
            <div>
              <h2 className="text-sm font-bold text-slate-950">
                Danh mục vật tư
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                {showInitialLoading
                  ? "Đang tải…"
                  : `${visibleMaterials.length.toLocaleString("vi-VN")} vật tư trong kết quả hiện tại`}{" "}
                • Thông tin vật tư quan trọng, cùng cấu trúc cột với preview sau
                khi upload ở trang nhập.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600">
                <Filter className="h-3.5 w-3.5" aria-hidden />
                {activeFilterCount.toLocaleString("vi-VN")} bộ lọc
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={!hasActiveViewControls}
                leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
                onClick={resetViewControls}
              >
                Đặt lại
              </Button>
            </div>
          </div>

          <div className="mt-3 grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="grid gap-2 lg:grid-cols-[minmax(18rem,1.2fr)_repeat(2,minmax(10rem,0.6fr))]">
              <label className="grid gap-1">
                <span className="text-[11px] font-bold tracking-[0.12em] text-slate-500 uppercase">
                  Tìm kiếm
                </span>
                <span className="relative">
                  <Search
                    className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400"
                    aria-hidden
                  />
                  <input
                    className="w-full rounded-lg border border-slate-300 bg-white py-2 pr-3 pl-9 text-sm"
                    placeholder="Tên, mã, thông số, NCC, xuất xứ"
                    aria-label="Tìm sản phẩm hoặc vật tư"
                    value={keyword}
                    onChange={(event) => setKeyword(event.target.value)}
                  />
                </span>
              </label>

              <label className="grid gap-1">
                <span className="text-[11px] font-bold tracking-[0.12em] text-slate-500 uppercase">
                  Sắp xếp
                </span>
                <select
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  aria-label="Sắp xếp vật tư"
                  value={sortBy}
                  onChange={(event) =>
                    setSortBy(event.target.value as MaterialSortBy)
                  }
                >
                  {materialSortOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1">
                <span className="text-[11px] font-bold tracking-[0.12em] text-slate-500 uppercase">
                  Thứ tự
                </span>
                <select
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  aria-label="Thứ tự sắp xếp"
                  value={sortOrder}
                  onChange={(event) =>
                    setSortOrder(event.target.value as SortOrder)
                  }
                >
                  <option value="desc">Giảm dần</option>
                  <option value="asc">Tăng dần</option>
                </select>
              </label>
            </div>

            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
              <label className="grid gap-1">
                <span className="text-[11px] font-bold tracking-[0.12em] text-slate-500 uppercase">
                  ĐVT
                </span>
                <select
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  aria-label="Lọc theo ĐVT"
                  value={unitFilter}
                  onChange={(event) => setUnitFilter(event.target.value)}
                >
                  <option value="">Tất cả ĐVT</option>
                  {filterOptions?.units.map((unit) => (
                    <option key={unit} value={unit}>
                      {unit}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1">
                <span className="text-[11px] font-bold tracking-[0.12em] text-slate-500 uppercase">
                  Nhóm
                </span>
                <select
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  aria-label="Lọc theo nhóm"
                  value={categoryFilter}
                  onChange={(event) => setCategoryFilter(event.target.value)}
                >
                  <option value="">Tất cả nhóm</option>
                  {filterOptions?.categories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1">
                <span className="text-[11px] font-bold tracking-[0.12em] text-slate-500 uppercase">
                  NCC
                </span>
                <select
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  aria-label="Lọc theo NCC"
                  value={manufacturerFilter}
                  onChange={(event) =>
                    setManufacturerFilter(event.target.value)
                  }
                >
                  <option value="">Tất cả NCC</option>
                  {filterOptions?.manufacturers.map((manufacturer) => (
                    <option key={manufacturer} value={manufacturer}>
                      {manufacturer}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1">
                <span className="text-[11px] font-bold tracking-[0.12em] text-slate-500 uppercase">
                  Xuất xứ
                </span>
                <select
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  aria-label="Lọc theo xuất xứ"
                  value={originFilter}
                  onChange={(event) => setOriginFilter(event.target.value)}
                >
                  <option value="">Tất cả xuất xứ</option>
                  {filterOptions?.origins.map((origin) => (
                    <option key={origin} value={origin}>
                      {origin}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1">
                <span className="text-[11px] font-bold tracking-[0.12em] text-slate-500 uppercase">
                  Giá
                </span>
                <select
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  aria-label="Lọc theo giá"
                  value={priceStatus}
                  onChange={(event) =>
                    setPriceStatus(event.target.value as PriceStatus)
                  }
                >
                  {priceStatusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
              <span>Đang xem tối đa 80 dòng phù hợp với bộ lọc hiện tại.</span>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {[
              "Tên: Tên vật tư",
              "ĐVT: Đơn vị",
              "Thông số: Thông số kỹ thuật",
              "Chi tiết: Mã / nhóm / nguồn",
              "NCC: Nhà sản xuất",
              "Xuất xứ: Quốc gia",
              "Đơn giá: Giá catalog",
            ].map((label) => (
              <span
                key={label}
                className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700"
              >
                {label}
              </span>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <label
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold ${
                visibleMaterials.length === 0
                  ? "cursor-not-allowed border-slate-200 bg-white text-slate-400"
                  : "cursor-pointer border-sky-200 bg-white text-slate-800 hover:bg-sky-50"
              }`}
            >
              <input
                type="checkbox"
                checked={sel.allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = sel.indeterminate;
                }}
                onChange={sel.toggleAll}
                disabled={visibleMaterials.length === 0}
                className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-sky-600 disabled:cursor-not-allowed"
                aria-label="Chọn tất cả vật tư đang hiển thị"
              />
              <SquareCheckBig className="h-4 w-4" aria-hidden />
              <span>Chọn tất cả đang hiển thị</span>
              <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600 tabular-nums">
                {sel.selectedCount}/{visibleMaterials.length}
              </span>
            </label>

            <div className="flex flex-wrap items-center gap-2">
              {sel.someSelected ? (
                <button
                  type="button"
                  className="text-xs font-semibold text-slate-500 hover:text-slate-900"
                  onClick={sel.clear}
                >
                  Bỏ chọn
                </button>
              ) : null}
              <Button
                variant="danger"
                size="sm"
                disabled={!sel.someSelected}
                leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                onClick={() => setConfirmDelete(true)}
              >
                Xóa vật tư đã chọn
              </Button>
            </div>
          </div>

          <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
            <table
              aria-label="Danh mục vật tư"
              className="w-full min-w-[1280px] divide-y divide-slate-200 text-sm"
            >
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
                  <th className="px-3 py-2">Tên vật tư</th>
                  <th className="px-3 py-2">ĐVT</th>
                  <th className="px-3 py-2">Thông số</th>
                  <th className="px-3 py-2">Chi tiết</th>
                  <th className="px-3 py-2">NCC</th>
                  <th className="px-3 py-2">Xuất xứ</th>
                  <th className="px-3 py-2">Giá</th>
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
                  const details = [
                    item.code ? `Mã ${item.code}` : null,
                    item.category ? `Nhóm ${item.category}` : null,
                    sourceCount > 0
                      ? `${sourceCount.toLocaleString("vi-VN")} nguồn`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" • ");

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
                      <td className="max-w-72 px-3 py-2 font-semibold text-slate-900">
                        <Link
                          href={`/materials/${item.id}`}
                          className="line-clamp-2 hover:text-sky-700 hover:underline"
                        >
                          {item.name}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-slate-700">{item.unit}</td>
                      <td className="max-w-96 px-3 py-2 text-slate-600">
                        <span className="line-clamp-2">
                          {item.specText || "-"}
                        </span>
                      </td>
                      <td className="max-w-80 px-3 py-2 text-slate-600">
                        <span className="line-clamp-2">{details || "-"}</span>
                      </td>
                      <td className="max-w-52 px-3 py-2 text-slate-600">
                        <span className="line-clamp-2">
                          {item.manufacturer ?? "-"}
                        </span>{" "}
                      </td>
                      <td className="max-w-36 px-3 py-2 text-slate-600">
                        <span className="line-clamp-2">
                          {item.originCountry ?? "-"}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-semibold text-slate-900 tabular-nums">
                        {formatMoney(item.defaultUnitPrice, item.currency)}
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
                    <td colSpan={10} className="px-3 py-8">
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
        </div>
      </section>
    </div>
  );
}
