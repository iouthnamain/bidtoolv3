"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ChangeEventHandler } from "react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type PaginationState,
  type Row,
  type RowSelectionState,
} from "@tanstack/react-table";
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Factory,
  FileSpreadsheet,
  Filter,
  Link as LinkIcon,
  MapPin,
  PackagePlus,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  SquareCheckBig,
  Trash2,
  WalletCards,
} from "lucide-react";

import { Button, ConfirmDialog, EmptyState } from "~/app/_components/ui";
import { useToast } from "~/app/_components/ui/toast";
import { normalizeMaterialMetadata } from "~/lib/material-price-sources";
import { api, type RouterInputs, type RouterOutputs } from "~/trpc/react";

type MaterialSearchInput = RouterInputs["material"]["searchMaterials"];
type MaterialSummaryInput = RouterInputs["material"]["getMaterialSummary"];
type MaterialListItem = RouterOutputs["material"]["searchMaterials"][number];
type MaterialSortBy = NonNullable<MaterialSearchInput["sortBy"]>;
type SortOrder = NonNullable<MaterialSearchInput["sortOrder"]>;
type PriceStatus = NonNullable<MaterialSearchInput["priceStatus"]>;

type EnrichedMaterialListItem = MaterialListItem & {
  details: string;
  sourceCount: number;
};

const EMPTY_MATERIAL_ROWS: MaterialListItem[] = [];
const EMPTY_ENRICHED_MATERIAL_ROWS: EnrichedMaterialListItem[] = [];
const DEFAULT_MATERIAL_PAGE_SIZE = 50;
const MATERIAL_PAGE_SIZE_OPTIONS = [25, 50, 80, 100] as const;
const MATERIAL_SEARCH_STALE_MS = 10_000;
const MATERIAL_FILTER_OPTIONS_STALE_MS = 5 * 60_000;

const emptySummary = {
  total: 0,
  priced: 0,
  missingPrice: 0,
  withSources: 0,
  withManufacturer: 0,
  uniqueManufacturers: 0,
  withOrigin: 0,
  uniqueOrigins: 0,
};

const materialSortOptions: Array<{ value: MaterialSortBy; label: string }> = [
  { value: "name", label: "Tên vật tư" },
  { value: "updatedAt", label: "Mới cập nhật" },
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

const materialControlClass =
  "min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition-colors focus-visible:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-100 focus-visible:outline-none sm:min-h-10";

type MaterialViewSearchParams = {
  get(name: string): string | null;
};

function readSearchParam(params: MaterialViewSearchParams, name: string) {
  return params.get(name)?.trim() ?? "";
}

function isMaterialSortBy(value: string): value is MaterialSortBy {
  return materialSortOptions.some((option) => option.value === value);
}

function isSortOrder(value: string): value is SortOrder {
  return value === "asc" || value === "desc";
}

function isPriceStatus(value: string): value is PriceStatus {
  return priceStatusOptions.some((option) => option.value === value);
}

function parsePageSize(value: string) {
  const pageSize = Number(value);
  return MATERIAL_PAGE_SIZE_OPTIONS.includes(
    pageSize as (typeof MATERIAL_PAGE_SIZE_OPTIONS)[number],
  )
    ? pageSize
    : DEFAULT_MATERIAL_PAGE_SIZE;
}

function parsePageIndex(value: string) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page - 1 : 0;
}

function updateUrlParam(
  params: URLSearchParams,
  name: string,
  value: string | number,
  defaultValue: string | number = "",
) {
  const stringValue = String(value).trim();
  if (!stringValue || stringValue === String(defaultValue)) {
    params.delete(name);
    return;
  }
  params.set(name, stringValue);
}

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

function enrichMaterialRow(item: MaterialListItem): EnrichedMaterialListItem {
  const sourceCount = getSourceCount(item.metadataJson, item.sourceUrl);
  const details = [
    item.code ? `Mã ${item.code}` : null,
    item.category ? `Nhóm ${item.category}` : null,
    sourceCount > 0 ? `${sourceCount.toLocaleString("vi-VN")} nguồn` : null,
  ]
    .filter(Boolean)
    .join(" • ");

  return {
    ...item,
    details,
    sourceCount,
  };
}

function formatCoverage(value: number, total: number) {
  if (total <= 0) {
    return "0%";
  }
  return `${Math.round((value / total) * 100).toLocaleString("vi-VN")}%`;
}

function materialTableHeaderClass(columnId: string) {
  if (columnId === "select") {
    return "px-3 py-2 text-center";
  }
  if (columnId === "actions") {
    return "px-3 py-2 text-right";
  }
  return "px-3 py-2";
}

