"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type {
  ChangeEventHandler,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from "react";
import { useDeferredValue, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type PaginationState,
  type Row,
  type RowSelectionState,
  type VisibilityState,
} from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ArrowUpRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Columns3,
  Copy,
  Download,
  Factory,
  FileSpreadsheet,
  FileText,
  Filter,
  Link as LinkIcon,
  MapPin,
  PackagePlus,
  Plus,
  RotateCcw,
  Rows2,
  Rows3,
  Search,
  SlidersHorizontal,
  SquareCheckBig,
  Sparkles,
  SquarePen,
  Trash2,
  WalletCards,
  X,
} from "lucide-react";

import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  SearchableSelect,
} from "~/app/_components/ui";
import { Skeleton, SkeletonCard } from "~/app/_components/ui/skeleton";
import { useToast } from "~/app/_components/ui/toast";
import {
  formatCoverage,
  formatDate,
  formatMoney,
  parseOptionalNumber,
} from "~/lib/materials/format";
import { normalizeMaterialMetadata } from "~/lib/material-price-sources";
import { api, type RouterInputs, type RouterOutputs } from "~/trpc/react";

type MaterialSearchInput = RouterInputs["material"]["searchMaterials"];
type MaterialSummaryInput = RouterInputs["material"]["getMaterialSummary"];
type MaterialListItem = RouterOutputs["material"]["searchMaterials"][number];
type MaterialSortBy = NonNullable<MaterialSearchInput["sortBy"]>;
type SortOrder = NonNullable<MaterialSearchInput["sortOrder"]>;
type PriceStatus = NonNullable<MaterialSearchInput["priceStatus"]>;
type SourceStatus = NonNullable<MaterialSearchInput["sourceStatus"]>;
type CatalogStatus = NonNullable<MaterialSearchInput["catalogStatus"]>;

type EnrichedMaterialListItem = MaterialListItem & {
  details: string;
  sourceCount: number;
};

const EMPTY_MATERIAL_ROWS: MaterialListItem[] = [];
const EMPTY_ENRICHED_MATERIAL_ROWS: EnrichedMaterialListItem[] = [];
const DEFAULT_MATERIAL_PAGE_SIZE = 50;
const MATERIAL_VIEW_ALL_PAGE_SIZE = 10_000;
const MATERIAL_PAGE_SIZE_OPTIONS = [
  25, 50, 80, 100, MATERIAL_VIEW_ALL_PAGE_SIZE,
] as const;
const MATERIAL_SEARCH_STALE_MS = 10_000;
const MATERIAL_FILTER_OPTIONS_STALE_MS = 5 * 60_000;
const MATERIAL_COLUMN_VISIBILITY_KEY = "bidtool:material-catalog-columns:v1";
const MATERIAL_DENSITY_KEY = "bidtool:material-catalog-density:v1";

type TableDensity = "comfortable" | "compact";

const defaultColumnVisibility: VisibilityState = {
  updatedAt: false,
};

const materialColumnOptions: Array<{ id: string; label: string }> = [
  { id: "code", label: "Mã VT" },
  { id: "specText", label: "Thông số & Chi tiết" },
  { id: "catalog", label: "Catalog PDF" },
  { id: "updatedAt", label: "Cập nhật" },
];

