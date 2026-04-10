"use client";

import Link from "next/link";

import { api } from "~/trpc/react";

function buildSavedFilterHref(filter: {
  keyword: string;
  provinces: string[];
  categories: string[];
  budgetMin: number | null;
  budgetMax: number | null;
}) {
  const params = new URLSearchParams();

  if (filter.keyword.trim()) {
    params.set("keyword", filter.keyword.trim());
  }

  for (const province of filter.provinces) {
    params.append("province", province);
  }

  for (const category of filter.categories) {
    params.append("category", category);
  }

  if (typeof filter.budgetMin === "number") {
    params.set("budgetMin", String(filter.budgetMin));
  }

  if (typeof filter.budgetMax === "number") {
    params.set("budgetMax", String(filter.budgetMax));
  }

  return `/search${params.toString() ? `?${params.toString()}` : ""}`;
}

function renderCriteriaList(filter: {
  keyword: string;
  provinces: string[];
  categories: string[];
  budgetMin: number | null;
  budgetMax: number | null;
}) {
  const chips: string[] = [];

  if (filter.keyword.trim()) {
    chips.push(`Từ khóa: ${filter.keyword}`);
  }

  if (filter.provinces.length > 0) {
    chips.push(`Tỉnh: ${filter.provinces.length} mục`);
  }

  if (filter.categories.length > 0) {
    chips.push(`Lĩnh vực: ${filter.categories.length} mục`);
  }

  if (typeof filter.budgetMin === "number" || typeof filter.budgetMax === "number") {
    chips.push(
      `Ngân sách: ${
        typeof filter.budgetMin === "number"
          ? filter.budgetMin.toLocaleString("vi-VN")
          : "0"
      } - ${
        typeof filter.budgetMax === "number"
          ? filter.budgetMax.toLocaleString("vi-VN")
          : "không giới hạn"
      }`,
    );
  }

  if (chips.length === 0) {
    chips.push("Bộ lọc chung");
  }

  return chips;
}

export function SavedItemsPageClient() {
  const [savedFilters] = api.search.listSavedFilters.useSuspenseQuery();
  const [watchlist] = api.watchlist.listItems.useSuspenseQuery();
  const utils = api.useUtils();

  const deleteSavedFilter = api.search.deleteSavedFilter.useMutation({
    onSuccess: async () => {
      await utils.search.listSavedFilters.invalidate();
    },
  });

  const removeWatchlistItem = api.watchlist.removeItem.useMutation({
    onSuccess: async () => {
      await utils.watchlist.listItems.invalidate();
    },
  });

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <section className="panel p-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2">
          <h2 className="font-bold text-sm">Smart Views</h2>
          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
            {savedFilters.length}
          </span>
        </div>

        {savedFilters.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-2.5 text-xs text-slate-600">
            Chưa có bộ lọc nào. → Tạo trong Search.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {savedFilters.map((filter) => (
              <li
                key={filter.id}
                className="rounded-lg border border-slate-200 bg-slate-50/60 p-2.5 transition-colors hover:bg-slate-100"
              >
                <div className="flex flex-wrap items-start justify-between gap-2 mb-1.5">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-sm text-slate-900 [overflow-wrap:anywhere] leading-tight">{filter.name}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      📬 {filter.notificationFrequency}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 rounded border border-rose-300 bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 transition-colors hover:bg-rose-200 disabled:opacity-50"
                    disabled={deleteSavedFilter.isPending}
                    onClick={() => {
                      deleteSavedFilter.mutate({ id: filter.id });
                    }}
                  >
                    Delete
                  </button>
                </div>

                <div className="mt-1.5 flex flex-wrap gap-1">
                  {renderCriteriaList(filter).slice(0, 3).map((chip) => (
                    <span
                      key={`${filter.id}-${chip}`}
                      className="inline-block rounded-full border border-slate-300 bg-white px-1.5 py-0.5 text-[9px] text-slate-600 font-medium"
                    >
                      {chip}
                    </span>
                  ))}
                  {renderCriteriaList(filter).length > 3 ? (
                    <span className="text-[9px] text-slate-500">+{renderCriteriaList(filter).length - 3}</span>
                  ) : null}
                </div>

                <div className="mt-2">
                  <Link
                    href={buildSavedFilterHref(filter)}
                    className="inline-flex rounded bg-sky-700 px-2 py-1 text-[10px] font-semibold text-white transition-colors hover:bg-sky-800"
                  >
                    Áp dụng
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel p-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2">
          <h2 className="font-bold text-sm">Watchlist</h2>
          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
            {watchlist.length}
          </span>
        </div>

        {watchlist.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-2.5 text-xs text-slate-600">
            Chưa có mục theo dõi. → Thêm từ trang Search.
          </p>
        ) : (
          <ul className="mt-2 space-y-1">
            {watchlist.slice(0, 12).map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50/50 hover:bg-slate-100 p-2 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-slate-900 [overflow-wrap:anywhere] leading-tight">{item.label}</p>
                  <p className="text-[10px] text-slate-500">⭐ {item.type}</p>
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded border border-rose-300 bg-rose-100 hover:bg-rose-200 px-1 py-0.5 text-[9px] font-semibold text-rose-700 disabled:opacity-50 transition-colors"
                  disabled={removeWatchlistItem.isPending}
                  onClick={() => {
                    removeWatchlistItem.mutate({ id: item.id });
                  }}
                >
                  ×
                </button>
              </li>
            ))}
            {watchlist.length > 12 ? (
              <p className="text-[10px] text-slate-500 text-center py-1">+{watchlist.length - 12} more</p>
            ) : null}
          </ul>
        )}
      </section>
    </div>
  );
}