function materialTableCellClass(columnId: string) {
  const classes: Record<string, string> = {
    select: "px-3 py-2 text-center",
    name: "max-w-72 px-3 py-2 font-semibold text-slate-900",
    unit: "px-3 py-2 text-slate-700",
    specText: "max-w-96 px-3 py-2 text-slate-600",
    details: "max-w-80 px-3 py-2 text-slate-600",
    manufacturer: "max-w-52 px-3 py-2 text-slate-600",
    originCountry: "max-w-36 px-3 py-2 text-slate-600",
    defaultUnitPrice: "px-3 py-2",
    updatedAt: "px-3 py-2",
    actions: "px-3 py-2",
  };

  return classes[columnId] ?? "px-3 py-2";
}

function SelectionCheckbox({
  checked,
  indeterminate = false,
  disabled = false,
  ariaLabel,
  onChange,
}: {
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  ariaLabel: string;
  onChange: ChangeEventHandler<HTMLInputElement>;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = indeterminate && !checked;
    }
  }, [checked, indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      disabled={disabled}
      className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-sky-600 disabled:cursor-not-allowed"
      aria-label={ariaLabel}
    />
  );
}

function MaterialMobileCard({
  row,
  isDeleting,
  onDelete,
}: {
  row: Row<EnrichedMaterialListItem>;
  isDeleting: boolean;
  onDelete: (material: EnrichedMaterialListItem) => void;
}) {
  const material = row.original;

  return (
    <article
      className={`rounded-lg border p-3 shadow-sm transition-colors ${
        row.getIsSelected()
          ? "border-sky-200 bg-sky-50/80"
          : "border-slate-200 bg-white"
      }`}
    >
      <div className="flex items-start gap-3">
        <SelectionCheckbox
          checked={row.getIsSelected()}
          disabled={!row.getCanSelect()}
          ariaLabel={`Chọn ${material.name}`}
          onChange={row.getToggleSelectedHandler()}
        />
        <div className="min-w-0 flex-1">
          <Link
            href={`/materials/${material.id}`}
            className="line-clamp-2 text-sm font-bold text-slate-950 hover:text-sky-700 hover:underline"
          >
            {material.name}
          </Link>
          <p className="mt-1 line-clamp-2 text-xs text-slate-500">
            {material.details || material.specText || "Chưa có thông tin phụ"}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-600">
          {material.unit}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-md bg-slate-50 px-2 py-1.5">
          <dt className="font-semibold text-slate-500">Giá</dt>
          <dd className="mt-0.5 font-bold text-slate-950 tabular-nums">
            {formatMoney(material.defaultUnitPrice, material.currency)}
          </dd>
        </div>
        <div className="rounded-md bg-slate-50 px-2 py-1.5">
          <dt className="font-semibold text-slate-500">NCC</dt>
          <dd className="mt-0.5 truncate font-semibold text-slate-700">
            {material.manufacturer ?? "-"}
          </dd>
        </div>
        <div className="rounded-md bg-slate-50 px-2 py-1.5">
          <dt className="font-semibold text-slate-500">Xuất xứ</dt>
          <dd className="mt-0.5 truncate font-semibold text-slate-700">
            {material.originCountry ?? "-"}
          </dd>
        </div>
        <div className="rounded-md bg-slate-50 px-2 py-1.5">
          <dt className="font-semibold text-slate-500">Cập nhật</dt>
          <dd className="mt-0.5 font-semibold text-slate-700">
            {formatDate(material.updatedAt)}
          </dd>
        </div>
      </dl>

      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="truncate text-xs text-slate-500">
          {material.sourceCount > 0
            ? `${material.sourceCount.toLocaleString("vi-VN")} nguồn giá`
            : "Chưa có nguồn giá"}
        </span>
        <div className="flex shrink-0 gap-1.5">
          <Link
            href={`/materials/${material.id}`}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-sky-700 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none"
            aria-label={`Mở chi tiết ${material.name}`}
          >
            <ArrowUpRight className="h-4 w-4" aria-hidden />
          </Link>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 px-0 text-rose-700 hover:bg-rose-50"
            disabled={isDeleting}
            onClick={() => onDelete(material)}
            aria-label={`Xóa ${material.name}`}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </div>
    </article>
  );
}

