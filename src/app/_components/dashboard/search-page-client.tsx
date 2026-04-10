"use client";

import { useMemo, useState } from "react";

import { api } from "~/trpc/react";

export function SearchPageClient() {
  const [keyword, setKeyword] = useState("");
  const [province, setProvince] = useState("");
  const [category, setCategory] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  const queryInput = useMemo(
    () => ({
      keyword,
      provinces: province ? [province] : [],
      categories: category ? [category] : [],
      minMatchScore: 0,
      limit: 20,
    }),
    [keyword, province, category],
  );

  const [packages] = api.search.queryPackages.useSuspenseQuery(queryInput);
  const [savedFilters] = api.search.listSavedFilters.useSuspenseQuery();
  const [watchlist] = api.watchlist.listItems.useSuspenseQuery();

  const utils = api.useUtils();

  const saveFilter = api.search.saveFilter.useMutation({
    onSuccess: async () => {
      setSaveError(null);
      await utils.search.listSavedFilters.invalidate();
    },
    onError: (error) => {
      setSaveError(error.message || "Khong the luu bo loc.");
    },
  });

  const addWatchlist = api.watchlist.addItem.useMutation({
    onSuccess: async () => {
      await utils.watchlist.listItems.invalidate();
    },
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold">Tìm kiếm tùy chỉnh</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <input
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Từ khóa"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <input
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Địa phương"
            value={province}
            onChange={(e) => setProvince(e.target.value)}
          />
          <input
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Lĩnh vực"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white"
            onClick={() => {
              setSaveError(null);
              saveFilter.mutate({
                name: `Bộ lọc ${new Date().toLocaleTimeString("vi-VN")}`,
                keyword,
                provinces: province ? [province] : [],
                categories: category ? [category] : [],
                notificationFrequency: "daily",
              });
            }}
            disabled={saveFilter.isPending}
          >
            {saveFilter.isPending ? "Đang lưu..." : "Lưu bộ lọc"}
          </button>
        </div>

        {saveError ? (
          <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {saveError}
          </p>
        ) : null}

        <div className="mt-6 space-y-3">
          {packages.map((item) => (
            <article
              key={item.id}
              className="rounded-lg border border-slate-200 p-3 text-sm"
            >
              <p className="font-medium text-slate-900">{item.title}</p>
              <p className="mt-1 text-slate-600">
                {item.inviter} • {item.province} • {item.category}
              </p>
              <p className="mt-1 text-slate-500">
                Ngân sách: {item.budget.toLocaleString("vi-VN")} VNĐ • Match {" "}
                {item.matchScore}%
              </p>
              <button
                type="button"
                className="mt-2 rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-100"
                onClick={() => {
                  addWatchlist.mutate({
                    type: "package",
                    refKey: String(item.id),
                    label: item.title,
                  });
                }}
              >
                Theo dõi gói thầu
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="font-semibold">Smart Views đã lưu</h3>
          <ul className="mt-3 space-y-2 text-sm text-slate-700">
            {savedFilters.map((item) => (
              <li key={item.id} className="rounded-lg bg-slate-50 px-3 py-2">
                {item.name} • {item.notificationFrequency}
              </li>
            ))}
          </ul>
        </article>

        <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="font-semibold">Watchlist</h3>
          <ul className="mt-3 space-y-2 text-sm text-slate-700">
            {watchlist.map((item) => (
              <li key={item.id} className="rounded-lg bg-slate-50 px-3 py-2">
                [{item.type}] {item.label}
              </li>
            ))}
          </ul>
        </article>
      </section>
    </div>
  );
}
