"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { normalizeSearchSelections } from "~/lib/search-filter-utils";
import { Badge, Button, EmptyState } from "~/app/_components/ui";
import { type RouterOutputs, api } from "~/trpc/react";

type SavedFilterItem = RouterOutputs["search"]["listSavedFilters"][number];
type SavedFilterNotificationFrequency = SavedFilterItem["notificationFrequency"];

const notificationFrequencyLabels: Record<
  SavedFilterNotificationFrequency,
  string
> = {
  daily: "Hằng ngày",
  weekly: "Hằng tuần",
};

const dateTimeFormatter = new Intl.DateTimeFormat("vi-VN", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatDateTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Thời điểm không hợp lệ";
  }

  return dateTimeFormatter.format(parsed);
}

function buildSavedFilterHref(
  filter: {
    keyword: string;
    provinces: string[];
    categories: string[];
    budgetMin: number | null;
    budgetMax: number | null;
    minMatchScore: number;
  },
  options?: {
    savedFilterId?: number;
  },
) {
  const normalizedFilter = normalizeSearchSelections(filter);
  const params = new URLSearchParams();

  if (normalizedFilter.keyword.trim()) {
    params.set("keyword", normalizedFilter.keyword.trim());
  }

  for (const province of normalizedFilter.provinces) {
    params.append("province", province);
  }

  for (const category of normalizedFilter.categories) {
    params.append("category", category);
  }

  if (typeof normalizedFilter.budgetMin === "number") {
    params.set("budgetMin", String(normalizedFilter.budgetMin));
  }

  if (typeof normalizedFilter.budgetMax === "number") {
    params.set("budgetMax", String(normalizedFilter.budgetMax));
  }

  if (normalizedFilter.minMatchScore > 0) {
    params.set("minMatchScore", String(normalizedFilter.minMatchScore));
  }

  if (options?.savedFilterId) {
    params.set("savedFilterId", String(options.savedFilterId));
  }

  return `/search${params.toString() ? `?${params.toString()}` : ""}`;
}

function renderCriteriaList(filter: {
  keyword: string;
  provinces: string[];
  categories: string[];
  budgetMin: number | null;
  budgetMax: number | null;
  minMatchScore: number;
}) {
  const normalizedFilter = normalizeSearchSelections(filter);
  const chips: string[] = [];

  if (normalizedFilter.keyword.trim()) {
    chips.push(`Từ khóa: ${normalizedFilter.keyword}`);
  }

  if (normalizedFilter.provinces.length > 0) {
    chips.push(`Tỉnh: ${normalizedFilter.provinces.length} mục`);
  }

  if (normalizedFilter.categories.length > 0) {
    chips.push(`Lĩnh vực: ${normalizedFilter.categories.length} mục`);
  }

  if (
    typeof normalizedFilter.budgetMin === "number" ||
    typeof normalizedFilter.budgetMax === "number"
  ) {
    chips.push(
      `Ngân sách: ${
        typeof normalizedFilter.budgetMin === "number"
          ? normalizedFilter.budgetMin.toLocaleString("vi-VN")
          : "0"
      } - ${
        typeof normalizedFilter.budgetMax === "number"
          ? normalizedFilter.budgetMax.toLocaleString("vi-VN")
          : "không giới hạn"
      }`,
    );
  }

  if (normalizedFilter.minMatchScore > 0) {
    chips.push(`Match tối thiểu: ${normalizedFilter.minMatchScore}%`);
  }

  if (chips.length === 0) {
    chips.push("Bộ lọc chung");
  }

  return chips;
}

function LoadingPanel({ message }: { message: string }) {
  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-600">
      {message}
    </div>
  );
}