export function MaterialsListClient() {
  const initialSearchParams = useSearchParams();
  const [hasMounted, setHasMounted] = useState(false);
  const didInitializeViewControlsRef = useRef(false);
  const [keyword, setKeyword] = useState(() =>
    readSearchParam(initialSearchParams, "q"),
  );
  const deferredKeyword = useDeferredValue(keyword);
  const [nameFilter, setNameFilter] = useState(() =>
    readSearchParam(initialSearchParams, "name"),
  );
  const [unitFilter, setUnitFilter] = useState(() =>
    readSearchParam(initialSearchParams, "unit"),
  );
  const [categoryFilter, setCategoryFilter] = useState(() =>
    readSearchParam(initialSearchParams, "category"),
  );
  const [manufacturerFilter, setManufacturerFilter] = useState(() =>
    readSearchParam(initialSearchParams, "manufacturer"),
  );
  const [originFilter, setOriginFilter] = useState(() =>
    readSearchParam(initialSearchParams, "origin"),
  );
  const [priceStatus, setPriceStatus] = useState<PriceStatus>(() => {
    const value = readSearchParam(initialSearchParams, "price");
    return isPriceStatus(value) ? value : "all";
  });
  const [sortBy, setSortBy] = useState<MaterialSortBy>(() => {
    const value = readSearchParam(initialSearchParams, "sort");
    return isMaterialSortBy(value) ? value : "name";
  });
  const [sortOrder, setSortOrder] = useState<SortOrder>(() => {
    const value = readSearchParam(initialSearchParams, "order");
    return isSortOrder(value) ? value : "asc";
  });
  const [pagination, setPagination] = useState<PaginationState>(() => ({
    pageIndex: parsePageIndex(readSearchParam(initialSearchParams, "page")),
    pageSize: parsePageSize(readSearchParam(initialSearchParams, "pageSize")),
  }));
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const utils = api.useUtils();
  const toast = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const materialSummaryInput = useMemo(
    (): MaterialSummaryInput => ({
      keyword: deferredKeyword.trim() || undefined,
      name: nameFilter || undefined,
      unit: unitFilter || undefined,
      category: categoryFilter || undefined,
      manufacturer: manufacturerFilter || undefined,
      originCountry: originFilter || undefined,
      priceStatus,
    }),
    [
      deferredKeyword,
      nameFilter,
      unitFilter,
      categoryFilter,
      manufacturerFilter,
      originFilter,
      priceStatus,
    ],
  );
  const materialSearchInput = useMemo(
    (): MaterialSearchInput => ({
      ...materialSummaryInput,
      sortBy,
      sortOrder,
      limit: pagination.pageSize,
      offset: pagination.pageIndex * pagination.pageSize,
    }),
    [
      materialSummaryInput,
      pagination.pageIndex,
      pagination.pageSize,
      sortBy,
      sortOrder,
    ],
  );
  const materialsQuery = api.material.searchMaterials.useQuery(
    materialSearchInput,
    {
      placeholderData: (previousData) => previousData,
      refetchOnWindowFocus: false,
      staleTime: MATERIAL_SEARCH_STALE_MS,
    },
  );
  const filterOptionsQuery = api.material.getMaterialFilterOptions.useQuery(
    undefined,
    {
      refetchOnWindowFocus: false,
      staleTime: MATERIAL_FILTER_OPTIONS_STALE_MS,
    },
  );
  const summaryQuery = api.material.getMaterialSummary.useQuery(
    materialSummaryInput,
    {
      placeholderData: (previousData) => previousData,
      refetchOnWindowFocus: false,
      staleTime: MATERIAL_SEARCH_STALE_MS,
    },
  );
  const {
    data: materialsData,
    isFetching,
    isLoading,
    error: materialsError,
  } = materialsQuery;
  const {
    data: filterOptions,
    isError: isFilterOptionsError,
    error: filterOptionsError,
  } = filterOptionsQuery;
  const {
    data: summaryData,
    isLoading: isSummaryLoading,
    isFetching: isSummaryFetching,
    error: summaryError,
  } = summaryQuery;

  useEffect(() => {
    setHasMounted(true);
  }, []);

  useEffect(() => {
    if (!hasMounted || typeof window === "undefined") {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    updateUrlParam(params, "q", keyword);
    updateUrlParam(params, "name", nameFilter);
    updateUrlParam(params, "unit", unitFilter);
    updateUrlParam(params, "category", categoryFilter);
    updateUrlParam(params, "manufacturer", manufacturerFilter);
    updateUrlParam(params, "origin", originFilter);
    updateUrlParam(params, "price", priceStatus, "all");
    updateUrlParam(params, "sort", sortBy, "name");
    updateUrlParam(params, "order", sortOrder, "asc");
    updateUrlParam(params, "page", pagination.pageIndex + 1, 1);
    updateUrlParam(
      params,
      "pageSize",
      pagination.pageSize,
      DEFAULT_MATERIAL_PAGE_SIZE,
    );

    const nextSearch = params.toString();
    const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl !== currentUrl) {
      window.history.replaceState(window.history.state, "", nextUrl);
    }
  }, [
    categoryFilter,
    hasMounted,
    keyword,
    manufacturerFilter,
    nameFilter,
    originFilter,
    pagination.pageIndex,
    pagination.pageSize,
    priceStatus,
    sortBy,
    sortOrder,
    unitFilter,
  ]);

  const materials = materialsData ?? EMPTY_MATERIAL_ROWS;
  const visibleMaterials = useMemo(
    () =>
      hasMounted && materials.length > 0
        ? materials.map(enrichMaterialRow)
        : EMPTY_ENRICHED_MATERIAL_ROWS,
    [hasMounted, materials],
  );
  const showInitialLoading =
    !hasMounted || (isLoading && visibleMaterials.length === 0);
  const summary = summaryData ?? emptySummary;
  const showSummaryLoading =
    !hasMounted || (isSummaryLoading && summaryData == null);
  const catalogError = materialsError?.message ?? summaryError?.message ?? null;
  const filterOptionsErrorMessage = filterOptionsError?.message ?? null;
  const isRefreshing =
    hasMounted &&
    (isFetching || isSummaryFetching) &&
    !showInitialLoading &&
    !showSummaryLoading;
  const isCatalogBusy = isFetching || isSummaryFetching;
  const totalPages = Math.max(
    1,
    Math.ceil(summary.total / pagination.pageSize),
  );
  const currentPage = pagination.pageIndex + 1;
  const pageStart =
    summary.total === 0 ? 0 : pagination.pageIndex * pagination.pageSize + 1;
  const pageEnd = Math.min(
    pagination.pageIndex * pagination.pageSize + visibleMaterials.length,
    summary.total,
  );
  const resultRangeLabel = `${pageStart.toLocaleString(
    "vi-VN",
  )}-${pageEnd.toLocaleString("vi-VN")}/${summary.total.toLocaleString(
    "vi-VN",
  )} vật tư`;
  const canGoToPreviousPage = pagination.pageIndex > 0;
  const canGoToNextPage =
    !showSummaryLoading && pagination.pageIndex + 1 < totalPages;
  const activeFilterCount = [
    keyword.trim(),
    nameFilter,
    unitFilter,
    categoryFilter,
    manufacturerFilter,
    originFilter,
    priceStatus !== "all" ? priceStatus : "",
  ].filter(Boolean).length;
  const hasActiveViewControls =
    activeFilterCount > 0 ||
    sortBy !== "name" ||
    sortOrder !== "asc" ||
    pagination.pageIndex > 0 ||
    pagination.pageSize !== DEFAULT_MATERIAL_PAGE_SIZE;
  const selectedIds = useMemo(
    () =>
      Object.entries(rowSelection)
        .filter(([, selected]) => selected)
        .map(([id]) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0),
    [rowSelection],
  );
  const selectedCount = selectedIds.length;
  const someSelected = selectedCount > 0;
  const clearSelection = () => setRowSelection({});
  const goToPage = (pageIndex: number) => {
    setPagination((current) => ({
      ...current,
      pageIndex: Math.min(Math.max(pageIndex, 0), totalPages - 1),
    }));
  };

  useEffect(() => {
    if (!didInitializeViewControlsRef.current) {
      didInitializeViewControlsRef.current = true;
      return;
    }

    setPagination((current) =>
      current.pageIndex === 0 ? current : { ...current, pageIndex: 0 },
    );
    setRowSelection((current) =>
      Object.keys(current).length > 0 ? {} : current,
    );
  }, [materialSummaryInput, sortBy, sortOrder]);

  useEffect(() => {
    const lastPageIndex = Math.max(0, totalPages - 1);
    setPagination((current) =>
      current.pageIndex > lastPageIndex
        ? { ...current, pageIndex: lastPageIndex }
        : current,
    );
  }, [totalPages]);

  useEffect(() => {
    setRowSelection((current) =>
      Object.keys(current).length > 0 ? {} : current,
    );
  }, [pagination.pageIndex, pagination.pageSize]);

  useEffect(() => {
    if (visibleMaterials.length === 0) {
      setRowSelection((current) =>
        Object.keys(current).length > 0 ? {} : current,
      );
      return;
    }

    const visibleIds = new Set(visibleMaterials.map((item) => String(item.id)));
    setRowSelection((current) => {
      const next: RowSelectionState = {};
      let changed = false;

      for (const [id, selected] of Object.entries(current)) {
        if (selected && visibleIds.has(id)) {
          next[id] = true;
        } else if (selected) {
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [visibleMaterials]);

  const resetViewControls = () => {
    setKeyword("");
    setNameFilter("");
    setUnitFilter("");
    setCategoryFilter("");
    setManufacturerFilter("");
    setOriginFilter("");
    setPriceStatus("all");
    setSortBy("name");
    setSortOrder("asc");
    setPagination({
      pageIndex: 0,
      pageSize: DEFAULT_MATERIAL_PAGE_SIZE,
    });
    clearSelection();
  };

  const refetchCatalog = () => {
    void Promise.all([materialsQuery.refetch(), summaryQuery.refetch()]);
  };

  const refetchFilterOptions = () => {
    void filterOptionsQuery.refetch();
  };

  const moveToPreviousPageIfCurrentPageEmptied = (deletedCount: number) => {
    setPagination((current) =>
      visibleMaterials.length <= deletedCount && current.pageIndex > 0
        ? { ...current, pageIndex: current.pageIndex - 1 }
        : current,
    );
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
      moveToPreviousPageIfCurrentPageEmptied(1);
      setSingleDeleteTarget(null);
      toast.success("Đã xóa vật tư.");
      void Promise.all([
        utils.material.searchMaterials.invalidate(),
        utils.material.getMaterialSummary.invalidate(),
        utils.material.getMaterialFilterOptions.invalidate(),
      ]);
    },
    onError: (error) => {
      toast.error(error.message || "Không thể xóa vật tư.");
      setSingleDeleteTarget(null);
    },
  });

  const deleteMany = api.material.deleteMany.useMutation({
    onSuccess: (result, variables) => {
      removeMaterialsFromCurrentList(variables.ids);
      moveToPreviousPageIfCurrentPageEmptied(variables.ids.length);
      toast.success(`Đã xóa ${result.count} vật tư.`);
      clearSelection();
      setConfirmDelete(false);
      void Promise.all([
        utils.material.searchMaterials.invalidate(),
        utils.material.getMaterialSummary.invalidate(),
        utils.material.getMaterialFilterOptions.invalidate(),
      ]);
    },
    onError: () => {
      toast.error("Không thể xóa vật tư.");
      setConfirmDelete(false);
    },
  });

  const [singleDeleteTarget, setSingleDeleteTarget] = useState<{
    id: number;
    name: string;
  } | null>(null);

  const materialColumns = useMemo<ColumnDef<EnrichedMaterialListItem>[]>(
    () => [
      {
        id: "select",
        header: ({ table }) => (
          <SelectionCheckbox
            checked={table.getIsAllPageRowsSelected()}
            indeterminate={table.getIsSomePageRowsSelected()}
            disabled={visibleMaterials.length === 0}
            ariaLabel="Chọn tất cả vật tư"
            onChange={table.getToggleAllPageRowsSelectedHandler()}
          />
        ),
        cell: ({ row }) => (
          <SelectionCheckbox
            checked={row.getIsSelected()}
            disabled={!row.getCanSelect()}
            ariaLabel={`Chọn ${row.original.name}`}
            onChange={row.getToggleSelectedHandler()}
          />
        ),
      },
      {
        accessorKey: "name",
        header: "Tên vật tư",
        cell: ({ row }) => (
          <Link
            href={`/materials/${row.original.id}`}
            className="line-clamp-2 hover:text-sky-700 hover:underline"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        accessorKey: "unit",
        header: "ĐVT",
        cell: ({ getValue }) => getValue<string>(),
      },
      {
        accessorKey: "specText",
        header: "Thông số",
        cell: ({ row }) => (
          <span className="line-clamp-2">{row.original.specText || "-"}</span>
        ),
      },
      {
        accessorKey: "details",
        header: "Chi tiết",
        cell: ({ row }) => (
          <span className="line-clamp-2">{row.original.details || "-"}</span>
        ),
      },
      {
        accessorKey: "manufacturer",
        header: "NCC",
        cell: ({ row }) => (
          <span className="line-clamp-2">
            {row.original.manufacturer ?? "-"}
          </span>
        ),
      },
      {
        accessorKey: "originCountry",
        header: "Xuất xứ",
        cell: ({ row }) => (
          <span className="line-clamp-2">
            {row.original.originCountry ?? "-"}
          </span>
        ),
      },
      {
        accessorKey: "defaultUnitPrice",
        header: "Giá",
        cell: ({ row }) => (
          <span className="font-semibold text-slate-900 tabular-nums">
            {formatMoney(row.original.defaultUnitPrice, row.original.currency)}
          </span>
        ),
      },
      {
        accessorKey: "updatedAt",
        header: "Cập nhật",
        cell: ({ row }) => (
          <span className="text-xs text-slate-500">
            {formatDate(row.original.updatedAt)}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <div className="flex justify-end gap-1.5">
            <Link
              href={`/materials/${row.original.id}`}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-sky-700"
              aria-label={`Mở chi tiết ${row.original.name}`}
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
                  id: row.original.id,
                  name: row.original.name,
                })
              }
              aria-label={`Xóa ${row.original.name}`}
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        ),
      },
    ],
    [deleteMaterial.isPending, visibleMaterials.length],
  );

  const materialTable = useReactTable({
    data: visibleMaterials,
    columns: materialColumns,
    state: {
      pagination,
      rowSelection,
    },
    getRowId: (row) => String(row.id),
    enableRowSelection: true,
    manualPagination: true,
    pageCount: totalPages,
    onPaginationChange: setPagination,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
  });
  const visibleRows = materialTable.getRowModel().rows;
  const openSingleDeleteDialog = (material: EnrichedMaterialListItem) => {
    setSingleDeleteTarget({
      id: material.id,
      name: material.name,
    });
  };

  return (
    <div className="space-y-4">
      <ConfirmDialog
        open={confirmDelete}
        title={`Xóa ${selectedCount} vật tư?`}
        description="Vật tư đã xóa sẽ không hiển thị trong danh mục. Dữ liệu nguồn đã upload không bị ảnh hưởng."
        confirmLabel="Xóa"
        variant="danger"
        isLoading={deleteMany.isPending}
        onConfirm={() => {
          if (selectedIds.length > 0) {
            deleteMany.mutate({ ids: selectedIds });
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
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-sky-700 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-800 sm:min-h-10"
            >
              <Plus className="h-4 w-4" aria-hidden />
              Thêm thủ công
            </Link>
            <Link
              href="/materials/import"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 sm:min-h-10"
            >
              <FileSpreadsheet className="h-4 w-4" aria-hidden />
              Nhập sheet
            </Link>
            <Link
              href="/materials/scrape"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 sm:min-h-10"
            >
              <Search className="h-4 w-4" aria-hidden />
              Scrape shop
            </Link>
          </div>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-3 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-slate-500">
                Items / Vật tư / Sản phẩm
              </p>
              <PackagePlus className="h-4 w-4 text-slate-400" aria-hidden />
            </div>
            <p
              className="mt-1 text-2xl font-bold text-slate-950"
              aria-label="Tổng vật tư theo bộ lọc"
            >
              {showSummaryLoading ? "-" : summary.total.toLocaleString("vi-VN")}
            </p>
            <p className="mt-1 text-[11px] font-medium text-slate-500">
              Tổng dòng catalog trong DB theo bộ lọc
            </p>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-3 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-emerald-700">
                Có giá catalog
              </p>
              <WalletCards className="h-4 w-4 text-emerald-600" aria-hidden />
            </div>
            <p
              className="mt-1 text-2xl font-bold text-emerald-900"
              aria-label="Vật tư có giá theo bộ lọc"
            >
              {showSummaryLoading
                ? "-"
                : summary.priced.toLocaleString("vi-VN")}
            </p>
            <p className="mt-1 text-[11px] font-medium text-emerald-700">
              {showSummaryLoading
                ? "-"
                : `${formatCoverage(summary.priced, summary.total)} đã có giá`}
            </p>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-3 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-amber-700">Thiếu giá</p>
              <WalletCards className="h-4 w-4 text-amber-600" aria-hidden />
            </div>
            <p
              className="mt-1 text-2xl font-bold text-amber-900"
              aria-label="Vật tư thiếu giá theo bộ lọc"
            >
              {showSummaryLoading
                ? "-"
                : summary.missingPrice.toLocaleString("vi-VN")}
            </p>
            <p className="mt-1 text-[11px] font-medium text-amber-700">
              Cần bổ sung trước khi báo giá
            </p>
          </div>
          <div className="rounded-lg border border-sky-200 bg-sky-50/70 px-3 py-3 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-sky-700">Có nguồn giá</p>
              <LinkIcon className="h-4 w-4 text-sky-600" aria-hidden />
            </div>
            <p
              className="mt-1 text-2xl font-bold text-sky-950"
              aria-label="Vật tư có nguồn giá theo bộ lọc"
            >
              {showSummaryLoading
                ? "-"
                : summary.withSources.toLocaleString("vi-VN")}
            </p>
            <p className="mt-1 text-[11px] font-medium text-sky-700">
              {showSummaryLoading
                ? "-"
                : `${formatCoverage(summary.withSources, summary.total)} có link / nguồn`}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-3 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-slate-500">Có NCC</p>
              <Factory className="h-4 w-4 text-slate-400" aria-hidden />
            </div>
            <p className="mt-1 text-2xl font-bold text-slate-950">
              {showSummaryLoading
                ? "-"
                : summary.withManufacturer.toLocaleString("vi-VN")}
            </p>
            <p className="mt-1 text-[11px] font-medium text-slate-500">
              {showSummaryLoading
                ? "-"
                : `${summary.uniqueManufacturers.toLocaleString("vi-VN")} NCC khác nhau`}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-3 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-slate-500">Có xuất xứ</p>
              <MapPin className="h-4 w-4 text-slate-400" aria-hidden />
            </div>
            <p className="mt-1 text-2xl font-bold text-slate-950">
              {showSummaryLoading
                ? "-"
                : summary.withOrigin.toLocaleString("vi-VN")}
            </p>
            <p className="mt-1 text-[11px] font-medium text-slate-500">
              {showSummaryLoading
                ? "-"
                : `${summary.uniqueOrigins.toLocaleString("vi-VN")} xuất xứ khác nhau`}
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
              <p className="mt-1 text-xs text-slate-500" aria-live="polite">
                {showInitialLoading
                  ? "Đang tải…"
                  : `${resultRangeLabel} • Trang ${currentPage.toLocaleString(
                      "vi-VN",
                    )}/${totalPages.toLocaleString(
                      "vi-VN",
                    )} theo bộ lọc hiện tại.`}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              {isRefreshing ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700">
                  Đang cập nhật
                </span>
              ) : null}
              {catalogError ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                  onClick={refetchCatalog}
                >
                  Không cập nhật được
                </button>
              ) : null}
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
            <div className="grid gap-2 lg:grid-cols-[minmax(16rem,1.1fr)_minmax(14rem,0.9fr)_repeat(2,minmax(9rem,0.55fr))]">
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
                    className={`${materialControlClass} w-full pr-3 pl-9`}
                    placeholder="Tên, mã, thông số, NCC, xuất xứ"
                    aria-label="Tìm sản phẩm hoặc vật tư"
                    value={keyword}
                    onChange={(event) => setKeyword(event.target.value)}
                  />
                </span>
              </label>

              <label className="grid gap-1">
                <span className="text-[11px] font-bold tracking-[0.12em] text-slate-500 uppercase">
                  Tên vật tư có sẵn
                </span>
                <select
                  className={materialControlClass}
                  aria-label="Lọc theo tên vật tư"
                  value={nameFilter}
                  onChange={(event) => setNameFilter(event.target.value)}
                >
                  <option value="">Tất cả tên vật tư</option>
                  {filterOptions?.names.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1">
                <span className="text-[11px] font-bold tracking-[0.12em] text-slate-500 uppercase">
                  Sắp xếp
                </span>
                <select
                  className={materialControlClass}
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
                  className={materialControlClass}
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
                  className={materialControlClass}
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
                  className={materialControlClass}
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
                  className={materialControlClass}
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
                  className={materialControlClass}
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
                  className={materialControlClass}
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
              {isFilterOptionsError ? (
                <button
                  type="button"
                  className="font-semibold text-rose-700 hover:underline"
                  onClick={refetchFilterOptions}
                >
                  Không tải được bộ lọc: {filterOptionsErrorMessage}. Thử lại
                </button>
              ) : (
                <span>
                  Tên vật tư lấy từ catalog hiện có; mặc định sắp xếp theo tên
                  A-Z.
                </span>
              )}
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
              <SelectionCheckbox
                checked={materialTable.getIsAllPageRowsSelected()}
                indeterminate={materialTable.getIsSomePageRowsSelected()}
                onChange={materialTable.getToggleAllPageRowsSelectedHandler()}
                disabled={visibleMaterials.length === 0}
                ariaLabel="Chọn tất cả vật tư đang hiển thị"
              />
              <SquareCheckBig className="h-4 w-4" aria-hidden />
              <span className="sm:hidden">Chọn trang này</span>
              <span className="hidden sm:inline">
                Chọn tất cả đang hiển thị
              </span>
              <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600 tabular-nums">
                {selectedCount}/{visibleMaterials.length}
              </span>
            </label>

            <div className="flex flex-wrap items-center gap-2">
              {someSelected ? (
                <button
                  type="button"
                  className="text-xs font-semibold text-slate-500 hover:text-slate-900"
                  onClick={clearSelection}
                >
                  Bỏ chọn
                </button>
              ) : null}
              <Button
                variant="danger"
                size="sm"
                disabled={!someSelected}
                leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                onClick={() => setConfirmDelete(true)}
              >
                Xóa vật tư đã chọn
              </Button>
            </div>
          </div>

          <div
            className="mt-3 grid gap-2 md:hidden"
            aria-label="Danh sách vật tư dạng thẻ"
          >
            {showInitialLoading ? (
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-8 text-center text-sm font-medium text-slate-500">
                Đang tải danh mục vật tư…
              </div>
            ) : null}
            {!showInitialLoading
              ? visibleRows.map((row) => (
                  <MaterialMobileCard
                    key={row.id}
                    row={row}
                    isDeleting={deleteMaterial.isPending}
                    onDelete={openSingleDeleteDialog}
                  />
                ))
              : null}
            {!showInitialLoading && catalogError && visibleRows.length === 0 ? (
              <div className="rounded-lg border border-rose-200 bg-white px-3 py-6">
                <EmptyState
                  title="Không tải được danh mục vật tư."
                  description={catalogError}
                  cta={
                    <Button variant="secondary" onClick={refetchCatalog}>
                      Thử lại
                    </Button>
                  }
                />
              </div>
            ) : null}
            {!showInitialLoading &&
            !catalogError &&
            visibleRows.length === 0 ? (
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-6">
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
              </div>
            ) : null}
          </div>

          <div
            className="relative mt-3 hidden overflow-x-auto rounded-lg border border-slate-200 md:block"
            aria-busy={isCatalogBusy}
          >
            {isRefreshing ? (
              <div className="pointer-events-none absolute top-2 right-2 z-10 rounded-full border border-sky-200 bg-white/95 px-2.5 py-1 text-xs font-semibold text-sky-700 shadow-sm">
                Đang cập nhật kết quả
              </div>
            ) : null}
            <table
              aria-label="Danh mục vật tư"
              className="w-full min-w-[1280px] divide-y divide-slate-200 text-sm"
            >
              <thead className="bg-slate-100 text-left text-xs tracking-wide text-slate-600 uppercase">
                {materialTable.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <th
                        key={header.id}
                        className={materialTableHeaderClass(header.column.id)}
                      >
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {showInitialLoading ? (
                  <tr>
                    <td
                      colSpan={materialColumns.length}
                      className="px-3 py-10 text-center text-sm font-medium text-slate-500"
                    >
                      Đang tải danh mục vật tư...
                    </td>
                  </tr>
                ) : null}
                {!showInitialLoading
                  ? visibleRows.map((row) => (
                      <tr
                        key={row.id}
                        className={`transition-colors ${
                          row.getIsSelected()
                            ? "bg-sky-50/60"
                            : "hover:bg-slate-50/80"
                        }`}
                      >
                        {row.getVisibleCells().map((cell) => (
                          <td
                            key={cell.id}
                            className={materialTableCellClass(cell.column.id)}
                          >
                            {flexRender(
                              cell.column.columnDef.cell,
                              cell.getContext(),
                            )}
                          </td>
                        ))}
                      </tr>
                    ))
                  : null}
                {!showInitialLoading &&
                catalogError &&
                visibleRows.length === 0 ? (
                  <tr>
                    <td colSpan={materialColumns.length} className="px-3 py-8">
                      <EmptyState
                        title="Không tải được danh mục vật tư."
                        description={catalogError}
                        cta={
                          <Button variant="secondary" onClick={refetchCatalog}>
                            Thử lại
                          </Button>
                        }
                      />
                    </td>
                  </tr>
                ) : null}
                {!showInitialLoading &&
                !catalogError &&
                visibleRows.length === 0 ? (
                  <tr>
                    <td colSpan={materialColumns.length} className="px-3 py-8">
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
                            <Link
                              href="/materials/scrape"
                              className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                            >
                              Scrape shop
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

          <div className="mt-3 flex flex-col gap-3 rounded-lg border border-slate-200 bg-white px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div
              className="flex flex-wrap items-center gap-2 text-xs text-slate-600"
              aria-live="polite"
            >
              <span className="font-semibold text-slate-900">
                {pageStart.toLocaleString("vi-VN")}-
                {pageEnd.toLocaleString("vi-VN")}
              </span>
              <span>/ {summary.total.toLocaleString("vi-VN")} vật tư</span>
              <span className="text-slate-300" aria-hidden>
                |
              </span>
              <label className="inline-flex items-center gap-2">
                <span>Số dòng</span>
                <select
                  className="h-10 rounded-md border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-800 shadow-sm focus-visible:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-100 focus-visible:outline-none sm:h-8"
                  aria-label="Số dòng mỗi trang"
                  value={pagination.pageSize}
                  onChange={(event) => {
                    const pageSize = Number(event.target.value);
                    setPagination({
                      pageIndex: 0,
                      pageSize,
                    });
                  }}
                >
                  {MATERIAL_PAGE_SIZE_OPTIONS.map((pageSize) => (
                    <option key={pageSize} value={pageSize}>
                      {pageSize.toLocaleString("vi-VN")}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-24 text-center text-xs font-semibold text-slate-600">
                Trang {currentPage.toLocaleString("vi-VN")} /{" "}
                {totalPages.toLocaleString("vi-VN")}
              </span>
              <button
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45 sm:h-8 sm:w-8"
                aria-label="Trang đầu"
                disabled={!canGoToPreviousPage || isFetching}
                onClick={() => goToPage(0)}
              >
                <ChevronsLeft className="h-4 w-4" aria-hidden />
              </button>
              <button
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45 sm:h-8 sm:w-8"
                aria-label="Trang trước"
                disabled={!canGoToPreviousPage || isFetching}
                onClick={() => goToPage(pagination.pageIndex - 1)}
              >
                <ChevronLeft className="h-4 w-4" aria-hidden />
              </button>
              <button
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45 sm:h-8 sm:w-8"
                aria-label="Trang sau"
                disabled={!canGoToNextPage || isFetching}
                onClick={() => goToPage(pagination.pageIndex + 1)}
              >
                <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
              <button
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45 sm:h-8 sm:w-8"
                aria-label="Trang cuối"
                disabled={!canGoToNextPage || isFetching}
                onClick={() => goToPage(totalPages - 1)}
              >
                <ChevronsRight className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
