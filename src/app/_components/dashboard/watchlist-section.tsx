"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  CalendarClock,
  ExternalLink,
  Eye,
  Hash,
  ListFilter,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";

import {
  buildSearchHref,
  emptySearchCriteria,
} from "~/lib/search-criteria";
import { WATCHLIST_TYPE_LABELS } from "~/lib/search-modes";
import { Badge, Button, ConfirmDialog, EmptyState } from "~/app/_components/ui";
import { useToast } from "~/app/_components/ui/toast";
import { type RouterOutputs, api } from "~/trpc/react";

type WatchlistItem = RouterOutputs["watchlist"]["listItems"][number];
type WatchlistType = WatchlistItem["type"];
type WatchlistFilter = "all" | WatchlistType;
type SourceDetailWatchlistType = Extract<
  WatchlistType,
  "package" | "plan" | "project"
>;

const dateTimeFormatter = new Intl.DateTimeFormat("vi-VN", {
  dateStyle: "medium",
  timeStyle: "short",
});

const WATCHLIST_TYPE_OPTIONS = [
  "package",
  "plan",
  "project",
  "inviter",
  "competitor",
  "commodity",
] satisfies WatchlistType[];

const SOURCE_DETAIL_ROUTES: Record<SourceDetailWatchlistType, string> = {
  package: "package-details",
  plan: "plan-details",
  project: "project-details",
};

const WATCHLIST_TYPE_PILL_CLASS: Record<WatchlistType, string> = {
  package: "border-sky-200 bg-sky-50 text-sky-700",
  plan: "border-emerald-200 bg-emerald-50 text-emerald-700",
  project: "border-indigo-200 bg-indigo-50 text-indigo-700",
  inviter: "border-amber-200 bg-amber-50 text-amber-800",
  competitor: "border-rose-200 bg-rose-50 text-rose-700",
  commodity: "border-slate-300 bg-slate-100 text-slate-700",
};

const EMPTY_WATCHLIST: WatchlistItem[] = [];

function formatDateTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Thời điểm không hợp lệ";
  }

  return dateTimeFormatter.format(parsed);
}

function isSourceDetailWatchlistType(
  type: WatchlistType,
): type is SourceDetailWatchlistType {
  return type === "package" || type === "plan" || type === "project";
}

function buildWatchlistDetailHref(
  item: Pick<WatchlistItem, "type" | "refKey">,
) {
  if (!isSourceDetailWatchlistType(item.type)) {
    return null;
  }

  return `/${SOURCE_DETAIL_ROUTES[item.type]}/${encodeURIComponent(
    item.refKey,
  )}`;
}

function buildWatchlistSearchHref(
  item: Pick<WatchlistItem, "type" | "refKey" | "label">,
) {
  const mode =
    item.type === "plan"
      ? "plan"
      : item.type === "project"
        ? "project"
        : "package_keyword";

  return buildSearchHref({
    mode,
    criteria: {
      ...emptySearchCriteria,
      keyword: item.label.trim() || item.refKey,
    },
    savedFilterId: null,
  });
}

function getDomain(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return "Nguồn không hợp lệ";
  }
}

function LoadingPanel({ message }: { message: string }) {
  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-600">
      {message}
    </div>
  );
}