function SavedFiltersSection() {
  const router = useRouter();
  const utils = api.useUtils();
  const [actionError, setActionError] = useState<string | null>(null);
  const savedFiltersQuery = api.search.listSavedFilters.useQuery(undefined, {
    retry: false,
  });

  const deleteSavedFilter = api.search.deleteSavedFilter.useMutation({
    onSuccess: async () => {
      setActionError(null);
      await utils.search.listSavedFilters.invalidate();
    },
    onError: (error) => {
      setActionError(error.message || "Không thể xóa Smart View.");
    },
  });

  const createWorkflow = api.workflow.createFromSavedFilter.useMutation({
    onSuccess: async (workflow) => {
      setActionError(null);
      await Promise.all([
        utils.workflow.list.invalidate(),
        utils.insight.getWorkflowHealth.invalidate(),
        utils.insight.getDashboardSummary.invalidate(),
      ]);
      if (workflow) {
        router.push(`/workflows/${workflow.id}`);
      }
    },
    onError: (error) => {
      setActionError(
        error.message || "Không thể tạo workflow từ Smart View hiện tại.",
      );
    },
  });

  const savedFilters = savedFiltersQuery.data ?? [];

  const handleDeleteSavedFilter = (filter: SavedFilterItem) => {
    const shouldDelete = window.confirm(
      `Xóa Smart View "${filter.name}"? Workflow đã tạo từ Smart View này vẫn được giữ nguyên và không bị thay đổi.`,
    );

    if (!shouldDelete) {
      return;
    }

    deleteSavedFilter.mutate({ id: filter.id });
  };

  return (
    <section id="smart-views" className="panel scroll-mt-6 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
        <div>
          <h2 className="text-sm font-bold">Smart Views</h2>
          <p className="mt-1 text-xs text-slate-500">
            Quản lý bộ lọc đã lưu, mở lại vào trang tìm kiếm để chỉnh sửa và
            tạo workflow cảnh báo mới.
          </p>
        </div>
        <Badge count={savedFilters.length} />
      </div>

      <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-3 text-xs text-sky-800">
        Workflow tạo từ Smart View sẽ sao chép điều kiện tại thời điểm tạo.
        Chỉnh sửa hoặc xóa Smart View không làm thay đổi workflow đã có.
      </div>

      {actionError ? (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {actionError}
        </div>
      ) : null}

      {savedFiltersQuery.isPending ? (
        <LoadingPanel message="Đang tải Smart Views..." />
      ) : savedFiltersQuery.error ? (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-900">
          <p className="font-semibold">Không tải được Smart Views</p>
          <p className="mt-1 text-xs leading-relaxed">
            {savedFiltersQuery.error.message}
          </p>
          <p className="mt-2 text-xs text-amber-800">
            Nếu bạn vừa pull code mới, hãy chạy `bun run db:migrate` rồi tải lại
            trang này.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => savedFiltersQuery.refetch()}
            >
              Thử lại
            </Button>
            <Link
              href="/search"
              className="inline-flex items-center justify-center rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-amber-900 transition-colors duration-150 hover:bg-amber-100 focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              Mở trang Tìm kiếm
            </Link>
          </div>
        </div>
      ) : savedFilters.length === 0 ? (
        <EmptyState
          className="mt-3"
          title="Chưa có Smart View nào"
          description="Tạo bộ lọc trong trang Tìm kiếm để lưu lại điều kiện thường dùng và dùng lại sau này."
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
        <ul className="mt-3 space-y-3">
          {savedFilters.map((filter) => {
            const criteria = renderCriteriaList(filter);
            const workflowCreateLoading =
              createWorkflow.isPending &&
              createWorkflow.variables?.savedFilterId === filter.id;
            const deleteLoading =
              deleteSavedFilter.isPending &&
              deleteSavedFilter.variables?.id === filter.id;
            const hasBeenEdited = filter.updatedAt !== filter.createdAt;

            return (
              <li
                key={filter.id}
                className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 transition-colors duration-150 hover:bg-slate-100"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm leading-tight font-semibold [overflow-wrap:anywhere] text-slate-900">
                        {filter.name}
                      </p>
                      <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                        {notificationFrequencyLabels[filter.notificationFrequency]}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                      <span>ID #{filter.id}</span>
                      <span>Tạo {formatDateTime(filter.createdAt)}</span>
                      <span>
                        {hasBeenEdited
                          ? `Cập nhật ${formatDateTime(filter.updatedAt)}`
                          : "Chưa chỉnh sửa sau khi tạo"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {criteria.map((chip) => (
                    <span
                      key={`${filter.id}-${chip}`}
                      className="inline-flex rounded-full border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-600"
                    >
                      {chip}
                    </span>
                  ))}
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Link
                    href={buildSavedFilterHref(filter)}
                    className="inline-flex items-center justify-center rounded-md bg-sky-700 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors duration-150 hover:bg-sky-800 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
                  >
                    Áp dụng
                  </Link>
                  <Link
                    href={buildSavedFilterHref(filter, {
                      savedFilterId: filter.id,
                    })}
                    className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition-colors duration-150 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
                  >
                    Chỉnh sửa
                  </Link>
                  <Button
                    variant="secondary"
                    size="sm"
                    isLoading={workflowCreateLoading}
                    onClick={() =>
                      createWorkflow.mutate({ savedFilterId: filter.id })
                    }
                  >
                    Tạo workflow
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    isLoading={deleteLoading}
                    onClick={() => handleDeleteSavedFilter(filter)}
                  >
                    Xóa
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function WatchlistSection() {
  const utils = api.useUtils();
  const watchlistQuery = api.watchlist.listItems.useQuery(undefined, {
    retry: false,
  });

  const removeWatchlistItem = api.watchlist.removeItem.useMutation({
    onSuccess: async () => {
      await utils.watchlist.listItems.invalidate();
    },
  });

  const watchlist = watchlistQuery.data ?? [];

  return (
    <section id="watchlist" className="panel scroll-mt-6 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2">
        <h2 className="text-sm font-bold">Watchlist</h2>
        <Badge count={watchlist.length} />
      </div>

      {watchlistQuery.isPending ? (
        <LoadingPanel message="Đang tải Watchlist..." />
      ) : watchlistQuery.error ? (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-700">
          <p className="font-semibold">Không tải được Watchlist</p>
          <p className="mt-1 text-xs leading-relaxed">
            {watchlistQuery.error.message || "Vui lòng thử lại sau."}
          </p>
          <div className="mt-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => watchlistQuery.refetch()}
            >
              Thử lại
            </Button>
          </div>
        </div>
      ) : watchlist.length === 0 ? (
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
                isLoading={removeWatchlistItem.isPending}
                onClick={() => removeWatchlistItem.mutate({ id: item.id })}
              >
                Xóa
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function SavedItemsPageClient() {
  return (
    <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
      <SavedFiltersSection />
      <WatchlistSection />
    </div>
  );
}
