"use client";

import Link from "next/link";

import { Badge, Button, EmptyState } from "~/app/_components/ui";
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

  if (
    typeof filter.budgetMin === "number" ||
    typeof filter.budgetMax === "number"
  ) {
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
      <section className="panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2">
          <h2 className="text-sm font-bold">Smart Views</h2>
          <Badge count={savedFilters.length} />
        </div>

        {savedFilters.length === 0 ? (
          <EmptyState
            className="mt-3"
            title="Chưa có bộ lọc nào"
            description="Tạo bộ lọc trong trang Tìm kiếm để lưu lại điều kiện thường dùng."
            cta={
              <Link
                href="/search"
                className="inline-flex items-center justify-center rounded-lg bg-sky-700 px-3 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-sky-800 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                Đến trang Tìm kiếm
              </Link>
            }
          />
        ) : (
          <ul className="mt-2 space-y-2">
            {savedFilters.map((filter) => {
              const criteria = renderCriteriaList(filter);
              return (
                <li
                  key={filter.id}
                  className="rounded-lg border border-slate-200 bg-slate-50/60 p-2.5 transition-colors duration-150 hover:bg-slate-100"
                >
                  <div className="mb-1.5 flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm leading-tight font-semibold [overflow-wrap:anywhere] text-slate-900">
                        {filter.name}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        📬 {filter.notificationFrequency}
                      </p>
                    </div>
                    <Button
                      variant="danger"
                      size="sm"
                      isLoading={deleteSavedFilter.isPending}
                      onClick={() => {
                        deleteSavedFilter.mutate({ id: filter.id });
                      }}
                    >
                      Xóa
                    </Button>
                  </div>

                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {criteria.slice(0, 3).map((chip) => (
                      <span
                        key={`${filter.id}-${chip}`}
                        className="inline-block rounded-full border border-slate-300 bg-white px-1.5 py-0.5 text-xs font-medium text-slate-600"
                      >
                        {chip}
                      </span>
                    ))}
                    {criteria.length > 3 ? (
                      <span className="text-xs text-slate-500">
                        +{criteria.length - 3}
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-2">
                    <Link
                      href={buildSavedFilterHref(filter)}
                      className="inline-flex items-center justify-center rounded-md bg-sky-700 px-2.5 py-1 text-xs font-semibold text-white transition-colors duration-150 hover:bg-sky-800 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
                    >
                      Áp dụng
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2">
          <h2 className="text-sm font-bold">Watchlist</h2>
          <Badge count={watchlist.length} />
        </div>

        {watchlist.length === 0 ? (
          <EmptyState
            className="mt-3"
            title="Chưa có mục theo dõi"
            description="Thêm gói thầu, bên mời thầu, hoặc đối thủ vào watchlist từ trang Tìm kiếm."
            cta={
              <Link
                href="/search"
                className="inline-flex items-center justify-center rounded-lg bg-sky-700 px-3 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-sky-800 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                Đến trang Tìm kiếm
              </Link>
            }
          />
        ) : (
          <ul className="mt-2 space-y-1">
            {watchlist.slice(0, 12).map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50/50 p-2 transition-colors duration-150 hover:bg-slate-100"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs leading-tight font-medium [overflow-wrap:anywhere] text-slate-900">
                    {item.label}
                  </p>
                  <p className="text-xs text-slate-500">⭐ {item.type}</p>
                </div>
                <Button
                  variant="danger"
                  size="sm"
                  className="px-2"
                  aria-label={`Xóa ${item.label}`}
                  isLoading={removeWatchlistItem.isPending}
                  onClick={() => {
                    removeWatchlistItem.mutate({ id: item.id });
                  }}
                >
                  ×
                </Button>
              </li>
            ))}
            {watchlist.length > 12 ? (
              <p className="py-1 text-center text-xs text-slate-500">
                +{watchlist.length - 12} mục khác
              </p>
            ) : null}
          </ul>
        )}
      </section>
    </div>
  );
}