const emptySummary = {
  total: 0,
  priced: 0,
  missingPrice: 0,
  withSources: 0,
  withManufacturer: 0,
  uniqueManufacturers: 0,
  withOrigin: 0,
  uniqueOrigins: 0,
  withCatalog: 0,
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

const sourceStatusOptions: Array<{ value: SourceStatus; label: string }> = [
  { value: "all", label: "Tất cả nguồn" },
  { value: "with", label: "Có nguồn giá" },
  { value: "without", label: "Chưa có nguồn" },
];

const catalogStatusOptions: Array<{ value: CatalogStatus; label: string }> = [
  { value: "all", label: "Tất cả catalog" },
  { value: "with", label: "Có catalog PDF" },
  { value: "without", label: "Chưa có catalog" },
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

function isSourceStatus(value: string): value is SourceStatus {
  return sourceStatusOptions.some((option) => option.value === value);
}

function isCatalogStatus(value: string): value is CatalogStatus {
  return catalogStatusOptions.some((option) => option.value === value);
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

function loadColumnVisibility(): VisibilityState {
  if (typeof window === "undefined") {
    return defaultColumnVisibility;
  }

  try {
    const raw = localStorage.getItem(MATERIAL_COLUMN_VISIBILITY_KEY);
    if (!raw) {
      return defaultColumnVisibility;
    }
    return {
      ...defaultColumnVisibility,
      ...(JSON.parse(raw) as VisibilityState),
    };
  } catch {
    return defaultColumnVisibility;
  }
}

function loadDensity(): TableDensity {
  if (typeof window === "undefined") {
    return "comfortable";
  }

  return localStorage.getItem(MATERIAL_DENSITY_KEY) === "compact"
    ? "compact"
    : "comfortable";
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
    item.catalogDocumentCount > 0
      ? `${item.catalogDocumentCount.toLocaleString("vi-VN")} catalog PDF`
      : null,
  ]
    .filter(Boolean)
    .join(" • ");

  return {
    ...item,
    details,
    sourceCount,
  };
}

const materialColumnWidthClass: Record<string, string> = {
  select: "w-12",
  stt: "w-12",
  name: "w-[20%]",
  code: "w-28",
  unit: "w-20",
  specText: "w-[28%]",
  catalog: "w-24",
  manufacturer: "w-[12%]",
  originCountry: "w-32",
  defaultUnitPrice: "w-32",
  updatedAt: "w-28",
  actions: "w-28",
};

function materialTableHeaderClass(columnId: string, density: TableDensity) {
  const width = materialColumnWidthClass[columnId] ?? "";
  const pad = density === "compact" ? "px-3 py-1.5" : "px-3 py-2.5";
  if (columnId === "select") {
    return `${pad} text-center ${width}`;
  }
  if (columnId === "stt") {
    return `${pad} text-center ${width}`;
  }
  if (columnId === "actions") {
    return `${pad} text-right ${width}`;
  }
  return `${pad} ${width}`;
}

function materialTableCellClass(columnId: string, density: TableDensity) {
  const pad = density === "compact" ? "px-3 py-1.5 text-[13px]" : "px-3 py-2.5";
  const classes: Record<string, string> = {
    select: `${pad} text-center align-top`,
    stt: `${pad} text-center align-top text-slate-500 tabular-nums`,
    name: `${pad} align-top font-semibold text-slate-900`,
    code: `${pad} align-top font-mono text-xs text-slate-700 truncate`,
    unit: `${pad} align-top text-slate-700`,
    specText: `${pad} align-top text-slate-600`,
    catalog: `${pad} align-top`,
    manufacturer: `${pad} align-top text-slate-600`,
    originCountry: `${pad} align-top text-slate-600`,
    defaultUnitPrice: `${pad} align-top text-right`,
    updatedAt: `${pad} align-top`,
    actions: `${pad} align-top`,
  };

  const width = materialColumnWidthClass[columnId] ?? "";
  return `${classes[columnId] ?? `${pad} align-top`} ${width}`.trim();
}

function MaterialSortableHeader({
  label,
  columnId,
  sortBy,
  sortOrder,
  onSort,
}: {
  label: string;
  columnId: MaterialSortBy;
  sortBy: MaterialSortBy;
  sortOrder: SortOrder;
  onSort: (columnId: MaterialSortBy) => void;
}) {
  const isActive = sortBy === columnId;
  const SortIcon = isActive
    ? sortOrder === "asc"
      ? ArrowUp
      : ArrowDown
    : ArrowUpDown;

  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-left transition hover:bg-slate-200/70 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none ${
        isActive ? "text-slate-900" : "text-slate-600"
      }`}
      aria-label={`Sắp xếp theo ${label}`}
      aria-pressed={isActive}
      onClick={() => onSort(columnId)}
    >
      <span>{label}</span>
      <SortIcon
        className={`h-3.5 w-3.5 shrink-0 ${isActive ? "text-sky-700" : "text-slate-400"}`}
        aria-hidden
      />
    </button>
  );
}

function QuickFilterCell({
  value,
  onFilter,
  children,
}: {
  value: string | null | undefined;
  onFilter: (value: string) => void;
  children?: ReactNode;
}) {
  const normalizedValue = value?.trim();
  if (!normalizedValue) {
    return <span>-</span>;
  }

  return (
    <button
      type="button"
      className="line-clamp-2 text-left hover:text-sky-700 hover:underline focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none"
      title={`Lọc theo "${normalizedValue}"`}
      aria-label={`Lọc theo ${normalizedValue}`}
      onClick={() => onFilter(normalizedValue)}
    >
      {children ?? normalizedValue}
    </button>
  );
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
  rowNumber,
  isDeleting,
  onDelete,
}: {
  row: Row<EnrichedMaterialListItem>;
  rowNumber: number;
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
          <span className="text-[11px] font-semibold text-slate-400 tabular-nums">
            STT {rowNumber.toLocaleString("vi-VN")}
          </span>
          <Link
            href={`/materials/${material.id}`}
            className="line-clamp-2 text-sm font-bold text-slate-950 hover:text-sky-700 hover:underline"
          >
            {material.name}
          </Link>
          {material.code ? (
            <span className="mt-0.5 block font-mono text-[11px] text-slate-400">
              Mã VT: {material.code}
            </span>
          ) : null}
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
          <dt className="font-semibold text-slate-500">Đơn giá</dt>
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
          {material.catalogDocumentCount > 0
            ? `${material.catalogDocumentCount.toLocaleString("vi-VN")} catalog PDF`
            : material.sourceCount > 0
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
  const router = useRouter();
  const initialSearchParams = useSearchParams();
  const [hasMounted, setHasMounted] = useState(false);
  const didInitializeViewControlsRef = useRef(false);
  const columnPickerRef = useRef<HTMLDivElement>(null);
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
  const [sourceStatus, setSourceStatus] = useState<SourceStatus>(() => {
    const value = readSearchParam(initialSearchParams, "sources");
    return isSourceStatus(value) ? value : "all";
  });
  const [catalogStatus, setCatalogStatus] = useState<CatalogStatus>(() => {
    const value = readSearchParam(initialSearchParams, "catalog");
    return isCatalogStatus(value) ? value : "all";
  });
  const [sortBy, setSortBy] = useState<MaterialSortBy>(() => {
    const value = readSearchParam(initialSearchParams, "sort");
    return isMaterialSortBy(value) ? value : "updatedAt";
  });
  const [sortOrder, setSortOrder] = useState<SortOrder>(() => {
    const value = readSearchParam(initialSearchParams, "order");
    return isSortOrder(value) ? value : "desc";
  });
  const [pagination, setPagination] = useState<PaginationState>(() => ({
    pageIndex: parsePageIndex(readSearchParam(initialSearchParams, "page")),
    pageSize: parsePageSize(readSearchParam(initialSearchParams, "pageSize")),
  }));
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
    defaultColumnVisibility,
  );
  const [density, setDensity] = useState<TableDensity>("comfortable");
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [pageJumpValue, setPageJumpValue] = useState("1");
  const utils = api.useUtils();
  const toast = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [attachPdfOpen, setAttachPdfOpen] = useState(false);
  const [attachPdfKeyword, setAttachPdfKeyword] = useState("");
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkManufacturer, setBulkManufacturer] = useState("");
  const [bulkOrigin, setBulkOrigin] = useState("");
  const [bulkPrice, setBulkPrice] = useState("");
  const [bulkPriceMode, setBulkPriceMode] = useState<"skip" | "set" | "clear">(
    "skip",
  );
  const materialSummaryInput = useMemo(
    (): MaterialSummaryInput => ({
      keyword: deferredKeyword.trim() || undefined,
      name: nameFilter || undefined,
      unit: unitFilter || undefined,
      category: categoryFilter || undefined,
      manufacturer: manufacturerFilter || undefined,
      originCountry: originFilter || undefined,
      priceStatus,
      sourceStatus,
      catalogStatus,
    }),
    [
      deferredKeyword,
      nameFilter,
      unitFilter,
      categoryFilter,
      manufacturerFilter,
      originFilter,
      priceStatus,
      sourceStatus,
      catalogStatus,
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
  const exportCsvInput = useMemo(
    () => ({
      ...materialSummaryInput,
      sortBy,
      sortOrder,
    }),
    [materialSummaryInput, sortBy, sortOrder],
  );
  const exportCsvQuery = api.material.exportMaterialsCsv.useQuery(
    exportCsvInput,
    { enabled: false },
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
    setColumnVisibility(loadColumnVisibility());
    setDensity(loadDensity());
  }, []);

  useEffect(() => {
    if (!hasMounted || typeof window === "undefined") {
      return;
    }

    localStorage.setItem(
      MATERIAL_COLUMN_VISIBILITY_KEY,
      JSON.stringify(columnVisibility),
    );
  }, [columnVisibility, hasMounted]);

  useEffect(() => {
    if (!hasMounted || typeof window === "undefined") {
      return;
    }

    localStorage.setItem(MATERIAL_DENSITY_KEY, density);
  }, [density, hasMounted]);

  useEffect(() => {
    if (!showColumnPicker) {
      return;
    }

    const handlePointerDown = (event: globalThis.MouseEvent) => {
      if (!columnPickerRef.current?.contains(event.target as Node)) {
        setShowColumnPicker(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [showColumnPicker]);

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
    updateUrlParam(params, "sources", sourceStatus, "all");
    updateUrlParam(params, "catalog", catalogStatus, "all");
    updateUrlParam(params, "sort", sortBy, "updatedAt");
    updateUrlParam(params, "order", sortOrder, "desc");
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
    sourceStatus,
    catalogStatus,
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

  useEffect(() => {
    setPageJumpValue(String(currentPage));
  }, [currentPage]);

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
    sourceStatus !== "all" ? sourceStatus : "",
    catalogStatus !== "all" ? catalogStatus : "",
  ].filter(Boolean).length;
  const activeFilterChips = useMemo(() => {
    const chips: Array<{
      key: string;
      label: string;
      value: string;
      onClear: () => void;
    }> = [];
    const pushText = (
      key: string,
      label: string,
      value: string,
      onClear: () => void,
    ) => {
      const trimmed = value.trim();
      if (trimmed) {
        chips.push({ key, label, value: trimmed, onClear });
      }
    };

    pushText("q", "Tìm kiếm", keyword, () => setKeyword(""));
    pushText("name", "Tên", nameFilter, () => setNameFilter(""));
    pushText("unit", "ĐVT", unitFilter, () => setUnitFilter(""));
    pushText("category", "Nhóm", categoryFilter, () => setCategoryFilter(""));
    pushText("manufacturer", "NCC", manufacturerFilter, () =>
      setManufacturerFilter(""),
    );
    pushText("origin", "Xuất xứ", originFilter, () => setOriginFilter(""));

    if (priceStatus !== "all") {
      chips.push({
        key: "price",
        label: "Giá",
        value:
          priceStatusOptions.find((option) => option.value === priceStatus)
            ?.label ?? priceStatus,
        onClear: () => setPriceStatus("all"),
      });
    }
    if (sourceStatus !== "all") {
      chips.push({
        key: "sources",
        label: "Nguồn",
        value:
          sourceStatusOptions.find((option) => option.value === sourceStatus)
            ?.label ?? sourceStatus,
        onClear: () => setSourceStatus("all"),
      });
    }
    if (catalogStatus !== "all") {
      chips.push({
        key: "catalog",
        label: "Catalog",
        value:
          catalogStatusOptions.find((option) => option.value === catalogStatus)
            ?.label ?? catalogStatus,
        onClear: () => setCatalogStatus("all"),
      });
    }

    return chips;
  }, [
    keyword,
    nameFilter,
    unitFilter,
    categoryFilter,
    manufacturerFilter,
    originFilter,
    priceStatus,
    sourceStatus,
    catalogStatus,
  ]);
  const hasActiveViewControls =
    activeFilterCount > 0 ||
    sortBy !== "updatedAt" ||
    sortOrder !== "desc" ||
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

  const submitPageJump = () => {
    const page = Number.parseInt(pageJumpValue, 10);
    if (!Number.isInteger(page)) {
      setPageJumpValue(String(currentPage));
      return;
    }
    goToPage(page - 1);
  };

  const toggleColumnSort = useCallback((column: MaterialSortBy) => {
    if (sortBy === column) {
      setSortOrder((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortBy(column);
    setSortOrder(column === "name" || column === "unit" ? "asc" : "desc");
  }, [sortBy]);

  const openMaterialDetail = (materialId: number) => {
    router.push(`/materials/${materialId}`);
  };

  const handleMaterialRowClick = (
    event: ReactMouseEvent<HTMLTableRowElement>,
    materialId: number,
  ) => {
    const target = event.target as HTMLElement;
    if (target.closest("a, button, input, label, [role='button']")) {
      return;
    }
    openMaterialDetail(materialId);
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
    setSourceStatus("all");
    setCatalogStatus("all");
    setSortBy("updatedAt");
    setSortOrder("desc");
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

  const scrollToCatalog = () => {
    document
      .getElementById("material-catalog")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const downloadCatalogCsv = async () => {
    const result = await exportCsvQuery.refetch();
    const payload = result.data;
    if (!payload) {
      toast.error(
        result.error?.message ?? "Không thể xuất danh mục vật tư.",
      );
      return;
    }
    const blob = new Blob([`\uFEFF${payload.csv}`], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `vat-tu-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    if (payload.truncated) {
      toast.warning(
        `Đã xuất ${payload.count.toLocaleString("vi-VN")} dòng (giới hạn tối đa).`,
      );
      return;
    }
    toast.success(
      `Đã xuất ${payload.count.toLocaleString("vi-VN")} vật tư ra CSV.`,
    );
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

  const attachPdfDocuments = api.catalogDocument.list.useQuery(
    { keyword: attachPdfKeyword.trim() || undefined, limit: 10 },
    { enabled: attachPdfOpen },
  );

  const attachPdfToMaterials = api.catalogDocument.attachToMaterials.useMutation({
    onSuccess: (result) => {
      toast.success(
        `Đã gắn tài liệu vào ${result.linked.toLocaleString("vi-VN")} vật tư.`,
      );
      setAttachPdfOpen(false);
      setAttachPdfKeyword("");
      clearSelection();
      void utils.catalogDocument.list.invalidate();
      void utils.catalogDocument.listByMaterial.invalidate();
      void utils.material.searchMaterials.invalidate();
      void utils.material.getMaterialSummary.invalidate();
    },
    onError: (error) => toast.error(error.message),
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

  const duplicateMaterial = api.material.duplicateMaterial.useMutation({
    onSuccess: (material) => {
      toast.success(`Đã nhân bản thành "${material.name}".`);
      void Promise.all([
        utils.material.searchMaterials.invalidate(),
        utils.material.getMaterialSummary.invalidate(),
        utils.material.getMaterialFilterOptions.invalidate(),
      ]);
      router.push(`/materials/${material.id}`);
    },
    onError: (error) => {
      toast.error(error.message || "Không thể nhân bản vật tư.");
    },
  });

  const bulkUpdateMaterials = api.material.bulkUpdateMaterials.useMutation({
    onSuccess: (result) => {
      toast.success(`Đã cập nhật ${result.count} vật tư.`);
      setBulkEditOpen(false);
      setBulkCategory("");
      setBulkManufacturer("");
      setBulkOrigin("");
      setBulkPrice("");
      setBulkPriceMode("skip");
      clearSelection();
      void Promise.all([
        utils.material.searchMaterials.invalidate(),
        utils.material.getMaterialSummary.invalidate(),
        utils.material.getMaterialFilterOptions.invalidate(),
      ]);
    },
    onError: (error) => {
      toast.error(error.message || "Không thể cập nhật hàng loạt.");
    },
  });

  const duplicatingMaterialId = duplicateMaterial.isPending
    ? duplicateMaterial.variables?.id
    : null;

  const duplicateMaterialRow = useCallback((materialId: number) => {
    duplicateMaterial.mutate({ id: materialId });
  }, [duplicateMaterial]);

  const [singleDeleteTarget, setSingleDeleteTarget] = useState<{
    id: number;
    name: string;
  } | null>(null);

  const materialColumns = useMemo<ColumnDef<EnrichedMaterialListItem>[]>(
    () => [
      {
        id: "select",
        enableHiding: false,
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
        id: "stt",
        enableHiding: false,
        header: () => <span className="text-slate-500">STT</span>,
        cell: ({ row }) => (
          <span>
            {(
              pagination.pageIndex * pagination.pageSize +
              row.index +
              1
            ).toLocaleString("vi-VN")}
          </span>
        ),
      },
      {
        accessorKey: "name",
        header: () => (
          <MaterialSortableHeader
            label="Tên vật tư"
            columnId="name"
            sortBy={sortBy}
            sortOrder={sortOrder}
            onSort={toggleColumnSort}
          />
        ),
        cell: ({ row }) => (
          <div className="space-y-0.5">
            <Link
              href={`/materials/${row.original.id}`}
              className="line-clamp-2 hover:text-sky-700 hover:underline"
            >
              {row.original.name}
            </Link>
            {row.original.code ? (
              <span className="block font-mono text-[11px] font-normal text-slate-400">
                Mã VT: {row.original.code}
              </span>
            ) : null}
          </div>
        ),
      },
      {
        accessorKey: "code",
        header: "Mã VT",
        cell: ({ row }) => (
          <span className="font-mono text-xs text-slate-700">
            {row.original.code ?? "-"}
          </span>
        ),
      },
      {
        accessorKey: "unit",
        header: () => (
          <MaterialSortableHeader
            label="ĐVT"
            columnId="unit"
            sortBy={sortBy}
            sortOrder={sortOrder}
            onSort={toggleColumnSort}
          />
        ),
        cell: ({ row }) => (
          <QuickFilterCell
            value={row.original.unit}
            onFilter={setUnitFilter}
          >
            {row.original.unit}
          </QuickFilterCell>
        ),
      },
      {
        accessorKey: "specText",
        header: "Thông số & Chi tiết",
        cell: ({ row }) => (
          <div className="space-y-0.5">
            <span className="line-clamp-2 text-slate-700">
              {row.original.specText || "-"}
            </span>
            {row.original.details ? (
              <span className="line-clamp-2 text-xs text-slate-400">
                {row.original.details}
              </span>
            ) : null}
          </div>
        ),
      },
      {
        id: "catalog",
        accessorKey: "catalogDocumentCount",
        header: "Catalog",
        cell: ({ row }) =>
          row.original.catalogDocumentCount > 0 ? (
            <Badge tone="info" count={row.original.catalogDocumentCount}>
              PDF
            </Badge>
          ) : (
            <span className="text-xs text-slate-400">-</span>
          ),
      },
      {
        accessorKey: "manufacturer",
        header: () => (
          <MaterialSortableHeader
            label="NCC"
            columnId="manufacturer"
            sortBy={sortBy}
            sortOrder={sortOrder}
            onSort={toggleColumnSort}
          />
        ),
        cell: ({ row }) => (
          <QuickFilterCell
            value={row.original.manufacturer}
            onFilter={setManufacturerFilter}
          />
        ),
      },
      {
        accessorKey: "originCountry",
        header: () => (
          <MaterialSortableHeader
            label="Xuất xứ"
            columnId="originCountry"
            sortBy={sortBy}
            sortOrder={sortOrder}
            onSort={toggleColumnSort}
          />
        ),
        cell: ({ row }) => (
          <QuickFilterCell
            value={row.original.originCountry}
            onFilter={setOriginFilter}
          />
        ),
      },
      {
        accessorKey: "defaultUnitPrice",
        header: () => (
          <MaterialSortableHeader
            label="Đơn giá"
            columnId="defaultUnitPrice"
            sortBy={sortBy}
            sortOrder={sortOrder}
            onSort={toggleColumnSort}
          />
        ),
        cell: ({ row }) => (
          <span className="font-semibold text-slate-900 tabular-nums">
            {formatMoney(row.original.defaultUnitPrice, row.original.currency)}
          </span>
        ),
      },
      {
        accessorKey: "updatedAt",
        header: () => (
          <MaterialSortableHeader
            label="Cập nhật"
            columnId="updatedAt"
            sortBy={sortBy}
            sortOrder={sortOrder}
            onSort={toggleColumnSort}
          />
        ),
        cell: ({ row }) => (
          <span className="text-xs text-slate-500">
            {formatDate(row.original.updatedAt)}
          </span>
        ),
      },
      {
        id: "actions",
        enableHiding: false,
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
              className="h-8 w-8 px-0 text-slate-600 hover:bg-slate-100 hover:text-sky-800"
              disabled={duplicateMaterial.isPending}
              isLoading={duplicatingMaterialId === row.original.id}
              onClick={() => duplicateMaterialRow(row.original.id)}
              aria-label={`Nhân bản ${row.original.name}`}
            >
              <Copy className="h-4 w-4" aria-hidden />
            </Button>
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
    [
      deleteMaterial.isPending,
      duplicateMaterial.isPending,
      duplicateMaterialRow,
      duplicatingMaterialId,
      pagination.pageIndex,
      pagination.pageSize,
      sortBy,
      sortOrder,
      toggleColumnSort,
      visibleMaterials.length,
    ],
  );

  const materialTable = useReactTable({
    data: visibleMaterials,
    columns: materialColumns,
    state: {
      pagination,
      rowSelection,
      columnVisibility,
    },
    getRowId: (row) => String(row.id),
    enableRowSelection: true,
    enableHiding: true,
    manualPagination: true,
    pageCount: totalPages,
    onPaginationChange: setPagination,
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
  });
  const visibleColumnCount = materialTable.getVisibleLeafColumns().length;
  const visibleRows = materialTable.getRowModel().rows;
  const openSingleDeleteDialog = (material: EnrichedMaterialListItem) => {
    setSingleDeleteTarget({
      id: material.id,
      name: material.name,
    });
  };

  const submitBulkUpdate = () => {
    if (selectedIds.length === 0) {
      return;
    }

    const patch: {
      category?: string;
      manufacturer?: string;
      originCountry?: string;
      defaultUnitPrice?: number | null;
    } = {};

    if (bulkCategory.trim()) {
      patch.category = bulkCategory.trim();
    }
    if (bulkManufacturer.trim()) {
      patch.manufacturer = bulkManufacturer.trim();
    }
    if (bulkOrigin.trim()) {
      patch.originCountry = bulkOrigin.trim();
    }
    if (bulkPriceMode === "set") {
      const price = parseOptionalNumber(bulkPrice);
      if (price == null) {
        toast.error("Nhập đơn giá hợp lệ hoặc chọn không đổi giá.");
        return;
      }
      patch.defaultUnitPrice = price;
    } else if (bulkPriceMode === "clear") {
      patch.defaultUnitPrice = null;
    }

    if (Object.keys(patch).length === 0) {
      toast.warning("Chọn ít nhất một trường để cập nhật.");
      return;
    }

    bulkUpdateMaterials.mutate({ ids: selectedIds, patch });
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

      <section className="panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-950">
              Quản lý sản phẩm / vật tư
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Danh mục catalog, đơn giá và link nguồn dùng cho nhập liệu và
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
            <Button
              variant="secondary"
              size="sm"
              className="min-h-11 sm:min-h-10"
              leftIcon={<Download className="h-3.5 w-3.5" />}
              isLoading={exportCsvQuery.isFetching}
              disabled={summary.total === 0}
              onClick={() => void downloadCatalogCsv()}
            >
              Xuất CSV
            </Button>
            <Link
              href="/materials/scrape"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 sm:min-h-10"
            >
              <Search className="h-4 w-4" aria-hidden />
              Scrape shop
            </Link>
          </div>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          <button
            type="button"
            className="rounded-lg border border-slate-200 bg-white px-3 py-3 text-left shadow-sm transition hover:ring-2 hover:ring-sky-200 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none"
            onClick={scrollToCatalog}
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-slate-500">Tổng vật tư</p>
              <PackagePlus className="h-4 w-4 text-slate-400" aria-hidden />
            </div>
            <p className="mt-1 text-2xl font-bold text-slate-950" aria-label="Tổng vật tư theo bộ lọc">
              {showSummaryLoading ? "-" : summary.total.toLocaleString("vi-VN")}
            </p>
            <p className="mt-1 text-[11px] font-medium text-slate-500">
              Bấm để xem danh mục
            </p>
          </button>
          <button
            type="button"
            className={`rounded-lg border px-3 py-3 text-left shadow-sm transition hover:ring-2 hover:ring-emerald-200 focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:outline-none ${priceStatus === "priced" ? "border-emerald-400 ring-2 ring-emerald-300" : "border-emerald-200 bg-emerald-50/70"}`}
            onClick={() =>
              setPriceStatus((current) =>
                current === "priced" ? "all" : "priced",
              )
            }
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-emerald-700">
                Có giá
              </p>
              <WalletCards className="h-4 w-4 text-emerald-600" aria-hidden />
            </div>
            <p className="mt-1 text-2xl font-bold text-emerald-900" aria-label="Vật tư có giá theo bộ lọc">
              {showSummaryLoading
                ? "-"
                : summary.priced.toLocaleString("vi-VN")}
            </p>
            <p className="mt-1 text-[11px] font-medium text-emerald-700">
              {showSummaryLoading
                ? "-"
                : `${formatCoverage(summary.priced, summary.total)} — lọc có giá`}
            </p>
          </button>
          <button
            type="button"
            className={`rounded-lg border px-3 py-3 text-left shadow-sm transition hover:ring-2 hover:ring-amber-200 focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:outline-none ${priceStatus === "missing" ? "border-amber-400 ring-2 ring-amber-300" : "border-amber-200 bg-amber-50/70"}`}
            onClick={() =>
              setPriceStatus((current) =>
                current === "missing" ? "all" : "missing",
              )
            }
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-amber-700">Thiếu giá</p>
              <WalletCards className="h-4 w-4 text-amber-600" aria-hidden />
            </div>
            <p className="mt-1 text-2xl font-bold text-amber-900" aria-label="Vật tư thiếu giá theo bộ lọc">
              {showSummaryLoading
                ? "-"
                : summary.missingPrice.toLocaleString("vi-VN")}
            </p>
            <p className="mt-1 text-[11px] font-medium text-amber-700">
              Bấm để lọc thiếu giá
            </p>
          </button>
          <button
            type="button"
            className={`rounded-lg border px-3 py-3 text-left shadow-sm transition hover:ring-2 hover:ring-sky-200 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none ${sourceStatus === "with" ? "border-sky-400 ring-2 ring-sky-300" : "border-sky-200 bg-sky-50/70"}`}
            onClick={() =>
              setSourceStatus((current) => (current === "with" ? "all" : "with"))
            }
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-sky-700">Có nguồn giá</p>
              <LinkIcon className="h-4 w-4 text-sky-600" aria-hidden />
            </div>
            <p className="mt-1 text-2xl font-bold text-sky-950">
              {showSummaryLoading
                ? "-"
                : summary.withSources.toLocaleString("vi-VN")}
            </p>
            <p className="mt-1 text-[11px] font-medium text-sky-700">
              {showSummaryLoading
                ? "-"
                : `${formatCoverage(summary.withSources, summary.total)} — lọc có nguồn`}
            </p>
          </button>
          <button
            type="button"
            className={`rounded-lg border px-3 py-3 text-left shadow-sm transition hover:ring-2 hover:ring-violet-200 focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:outline-none ${catalogStatus === "with" ? "border-violet-400 ring-2 ring-violet-300" : "border-violet-200 bg-violet-50/70"}`}
            onClick={() =>
              setCatalogStatus((current) =>
                current === "with" ? "all" : "with",
              )
            }
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-violet-700">
                Có catalog PDF
              </p>
              <FileText className="h-4 w-4 text-violet-600" aria-hidden />
            </div>
            <p className="mt-1 text-2xl font-bold text-violet-950">
              {showSummaryLoading
                ? "-"
                : summary.withCatalog.toLocaleString("vi-VN")}
            </p>
            <p className="mt-1 text-[11px] font-medium text-violet-700">
              {showSummaryLoading
                ? "-"
                : `${formatCoverage(summary.withCatalog, summary.total)} — lọc có catalog`}
            </p>
          </button>
          <button
            type="button"
            className="rounded-lg border border-slate-200 bg-white px-3 py-3 text-left shadow-sm transition hover:ring-2 hover:ring-slate-200 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none"
            onClick={scrollToCatalog}
          >
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
          </button>
          <button
            type="button"
            className="rounded-lg border border-slate-200 bg-white px-3 py-3 text-left shadow-sm transition hover:ring-2 hover:ring-slate-200 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none"
            onClick={scrollToCatalog}
          >
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
          </button>
        </div>
      </section>

      <section id="material-catalog" className="panel scroll-mt-6 p-4">
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
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
                onClick={() => setIsFiltersOpen((open) => !open)}
                aria-expanded={isFiltersOpen}
                aria-controls="material-catalog-filters-content"
              >
                <Filter className="h-3.5 w-3.5" aria-hidden />
                {activeFilterCount.toLocaleString("vi-VN")} bộ lọc
              </button>
              <Button
                variant="ghost"
                size="sm"
                disabled={!hasActiveViewControls}
                leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
                onClick={resetViewControls}
              >
                Đặt lại
              </Button>
              <Button
                variant="secondary"
                size="sm"
                leftIcon={
                  density === "compact" ? (
                    <Rows3 className="h-3.5 w-3.5" />
                  ) : (
                    <Rows2 className="h-3.5 w-3.5" />
                  )
                }
                aria-pressed={density === "compact"}
                onClick={() =>
                  setDensity((current) =>
                    current === "compact" ? "comfortable" : "compact",
                  )
                }
                title={
                  density === "compact"
                    ? "Đang ở chế độ gọn — bấm để giãn dòng"
                    : "Đang ở chế độ thoáng — bấm để thu gọn dòng"
                }
              >
                {density === "compact" ? "Gọn" : "Thoáng"}
              </Button>
              <div ref={columnPickerRef} className="relative">
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<Columns3 className="h-3.5 w-3.5" />}
                  aria-expanded={showColumnPicker}
                  aria-controls="material-column-picker"
                  onClick={() => setShowColumnPicker((current) => !current)}
                >
                  Cột hiển thị
                </Button>
                {showColumnPicker ? (
                  <div
                    id="material-column-picker"
                    className="absolute top-full right-0 z-20 mt-2 w-56 rounded-lg border border-slate-200 bg-white p-3 shadow-lg"
                  >
                    <p className="text-[11px] font-bold tracking-[0.12em] text-slate-500 uppercase">
                      Cột tùy chọn
                    </p>
                    <div className="mt-2 grid gap-2">
                      {materialColumnOptions.map((column) => {
                        const tableColumn = materialTable.getColumn(column.id);
                        if (!tableColumn?.getCanHide()) {
                          return null;
                        }

                        return (
                          <label
                            key={column.id}
                            className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700"
                          >
                            <input
                              type="checkbox"
                              checked={tableColumn.getIsVisible()}
                              onChange={tableColumn.getToggleVisibilityHandler()}
                              className="h-4 w-4 rounded border-slate-300 accent-sky-600"
                            />
                            {column.label}
                          </label>
                        );
                      })}
                    </div>
                    <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
                      Bấm tiêu đề cột để sắp xếp. Bấm ĐVT/NCC/Xuất xứ để lọc
                      nhanh.
                    </p>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {activeFilterChips.length > 0 ? (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-bold tracking-[0.12em] text-slate-400 uppercase">
                Đang lọc
              </span>
              {activeFilterChips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 py-0.5 pr-1.5 pl-2.5 text-xs font-semibold text-sky-800 transition-colors hover:border-sky-300 hover:bg-sky-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none"
                  onClick={chip.onClear}
                  aria-label={`Bỏ lọc ${chip.label}: ${chip.value}`}
                  title={`Bỏ lọc ${chip.label}`}
                >
                  <span className="text-sky-500">{chip.label}:</span>
                  <span className="max-w-40 truncate">{chip.value}</span>
                  <X className="h-3.5 w-3.5 shrink-0" aria-hidden />
                </button>
              ))}
              <button
                type="button"
                className="ml-1 text-xs font-semibold text-slate-500 hover:text-slate-900 hover:underline"
                onClick={resetViewControls}
              >
                Xóa tất cả
              </button>
            </div>
          ) : null}

          <div
            id="material-catalog-filters"
            className="mt-3 overflow-hidden rounded-lg border border-slate-200"
          >
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 bg-slate-50 px-3 py-2.5 text-left transition-colors hover:bg-slate-100/80 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
              onClick={() => setIsFiltersOpen((open) => !open)}
              aria-expanded={isFiltersOpen}
              aria-controls="material-catalog-filters-content"
            >
              <span className="flex min-w-0 items-center gap-2">
                <SlidersHorizontal
                  className="h-4 w-4 shrink-0 text-slate-500"
                  aria-hidden
                />
                <span className="text-sm font-bold text-slate-950">
                  Bộ lọc & sắp xếp
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                  {activeFilterCount.toLocaleString("vi-VN")} đang áp dụng
                </span>
                <ChevronDown
                  className={`h-4 w-4 text-slate-500 transition-transform duration-200 ${
                    isFiltersOpen ? "rotate-180" : ""
                  }`}
                  aria-hidden
                />
              </span>
            </button>

            {isFiltersOpen ? (
              <div
                id="material-catalog-filters-content"
                className="grid gap-3 border-t border-slate-200 bg-slate-50 p-3"
              >
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
                  Tên chính xác
                </span>
                <SearchableSelect
                  value={nameFilter}
                  onChange={setNameFilter}
                  options={filterOptions?.names ?? []}
                  emptyOptionLabel="Tất cả tên vật tư"
                  ariaLabel="Lọc theo tên vật tư"
                  truncated={filterOptions?.truncated.names}
                />
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

            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-6">
              <label className="grid gap-1">
                <span className="text-[11px] font-bold tracking-[0.12em] text-slate-500 uppercase">
                  ĐVT
                </span>
                <SearchableSelect
                  value={unitFilter}
                  onChange={setUnitFilter}
                  options={filterOptions?.units ?? []}
                  emptyOptionLabel="Tất cả ĐVT"
                  ariaLabel="Lọc theo ĐVT"
                  truncated={filterOptions?.truncated.units}
                />
              </label>

              <label className="grid gap-1">
                <span className="text-[11px] font-bold tracking-[0.12em] text-slate-500 uppercase">
                  Nhóm
                </span>
                <SearchableSelect
                  value={categoryFilter}
                  onChange={setCategoryFilter}
                  options={filterOptions?.categories ?? []}
                  emptyOptionLabel="Tất cả nhóm"
                  ariaLabel="Lọc theo nhóm"
                  truncated={filterOptions?.truncated.categories}
                />
              </label>

              <label className="grid gap-1">
                <span className="text-[11px] font-bold tracking-[0.12em] text-slate-500 uppercase">
                  NCC
                </span>
                <SearchableSelect
                  value={manufacturerFilter}
                  onChange={setManufacturerFilter}
                  options={filterOptions?.manufacturers ?? []}
                  emptyOptionLabel="Tất cả NCC"
                  ariaLabel="Lọc theo NCC"
                  truncated={filterOptions?.truncated.manufacturers}
                />
              </label>

              <label className="grid gap-1">
                <span className="text-[11px] font-bold tracking-[0.12em] text-slate-500 uppercase">
                  Xuất xứ
                </span>
                <SearchableSelect
                  value={originFilter}
                  onChange={setOriginFilter}
                  options={filterOptions?.origins ?? []}
                  emptyOptionLabel="Tất cả xuất xứ"
                  ariaLabel="Lọc theo xuất xứ"
                  truncated={filterOptions?.truncated.origins}
                />
              </label>

              <label className="grid gap-1">
                <span className="text-[11px] font-bold tracking-[0.12em] text-slate-500 uppercase">
                  Đơn giá
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

              <label className="grid gap-1">
                <span className="text-[11px] font-bold tracking-[0.12em] text-slate-500 uppercase">
                  Nguồn giá
                </span>
                <select
                  className={materialControlClass}
                  aria-label="Lọc theo nguồn giá"
                  value={sourceStatus}
                  onChange={(event) =>
                    setSourceStatus(event.target.value as SourceStatus)
                  }
                >
                  {sourceStatusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1">
                <span className="text-[11px] font-bold tracking-[0.12em] text-slate-500 uppercase">
                  Catalog PDF
                </span>
                <select
                  className={materialControlClass}
                  aria-label="Lọc theo catalog PDF"
                  value={catalogStatus}
                  onChange={(event) =>
                    setCatalogStatus(event.target.value as CatalogStatus)
                  }
                >
                  {catalogStatusOptions.map((option) => (
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
                  Mặc định sắp xếp theo mới cập nhật. Bấm tiêu đề cột để đổi thứ
                  tự. Dropdown có thể giới hạn 200 giá trị — dùng ô tìm kiếm
                  chính nếu không thấy.
                </span>
              )}
            </div>
              </div>
            ) : null}
          </div>

          <div
            className={`sticky top-2 z-20 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 transition-colors ${
              someSelected
                ? "border-sky-300 bg-sky-50/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-sky-50/80"
                : "border-slate-200 bg-slate-50"
            }`}
          >
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
                <>
                  <span className="rounded-full border border-sky-300 bg-white px-2.5 py-0.5 text-xs font-bold text-sky-800 tabular-nums">
                    {selectedCount.toLocaleString("vi-VN")} đã chọn
                  </span>
                  <button
                    type="button"
                    className="text-xs font-semibold text-slate-500 hover:text-slate-900"
                    onClick={clearSelection}
                  >
                    Bỏ chọn
                  </button>
                </>
              ) : null}
              <Button
                variant="secondary"
                size="sm"
                disabled={!someSelected}
                leftIcon={<SquarePen className="h-3.5 w-3.5" />}
                onClick={() => setBulkEditOpen((current) => !current)}
              >
                Sửa hàng loạt
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={!someSelected}
                leftIcon={<Sparkles className="h-3.5 w-3.5" />}
                onClick={() =>
                  router.push(
                    `/materials/enrich?ids=${selectedIds.join(",")}`,
                  )
                }
              >
                Làm giàu
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={!someSelected}
                leftIcon={<FileText className="h-3.5 w-3.5" />}
                onClick={() => setAttachPdfOpen((current) => !current)}
              >
                Gắn catalog PDF
              </Button>
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

          {bulkEditOpen && someSelected ? (
            <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50/60 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900">
                  Sửa {selectedCount.toLocaleString("vi-VN")} vật tư đã chọn
                </p>
                <button
                  type="button"
                  className="text-xs font-semibold text-slate-500 hover:text-slate-900"
                  onClick={() => setBulkEditOpen(false)}
                >
                  Đóng
                </button>
              </div>
              <p className="mt-1 text-xs text-slate-600">
                Chỉ các trường có giá trị mới được cập nhật. Để trống nếu không
                muốn thay đổi nhóm/NCC/xuất xứ.
              </p>
              <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                <label className="grid gap-1">
                  <span className="text-[11px] font-bold tracking-[0.12em] text-slate-500 uppercase">
                    Nhóm mới
                  </span>
                  <input
                    className={materialControlClass}
                    aria-label="Nhóm mới cho vật tư đã chọn"
                    placeholder="Giữ nguyên nếu để trống"
                    value={bulkCategory}
                    onChange={(event) => setBulkCategory(event.target.value)}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-[11px] font-bold tracking-[0.12em] text-slate-500 uppercase">
                    NCC mới
                  </span>
                  <input
                    className={materialControlClass}
                    aria-label="NCC mới cho vật tư đã chọn"
                    placeholder="Giữ nguyên nếu để trống"
                    value={bulkManufacturer}
                    onChange={(event) =>
                      setBulkManufacturer(event.target.value)
                    }
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-[11px] font-bold tracking-[0.12em] text-slate-500 uppercase">
                    Xuất xứ mới
                  </span>
                  <input
                    className={materialControlClass}
                    aria-label="Xuất xứ mới cho vật tư đã chọn"
                    placeholder="Giữ nguyên nếu để trống"
                    value={bulkOrigin}
                    onChange={(event) => setBulkOrigin(event.target.value)}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-[11px] font-bold tracking-[0.12em] text-slate-500 uppercase">
                    Đơn giá
                  </span>
                  <select
                    className={materialControlClass}
                    aria-label="Cách cập nhật đơn giá hàng loạt"
                    value={bulkPriceMode}
                    onChange={(event) =>
                      setBulkPriceMode(
                        event.target.value as "skip" | "set" | "clear",
                      )
                    }
                  >
                    <option value="skip">Giữ nguyên giá</option>
                    <option value="set">Đặt giá mới</option>
                    <option value="clear">Xóa giá</option>
                  </select>
                </label>
              </div>
              {bulkPriceMode === "set" ? (
                <label className="mt-2 grid max-w-xs gap-1">
                  <span className="text-[11px] font-bold tracking-[0.12em] text-slate-500 uppercase">
                    Giá mới
                  </span>
                  <input
                    className={materialControlClass}
                    type="number"
                    min={0}
                    inputMode="decimal"
                    aria-label="Giá mới cho vật tư đã chọn"
                    value={bulkPrice}
                    onChange={(event) => setBulkPrice(event.target.value)}
                  />
                </label>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  isLoading={bulkUpdateMaterials.isPending}
                  onClick={submitBulkUpdate}
                >
                  Áp dụng cho {selectedCount.toLocaleString("vi-VN")} vật tư
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setBulkCategory("");
                    setBulkManufacturer("");
                    setBulkOrigin("");
                    setBulkPrice("");
                    setBulkPriceMode("skip");
                  }}
                >
                  Xóa form
                </Button>
              </div>
            </div>
          ) : null}

          {attachPdfOpen && someSelected ? (
            <div className="mt-3 rounded-lg border border-violet-200 bg-violet-50/50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900">
                  Gắn catalog PDF cho {selectedCount.toLocaleString("vi-VN")}{" "}
                  vật tư đã chọn
                </p>
                <button
                  type="button"
                  className="text-xs font-semibold text-slate-500 hover:text-slate-900"
                  onClick={() => setAttachPdfOpen(false)}
                >
                  Đóng
                </button>
              </div>
              <p className="mt-1 text-xs text-slate-600">
                Chọn tài liệu có sẵn trong thư viện. Tạo tài liệu mới tại trang{" "}
                <Link
                  href="/catalog-pdfs"
                  className="font-semibold text-violet-700 hover:text-violet-900"
                >
                  Catalog PDFs
                </Link>
                .
              </p>
              <input
                type="search"
                className={`${materialControlClass} mt-2 w-full max-w-md`}
                placeholder="Tìm tài liệu theo tên, NCC hoặc URL..."
                aria-label="Tìm tài liệu catalog PDF"
                value={attachPdfKeyword}
                onChange={(event) => setAttachPdfKeyword(event.target.value)}
              />
              <ul className="mt-2 grid gap-1.5 md:grid-cols-2">
                {attachPdfDocuments.isLoading ? (
                  <li className="px-2 py-1 text-xs text-slate-500">
                    Đang tải tài liệu...
                  </li>
                ) : (attachPdfDocuments.data ?? []).length === 0 ? (
                  <li className="px-2 py-1 text-xs text-slate-500">
                    Không có tài liệu trong thư viện.
                  </li>
                ) : (
                  (attachPdfDocuments.data ?? []).map((document) => (
                    <li key={document.id}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-800 transition-colors hover:border-violet-300 hover:bg-violet-50"
                        onClick={() =>
                          attachPdfToMaterials.mutate({
                            documentId: document.id,
                            materialIds: selectedIds,
                          })
                        }
                        disabled={attachPdfToMaterials.isPending}
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
            </div>
          ) : null}

          <div
            className="mt-3 grid gap-2 md:hidden"
            aria-label="Danh sách vật tư dạng thẻ"
          >
            {showInitialLoading ? (
              <div className="grid gap-2" aria-hidden>
                {Array.from({ length: 4 }).map((_, index) => (
                  <SkeletonCard key={index} />
                ))}
              </div>
            ) : null}
            {!showInitialLoading
              ? visibleRows.map((row) => (
                  <MaterialMobileCard
                    key={row.id}
                    row={row}
                    rowNumber={
                      pagination.pageIndex * pagination.pageSize +
                      row.index +
                      1
                    }
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
            className="relative mt-3 hidden overflow-hidden rounded-lg border border-slate-200 md:block"
            aria-busy={isCatalogBusy}
          >
            {isRefreshing ? (
              <div className="pointer-events-none absolute top-2 right-2 z-10 rounded-full border border-sky-200 bg-white/95 px-2.5 py-1 text-xs font-semibold text-sky-700 shadow-sm">
                Đang cập nhật kết quả
              </div>
            ) : null}
            <table
              aria-label="Danh mục vật tư"
              className="w-full table-fixed divide-y divide-slate-200 text-sm break-words"
            >
              <thead className="sticky top-0 z-10 bg-slate-100 text-left text-xs tracking-wide text-slate-600 uppercase shadow-[0_1px_0_0_rgb(226,232,240)]">
                {materialTable.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <th
                        key={header.id}
                        className={materialTableHeaderClass(header.column.id, density)}
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
                {showInitialLoading
                  ? Array.from({ length: 8 }).map((_, rowIndex) => (
                      <tr key={`skeleton-${rowIndex}`} aria-hidden>
                        {Array.from({ length: visibleColumnCount }).map(
                          (__, cellIndex) => (
                            <td
                              key={cellIndex}
                              className={
                                density === "compact"
                                  ? "px-3 py-1.5"
                                  : "px-3 py-2.5"
                              }
                            >
                              <Skeleton
                                className={`h-3.5 ${cellIndex === 1 ? "w-3/4" : "w-1/2"}`}
                              />
                            </td>
                          ),
                        )}
                      </tr>
                    ))
                  : null}
                {!showInitialLoading
                  ? visibleRows.map((row) => (
                      <tr
                        key={row.id}
                        className={`cursor-pointer transition-colors ${
                          row.getIsSelected()
                            ? "bg-sky-50/60"
                            : "hover:bg-slate-50/80"
                        }`}
                        onClick={(event) =>
                          handleMaterialRowClick(event, row.original.id)
                        }
                      >
                        {row.getVisibleCells().map((cell) => (
                          <td
                            key={cell.id}
                            className={materialTableCellClass(cell.column.id, density)}
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
                    <td colSpan={visibleColumnCount} className="px-3 py-8">
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
                    <td colSpan={visibleColumnCount} className="px-3 py-8">
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
                      {pageSize === MATERIAL_VIEW_ALL_PAGE_SIZE
                        ? "Tất cả"
                        : pageSize.toLocaleString("vi-VN")}
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
              <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
                <span className="sr-only">Nhảy tới trang</span>
                <input
                  type="number"
                  min={1}
                  max={totalPages}
                  value={pageJumpValue}
                  aria-label="Nhảy tới trang"
                  className="h-10 w-14 rounded-md border border-slate-300 bg-white px-2 text-center text-xs font-semibold text-slate-800 shadow-sm focus-visible:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-100 focus-visible:outline-none sm:h-8"
                  onChange={(event) => setPageJumpValue(event.target.value)}
                  onBlur={submitPageJump}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      submitPageJump();
                    }
                  }}
                />
              </label>
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
      </section>
    </div>
  );
}
