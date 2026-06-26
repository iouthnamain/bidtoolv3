"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

import { FloatingPanel } from "~/app/_components/ui/floating-panel";

type SearchableSelectProps = {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  emptyOptionLabel: string;
  placeholder?: string;
  ariaLabel: string;
  className?: string;
  truncated?: boolean;
};

export function SearchableSelect({
  value,
  onChange,
  options,
  emptyOptionLabel,
  placeholder = "Gõ để lọc…",
  ariaLabel,
  className = "",
  truncated = false,
}: SearchableSelectProps) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("vi");
    if (!normalizedQuery) {
      return options;
    }
    return options.filter((option) =>
      option.toLocaleLowerCase("vi").includes(normalizedQuery),
    );
  }, [options, query]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !panelRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  useEffect(() => {
    if (!open || window.matchMedia("(pointer: coarse)").matches) {
      return;
    }

    searchInputRef.current?.focus();
  }, [open]);

  const displayValue = value || emptyOptionLabel;

  const selectOption = (nextValue: string) => {
    onChange(nextValue);
    setQuery("");
    setOpen(false);
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] px-3 py-2 text-left text-sm text-slate-900 shadow-sm transition-colors focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-100 focus-visible:outline-none"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={value ? "truncate" : "truncate text-slate-700"}>
          {displayValue}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-slate-600 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      <FloatingPanel anchorRef={rootRef} contentRef={panelRef} open={open}>
        <div
          id={listId}
          className="flex h-full max-h-[inherit] flex-col overflow-hidden rounded border border-slate-500 bg-white shadow-[var(--shadow-overlay)]"
        >
          <div className="shrink-0 border-b border-slate-400 p-2">
            <input
              ref={searchInputRef}
              type="search"
              className="min-h-10 w-full rounded border border-slate-400 px-2.5 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100 focus:outline-none"
              placeholder={placeholder}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label={`${ariaLabel} — tìm kiếm`}
            />
          </div>
          <ul
            className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain py-1 text-sm"
            role="listbox"
            aria-label={ariaLabel}
          >
            <li role="option" aria-selected={!value}>
              <button
                type="button"
                className={`flex min-h-10 w-full items-center px-3 py-2 text-left hover:bg-slate-100 ${!value ? "bg-blue-50 font-semibold text-blue-800" : "text-slate-700"}`}
                onClick={() => selectOption("")}
              >
                {emptyOptionLabel}
              </button>
            </li>
            {filteredOptions.length === 0 ? (
              <li role="option" aria-selected={false} className="px-3 py-2 text-xs text-slate-700">
                Không có lựa chọn phù hợp.
              </li>
            ) : (
              filteredOptions.map((option) => (
                <li key={option} role="option" aria-selected={value === option}>
                  <button
                    type="button"
                    className={`flex min-h-10 w-full items-center px-3 py-2 text-left hover:bg-slate-100 ${value === option ? "bg-blue-50 font-semibold text-blue-800" : "text-slate-800"}`}
                    onClick={() => selectOption(option)}
                  >
                    {option}
                  </button>
                </li>
              ))
            )}
          </ul>
          {truncated ? (
            <p className="shrink-0 border-t border-slate-400 px-3 py-2 text-xs text-amber-700">
              Hiển thị tối đa 200 giá trị — dùng ô tìm kiếm chính nếu không
              thấy.
            </p>
          ) : null}
        </div>
      </FloatingPanel>
    </div>
  );
}
