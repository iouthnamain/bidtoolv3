"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { normalizeStringList } from "~/lib/search-criteria";

import { summarizeSelected } from "./search-format";

type MultiSelectDropdownProps = {
  id?: string;
  ariaLabel?: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  emptyLabel: string;
};

export function MultiSelectDropdown({
  id,
  ariaLabel,
  options,
  selected,
  onChange,
  emptyLabel,
}: MultiSelectDropdownProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      searchRef.current?.focus();
      setActiveIndex(0);
    }
  }, [isOpen]);

  const filteredOptions = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return options;
    }

    return options.filter((item) => item.toLowerCase().includes(keyword));
  }, [options, query]);

  useEffect(() => {
    setActiveIndex((previous) =>
      Math.min(previous, Math.max(0, filteredOptions.length - 1)),
    );
  }, [filteredOptions.length]);

  const toggleItem = (value: string) => {
    if (selectedSet.has(value)) {
      onChange(selected.filter((item) => item !== value));
      return;
    }

    onChange(normalizeStringList([...selected, value]));
  };

  const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((previous) =>
        Math.min(previous + 1, filteredOptions.length - 1),
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((previous) => Math.max(previous - 1, 0));
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const option = filteredOptions[activeIndex];
      if (option) {
        toggleItem(option);
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setIsOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        id={id}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between rounded border border-slate-400 bg-white px-3 py-2 text-left text-sm text-slate-700 shadow-sm transition-colors duration-0 hover:border-slate-400 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:outline-none"
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <span className="truncate">
          {summarizeSelected(selected, emptyLabel)}
        </span>
        <span className="ml-2 shrink-0 text-xs text-slate-700">
          {selected.length}
        </span>
      </button>

      {isOpen ? (
        <div className="absolute z-20 mt-2 w-full rounded border border-slate-400 bg-white p-3 shadow-xl">
          <input
            ref={searchRef}
            className="w-full rounded border border-slate-400 px-2.5 py-1.5 text-sm focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 focus-visible:outline-none"
            name="multiselect-search"
            aria-label="Tìm trong danh sách"
            autoComplete="off"
            placeholder="Tìm nhanh…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onSearchKeyDown}
          />

          <div className="mt-2 flex items-center justify-between text-xs">
            <button
              type="button"
              className="rounded text-blue-700 transition-colors hover:text-blue-800 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 focus-visible:outline-none"
              onClick={() => onChange(options)}
            >
              Chọn tất cả
            </button>
            <button
              type="button"
              className="rounded text-slate-700 transition-colors hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 focus-visible:outline-none"
              onClick={() => onChange([])}
            >
              Bỏ chọn
            </button>
          </div>

          <div
            role="listbox"
            aria-label={ariaLabel}
            aria-multiselectable
            className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded border border-slate-400 bg-slate-50 p-2"
          >
            {filteredOptions.length === 0 ? (
              <p className="text-xs text-slate-700">Không có mục phù hợp.</p>
            ) : (
              filteredOptions.map((item, index) => {
                const isSelected = selectedSet.has(item);
                const isActive = index === activeIndex;

                return (
                  <label
                    key={item}
                    role="option"
                    aria-selected={isSelected}
                    className={`flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 ${
                      isActive ? "bg-slate-100" : "hover:bg-slate-100"
                    }`}
                    onMouseEnter={() => setActiveIndex(index)}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleItem(item)}
                    />
                    <span className="text-sm text-slate-700">{item}</span>
                  </label>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