function WatchlistTypeBadge({ type }: { type: WatchlistType }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${WATCHLIST_TYPE_PILL_CLASS[type]}`}
    >
      {WATCHLIST_TYPE_LABELS[type]}
    </span>
  );
}

function WatchlistDetailsPanel({
  item,
  onDelete,
}: {
  item: WatchlistItem | null;
  onDelete: (item: WatchlistItem) => void;
}) {
  const detailInput =
    item && isSourceDetailWatchlistType(item.type)
      ? {
          entityType: item.type,
          externalId: item.refKey,
        }
      : null;
  const detailHref = item ? buildWatchlistDetailHref(item) : null;
  const searchHref = item ? buildWatchlistSearchHref(item) : "/search";
  const detailsQuery = api.search.getSourceDetails.useQuery(
    detailInput ?? {
      entityType: "package" as const,
      externalId: "__watchlist_detail_disabled__",
    },
    {
      enabled: detailInput !== null,
      retry: false,
    },
  );

  if (!item) {
    return (
      <aside className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5">
        <div className="flex h-full min-h-60 flex-col items-center justify-center text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-slate-400 ring-1 ring-slate-200">
            <Eye className="h-5 w-5" aria-hidden />
          </div>
          <p className="mt-3 text-sm font-semibold text-slate-900">
            Chọn một mục để xem chi tiết
          </p>
          <p className="mt-1 max-w-sm text-xs leading-relaxed text-slate-500">
            Gói thầu, KHLCNT và dự án sẽ tải preview từ trang nguồn. Các mục như
            bên mời thầu hoặc hàng hóa sẽ mở lại trang tìm kiếm theo tên đã lưu.
          </p>
        </div>
      </aside>
    );
  }

  const details = detailsQuery.data;

  return (
    <aside className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <WatchlistTypeBadge type={item.type} />
            <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-500">
              Watchlist #{item.id}
            </span>
          </div>
          <h3 className="mt-2 text-base leading-snug font-bold [overflow-wrap:anywhere] text-slate-950">
            {item.label}
          </h3>
        </div>
      </div>

      <dl className="mt-4 grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
          <dt className="inline-flex items-center gap-1 text-[11px] font-semibold tracking-[0.12em] text-slate-500 uppercase">
            <Hash className="h-3.5 w-3.5" aria-hidden />
            Ref key
          </dt>
          <dd className="mt-1 text-xs font-medium break-all text-slate-900">
            {item.refKey}
          </dd>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
          <dt className="inline-flex items-center gap-1 text-[11px] font-semibold tracking-[0.12em] text-slate-500 uppercase">
            <CalendarClock className="h-3.5 w-3.5" aria-hidden />
            Đã lưu
          </dt>
          <dd className="mt-1 text-xs font-medium text-slate-900">
            {formatDateTime(item.createdAt)}
          </dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href={detailHref ?? searchHref}
          className="inline-flex items-center justify-center gap-1.5 rounded-md bg-sky-700 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors duration-150 hover:bg-sky-800 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          {detailHref ? "Mở trang chi tiết" : "Mở trong Tìm kiếm"}
        </Link>
        {details?.sourceUrl ? (
          <a
            href={details.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition-colors duration-150 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            Mở nguồn
          </a>
        ) : null}
        <Button
          variant="danger"
          size="sm"
          leftIcon={<Trash2 className="h-3.5 w-3.5" />}
          onClick={() => onDelete(item)}
        >
          Xóa
        </Button>
      </div>

      {detailHref ? (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold tracking-[0.14em] text-slate-500 uppercase">
                Preview chi tiết nguồn
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Tải trực tiếp từ BidWinner theo ref key đã lưu.
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              isLoading={detailsQuery.isFetching && !detailsQuery.isLoading}
              leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
              onClick={() => detailsQuery.refetch()}
            >
              Làm mới
            </Button>
          </div>

          {detailsQuery.isLoading ? (
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-600">
              Đang tải preview chi tiết…
            </div>
          ) : detailsQuery.isError ? (
            <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-900">
              <p className="font-semibold">Không tải được preview nguồn</p>
              <p className="mt-1 text-xs leading-relaxed">
                {detailsQuery.error?.message ??
                  "Trang nguồn có thể tạm thời không truy cập được."}
              </p>
            </div>
          ) : details ? (
            <div className="mt-3 space-y-3">
              <div>
                <p className="text-sm leading-snug font-semibold [overflow-wrap:anywhere] text-slate-950">
                  {details.pageTitle}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {getDomain(details.sourceUrl)} • Cập nhật{" "}
                  {formatDateTime(details.fetchedAt)}
                </p>
              </div>

              <div className="grid grid-cols-3 overflow-hidden rounded-xl border border-slate-200 text-center">
                <div className="border-r border-slate-200 px-2 py-2">
                  <p className="text-lg font-bold text-slate-950">
                    {details.products.length}
                  </p>
                  <p className="text-[11px] text-slate-500">Products</p>
                </div>
                <div className="border-r border-slate-200 px-2 py-2">
                  <p className="text-lg font-bold text-slate-950">
                    {details.links.length}
                  </p>
                  <p className="text-[11px] text-slate-500">Links</p>
                </div>
                <div className="px-2 py-2">
                  <p className="text-lg font-bold text-slate-950">
                    {details.requiredTables.invitationDocuments.length}
                  </p>
                  <p className="text-[11px] text-slate-500">HSMT</p>
                </div>
              </div>

              {details.extractionMeta.warnings.length > 0 ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                  <p className="text-xs font-semibold text-amber-900">
                    Cảnh báo extraction
                  </p>
                  <ul className="mt-1 space-y-1 text-xs text-amber-900">
                    {details.extractionMeta.warnings
                      .slice(0, 3)
                      .map((warning, index) => (
                        <li key={`${warning}-${index}`}>{warning}</li>
                      ))}
                  </ul>
                </div>
              ) : null}

              {details.products.length > 0 ? (
                <div>
                  <p className="text-xs font-semibold tracking-[0.12em] text-slate-500 uppercase">
                    Products detect được
                  </p>
                  <ul className="mt-2 space-y-1">
                    {details.products.slice(0, 3).map((product, index) => (
                      <li
                        key={`${product.source}-${product.text}-${index}`}
                        className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs text-slate-700"
                      >
                        <span className="[overflow-wrap:anywhere]">
                          {product.text}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3">
          <p className="text-sm font-semibold text-amber-950">
            Loại này chưa có trang chi tiết riêng
          </p>
          <p className="mt-1 text-xs leading-relaxed text-amber-900">
            Watchlist đang lưu tên và ref key. Dùng nút tìm kiếm để mở danh sách
            kết quả liên quan đến mục này.
          </p>
        </div>
      )}
    </aside>
  );
}

export function WatchlistSection() {
  const utils = api.useUtils();
  const toast = useToast();
  const [activeFilter, setActiveFilter] = useState<WatchlistFilter>("all");
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WatchlistItem | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const watchlistQuery = api.watchlist.listItems.useQuery(undefined, {
    retry: false,
  });

  const removeWatchlistItem = api.watchlist.removeItem.useMutation({
    onSuccess: async (_result, variables) => {
      setActionError(null);
      setDeleteTarget(null);
      setSelectedItemId((current) =>
        current === variables.id ? null : current,
      );
      toast.success("Đã xóa khỏi Watchlist.");
      await utils.watchlist.listItems.invalidate();
    },
    onError: (error) => {
      setDeleteTarget(null);
      setActionError(error.message || "Không thể xóa mục Watchlist.");
    },
  });

  const watchlist = watchlistQuery.data ?? EMPTY_WATCHLIST;
  const typeCounts = useMemo(() => {
    const counts = Object.fromEntries(
      WATCHLIST_TYPE_OPTIONS.map((type) => [type, 0]),
    ) as Record<WatchlistType, number>;

    for (const item of watchlist) {
      counts[item.type] += 1;
    }

    return counts;
  }, [watchlist]);
  const filteredWatchlist = useMemo(() => {
    if (activeFilter === "all") {
      return watchlist;
    }

    return watchlist.filter((item) => item.type === activeFilter);
  }, [activeFilter, watchlist]);
  const selectedItem =
    selectedItemId === null
      ? null
      : (filteredWatchlist.find((item) => item.id === selectedItemId) ?? null);
  const deletingId = removeWatchlistItem.isPending
    ? removeWatchlistItem.variables?.id
    : null;

  return (
    <section className="panel overflow-hidden">
      <ConfirmDialog
        open={deleteTarget !== null}
        title={`Xóa "${deleteTarget?.label ?? ""}" khỏi Watchlist?`}
        description="Mục này sẽ biến mất khỏi danh sách theo dõi, nhưng dữ liệu nguồn và Smart Views không bị thay đổi."
        confirmLabel="Xóa"
        variant="danger"
        isLoading={deletingId === deleteTarget?.id}
        onConfirm={() => {
          if (deleteTarget) {
            removeWatchlistItem.mutate({ id: deleteTarget.id });
          }
        }}
        onCancel={() => setDeleteTarget(null)}
      />

      <div className="border-b border-slate-200 bg-gradient-to-r from-slate-50 via-white to-sky-50 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-950">Watchlist</h2>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500">
              Theo dõi những mục cần quay lại sau. Chọn một dòng để xem preview
              chi tiết ngay trên trang này.
            </p>
          </div>
          <Badge tone="info" count={watchlist.length}>
            Tổng
          </Badge>
        </div>
      </div>

      {watchlistQuery.isPending ? (
        <div className="p-5">
          <LoadingPanel message="Đang tải Watchlist…" />
        </div>
      ) : watchlistQuery.error ? (
        <div className="m-5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-700">
          <p className="font-semibold">Không tải được Watchlist</p>
          <p className="mt-1 text-xs leading-relaxed">
            {watchlistQuery.error.message || "Vui lòng thử lại sau."}
          </p>
          <div className="mt-3">
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
              onClick={() => watchlistQuery.refetch()}
            >
              Thử lại
            </Button>
          </div>
        </div>
      ) : watchlist.length === 0 ? (
        <div className="p-5">
          <EmptyState
            title="Chưa có mục theo dõi"
            description="Thêm gói thầu, KHLCNT, dự án, bên mời thầu hoặc đối thủ vào watchlist từ trang Tìm kiếm."
            cta={
              <Link
                href="/search/packages"
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-sky-700 px-3 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-sky-800 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                <Search className="h-4 w-4" aria-hidden />
                Đến trang Tìm kiếm
              </Link>
            }
          />
        </div>
      ) : (
        <div className="p-5">
          {actionError ? (
            <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {actionError}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-pressed={activeFilter === "all"}
              className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none ${
                activeFilter === "all"
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              }`}
              onClick={() => {
                setActiveFilter("all");
                setSelectedItemId(null);
              }}
            >
              <ListFilter className="h-3.5 w-3.5" aria-hidden />
              Tất cả
              <span className="rounded-full bg-white/20 px-1.5 text-[11px] tabular-nums">
                {watchlist.length}
              </span>
            </button>
            {WATCHLIST_TYPE_OPTIONS.map((type) => (
              <button
                key={type}
                type="button"
                aria-pressed={activeFilter === type}
                className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none ${
                  activeFilter === type
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
                onClick={() => {
                  setActiveFilter(type);
                  setSelectedItemId(null);
                }}
              >
                {WATCHLIST_TYPE_LABELS[type]}
                <span className="rounded-full bg-white/20 px-1.5 text-[11px] tabular-nums">
                  {typeCounts[type]}
                </span>
              </button>
            ))}
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(380px,0.9fr)]">
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3">
                <div>
                  <p className="text-sm font-bold text-slate-950">
                    Danh sách theo dõi
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {filteredWatchlist.length} / {watchlist.length} mục đang
                    hiển thị
                  </p>
                </div>
              </div>

              {filteredWatchlist.length === 0 ? (
                <div className="p-4">
                  <EmptyState
                    title="Không có mục trong nhóm này"
                    description="Đổi bộ lọc khác hoặc thêm mục mới từ trang Tìm kiếm."
                  />
                </div>
              ) : (
                <ul className="max-h-[620px] divide-y divide-slate-200 overflow-y-auto">
                  {filteredWatchlist.map((item) => {
                    const isSelected = selectedItem?.id === item.id;
                    const detailHref = buildWatchlistDetailHref(item);
                    const openHref =
                      detailHref ?? buildWatchlistSearchHref(item);

                    return (
                      <li
                        key={item.id}
                        className={`flex flex-col gap-3 px-4 py-3 transition-colors duration-150 sm:flex-row sm:items-start sm:justify-between ${
                          isSelected
                            ? "bg-sky-50/80"
                            : "bg-white hover:bg-slate-50"
                        }`}
                      >
                        <button
                          type="button"
                          aria-current={isSelected ? "true" : undefined}
                          className="min-w-0 flex-1 text-left focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
                          onClick={() => setSelectedItemId(item.id)}
                        >
                          <div className="flex flex-wrap items-center gap-1.5">
                            <WatchlistTypeBadge type={item.type} />
                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                              #{item.id}
                            </span>
                          </div>
                          <p className="mt-2 text-sm leading-snug font-semibold [overflow-wrap:anywhere] text-slate-950">
                            {item.label}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                            <span className="inline-flex min-w-0 items-center gap-1">
                              <Hash className="h-3.5 w-3.5 shrink-0" />
                              <span className="break-all">{item.refKey}</span>
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <CalendarClock className="h-3.5 w-3.5" />
                              {formatDateTime(item.createdAt)}
                            </span>
                          </div>
                        </button>

                        <div className="flex shrink-0 flex-wrap gap-1.5 sm:justify-end">
                          <Button
                            variant={isSelected ? "primary" : "secondary"}
                            size="sm"
                            leftIcon={<Eye className="h-3.5 w-3.5" />}
                            onClick={() => setSelectedItemId(item.id)}
                          >
                            Xem
                          </Button>
                          <Link
                            href={openHref}
                            className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 transition-colors duration-150 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
                          >
                            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                            {detailHref ? "Mở" : "Tìm"}
                          </Link>
                          <Button
                            variant="danger"
                            size="sm"
                            isLoading={deletingId === item.id}
                            leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                            onClick={() => setDeleteTarget(item)}
                          >
                            Xóa
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <WatchlistDetailsPanel
              item={selectedItem}
              onDelete={setDeleteTarget}
            />
          </div>
        </div>
      )}
    </section>
  );
}
