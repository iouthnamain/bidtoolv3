"use client";

import { useEffect, useRef } from "react";
import type { ChangeEventHandler, ReactNode } from "react";
import type { VisibilityState } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

export type TableDensity = "comfortable" | "compact";
export type ViewMode = "table" | "grid";
export type SortOrder = "asc" | "desc";
export type ColumnAlign = "left" | "center" | "right";

/**
 * Read a persisted column-visibility map from localStorage, merged on top of the
 * provided defaults. Each list owns its own storage key + default visibility.
 */
export function loadColumnVisibility(
  storageKey: string,
  defaultVisibility: VisibilityState,
): VisibilityState {
  if (typeof window === "undefined") {
    return defaultVisibility;
  }

  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      return defaultVisibility;
    }
    return {
      ...defaultVisibility,
      ...(JSON.parse(raw) as VisibilityState),
    };
  } catch {
    return defaultVisibility;
  }
}

export function loadDensity(storageKey: string): TableDensity {
  if (typeof window === "undefined") {
    return "comfortable";
  }

  return localStorage.getItem(storageKey) === "compact"
    ? "compact"
    : "comfortable";
}

export function loadViewMode(storageKey: string): ViewMode {
  if (typeof window === "undefined") {
    return "table";
  }

  return localStorage.getItem(storageKey) === "grid" ? "grid" : "table";
}

function headerPad(density: TableDensity) {
  return density === "compact" ? "px-3 py-1.5" : "px-3 py-2.5";
}

function cellPad(density: TableDensity) {
  return density === "compact" ? "px-3 py-1.5 text-[13px]" : "px-3 py-2.5";
}

/**
 * Build a `<th>` class string from a width class, density, and alignment.
 * Per-list `columnWidthClass` maps stay in their owning list; pass the resolved
 * width class in.
 */
export function tableHeaderClass(
  width: string,
  density: TableDensity,
  align: ColumnAlign = "left",
) {
  const alignClass =
    align === "center" ? "text-center" : align === "right" ? "text-right" : "";
  return [headerPad(density), alignClass, width].filter(Boolean).join(" ");
}

/**
 * Build a `<td>` class string from a per-column base class (no padding — the
 * density padding is prepended here), density, and a width class.
 */
export function tableCellClass(
  baseClass: string,
  density: TableDensity,
  width: string,
) {
  return [cellPad(density), baseClass, width].filter(Boolean).join(" ");
}

export function SortableHeader<TColumn extends string>({
  label,
  columnId,
  sortBy,
  sortOrder,
  onSort,
}: {
  label: string;
  columnId: TColumn;
  sortBy: TColumn;
  sortOrder: SortOrder;
  onSort: (columnId: TColumn) => void;
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
      className={`inline-flex items-center gap-1 rounded px-1 py-0.5 text-left transition hover:bg-slate-200/70 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none ${
        isActive ? "text-slate-900" : "text-slate-600"
      }`}
      aria-label={`Sắp xếp theo ${label}`}
      aria-pressed={isActive}
      onClick={() => onSort(columnId)}
    >
      <span>{label}</span>
      <SortIcon
        className={`h-3.5 w-3.5 shrink-0 ${isActive ? "text-blue-700" : "text-slate-600"}`}
        aria-hidden
      />
    </button>
  );
}

export function QuickFilterCell({
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
      className="line-clamp-2 text-left hover:text-blue-700 hover:underline focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
      title={`Lọc theo "${normalizedValue}"`}
      aria-label={`Lọc theo ${normalizedValue}`}
      onClick={() => onFilter(normalizedValue)}
    >
      {children ?? normalizedValue}
    </button>
  );
}

export function SelectionCheckbox({
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
      className="h-4 w-4 cursor-pointer rounded border-slate-400 accent-blue-600 disabled:cursor-not-allowed"
      aria-label={ariaLabel}
    />
  );
}
