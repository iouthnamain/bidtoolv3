"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

type ClassifyOption = {
  id: number;
  name: string;
  depth: number;
};

type ClassifyMultiSelectProps = {
  ariaLabel?: string;
  options: ClassifyOption[];
  selected: number[];
  onChange: (next: number[]) => void;
  emptyLabel: string;
};

function summarizeSelected(options: ClassifyOption[], selected: number[]) {
  if (selected.length === 0) {
    return "";
  }

  const names = selected
    .map((id) => options.find((option) => option.id === id)?.name)
    .filter((value): value is string => Boolean(value));

  if (names.length === 0) {
    return `${selected.length} ngành nghề`;
  }

  if (names.length <= 2) {
    return names.join(", ");
  }

  return `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
}

function normalizeIds(values: number[]) {
  return Array.from(
    new Set(
      values.filter((value) => Number.isInteger(value) && value > 0),
    ),
  ).sort((a, b) => a - b);
}

export function ClassifyMultiSelect({
  ariaLabel,
  options,
  selected,
  onChange,
  emptyLabel,
}: ClassifyMultiSelectProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const selectedSummary = summarizeSelected(options, selected);

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

    return options.filter((option) =>
      option.name.toLowerCase().includes(keyword),
    );
  }, [options, query]);

  useEffect(() => {
    setActiveIndex((previous) =>
      Math.min(previous, Math.max(0, filteredOptions.length - 1)),
    );
  }, [filteredOptions.length]);

  const toggleItem = (value: number) => {
    if (selectedSet.has(value)) {
      onChange(selected.filter((item) => item !== value));
      return;
    }

    onChange(normalizeIds([...selected, value]));
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
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
        toggleItem(option.id);
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
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-700 shadow-sm transition-colors duration-150 hover:border-slate-400 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
        onClick={() => setIsOpen((previous) => !previous)}
      >
        <span className="truncate">{selectedSummary || emptyLabel}</span>
        <span className="ml-2 shrink-0 text-xs text-slate-500">
          {selected.length}
        </span>
      </button>

      {isOpen ? (
        <div className="absolute z-20 mt-2 w-full rounded-lg border border-slate-200 bg-white p-3 shadow-xl">
          <input
            ref={searchRef}
            className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 focus-visible:outline-none"
            name="classify-search"
            aria-label="Tìm ngành nghề"
            autoComplete="off"
            placeholder="Tìm ngành nghề…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onSearchKeyDown}
          />

          <div className="mt-2 flex items-center justify-between text-xs">
            <button
              type="button"
              className="rounded text-sky-700 transition-colors hover:text-sky-800 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 focus-visible:outline-none"
              onClick={() =>
                onChange(normalizeIds(options.map((item) => item.id)))
              }
            >
              Chọn tất cả
            </button>
            <button
              type="button"
              className="rounded text-slate-500 transition-colors hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 focus-visible:outline-none"
              onClick={() => onChange([])}
            >
              Bỏ chọn
            </button>
          </div>

          <div
            role="listbox"
            aria-label={ariaLabel}
            aria-multiselectable
            className="mt-2 max-h-72 space-y-1 overflow-y-auto rounded-md border border-slate-200 bg-slate-50 p-2"
          >
            {filteredOptions.length === 0 ? (
              <p className="text-xs text-slate-500">Không có mục phù hợp.</p>
            ) : (
              filteredOptions.map((item, index) => {
                const isSelected = selectedSet.has(item.id);
                const isActive = index === activeIndex;

                return (
                  <label
                    key={item.id}
                    role="option"
                    aria-selected={isSelected}
                    className={`flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 ${
                      isActive ? "bg-slate-100" : "hover:bg-slate-100"
                    }`}
                    onMouseEnter={() => setActiveIndex(index)}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={isSelected}
                      onChange={() => toggleItem(item.id)}
                    />
                    <span className="text-sm text-slate-700">
                      <span className="text-slate-400">
                        {"· ".repeat(item.depth)}
                      </span>
                      {item.name}
                    </span>
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
