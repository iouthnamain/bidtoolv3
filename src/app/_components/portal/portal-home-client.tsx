"use client";

import { Bell, BookmarkCheck, Eye, FileSpreadsheet, Layers } from "lucide-react";

import { Badge } from "~/app/_components/ui";
import { api } from "~/trpc/react";

const dateTimeFormatter = new Intl.DateTimeFormat("vi-VN", {
  dateStyle: "short",
  timeStyle: "short",
});

function formatDateTime(value: string | Date | null | undefined) {
  if (!value) return "Chưa có";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Chưa có";
  return dateTimeFormatter.format(date);
}

type JobStatus =
  | "draft"
  | "queued"
  | "paused"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

function jobStatusLabel(status: string | null | undefined) {
  switch (status) {
    case "completed":
      return "Hoàn tất";
    case "failed":
      return "Thất bại";
    case "running":
      return "Đang chạy";
    case "queued":
      return "Trong hàng đợi";
    case "paused":
      return "Tạm dừng";
    case "cancelled":
      return "Đã hủy";
    case "draft":
      return "Nháp";
    default:
      return "Không rõ";
  }
}

function jobStatusTone(
  status: string | null | undefined,
): "neutral" | "success" | "warning" | "critical" | "info" {
  switch (status) {
    case "completed":
      return "success";
    case "failed":
    case "cancelled":
      return "critical";
    case "running":
    case "queued":
      return "info";
    case "paused":
      return "warning";
    default:
      return "neutral";
  }
}

function SectionCard({
  icon,
  title,
  action,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded border border-slate-400 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-slate-400 pb-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded bg-blue-50 text-blue-700">
            {icon}
          </span>
          <h2 className="text-sm font-bold text-slate-900">{title}</h2>
        </div>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded border border-dashed border-slate-400 bg-slate-50/60 px-3 py-4 text-center text-xs text-slate-700">
      {children}
    </p>
  );
}

function NotificationsSection() {
  const unreadQuery = api.notification.unreadCount.useQuery();
  const listQuery = api.notification.list.useQuery({ limit: 5 });
  const items = listQuery.data ?? [];
  const unread = unreadQuery.data ?? 0;

  return (
    <SectionCard
      icon={<Bell className="h-4 w-4" aria-hidden="true" />}
      title="Thông báo"
      action={
        unread > 0 ? (
          <Badge tone="warning">{unread} chưa đọc</Badge>
        ) : (
          <Badge tone="neutral">Đã đọc hết</Badge>
        )
      }
    >
      {listQuery.isPending ? (
        <EmptyRow>Đang tải…</EmptyRow>
      ) : items.length === 0 ? (
        <EmptyRow>Chưa có thông báo nào.</EmptyRow>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className={`rounded border px-3 py-2.5 ${
                item.isRead
                  ? "border-slate-400 bg-white"
                  : "border-blue-200 bg-blue-50/50"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 flex-1 text-sm font-semibold [overflow-wrap:anywhere] text-slate-900">
                  {item.title}
                </p>
                {!item.isRead ? <Badge tone="info">Mới</Badge> : null}
              </div>
              {item.body ? (
                <p className="mt-1 text-xs leading-5 text-slate-600">
                  {item.body}
                </p>
              ) : null}
              <p className="mt-1 text-xs text-slate-600">
                {formatDateTime(item.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function ResearchJobsSection() {
  const query = api.excelResearch.listJobs.useQuery({ limit: 5 });
  const items = query.data ?? [];

  return (
    <SectionCard
      icon={<FileSpreadsheet className="h-4 w-4" aria-hidden="true" />}
      title="Kết quả nghiên cứu"
    >
      {query.isPending ? (
        <EmptyRow>Đang tải…</EmptyRow>
      ) : items.length === 0 ? (
        <EmptyRow>Chưa có công việc nghiên cứu nào.</EmptyRow>
      ) : (
        <ul className="space-y-2">
          {items.map((job) => (
            <li
              key={job.id}
              className="rounded border border-slate-400 bg-white px-3 py-2.5"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 flex-1 text-sm font-semibold [overflow-wrap:anywhere] text-slate-900">
                  {job.name || job.sourceFileName || "Không có tên"}
                </p>
                <Badge tone={jobStatusTone(job.status)}>
                  {jobStatusLabel(job.status)}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-slate-700">
                {job.processedRows}/{job.totalRows} dòng đã xử lý
                {job.matchedRows > 0 ? ` · ${job.matchedRows} khớp` : ""}
              </p>
              <p className="mt-0.5 text-xs text-slate-600">
                {formatDateTime(job.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function EnrichmentJobsSection() {
  const query =
    api.materialEnrichment.listMaterialEnrichmentJobs.useQuery({ limit: 5 });
  const items = query.data ?? [];

  return (
    <SectionCard
      icon={<Layers className="h-4 w-4" aria-hidden="true" />}
      title="Làm giàu dữ liệu vật tư"
    >
      {query.isPending ? (
        <EmptyRow>Đang tải…</EmptyRow>
      ) : items.length === 0 ? (
        <EmptyRow>Chưa có công việc làm giàu nào.</EmptyRow>
      ) : (
        <ul className="space-y-2">
          {items.map((job) => (
            <li
              key={job.id}
              className="rounded border border-slate-400 bg-white px-3 py-2.5"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 flex-1 text-sm font-semibold text-slate-900">
                  {job.currentMaterialName ?? `Công việc ${job.id.slice(0, 8)}`}
                </p>
                <Badge tone={jobStatusTone(job.status)}>
                  {jobStatusLabel(job.status)}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-slate-700">
                {job.processed}/{job.total} mục đã xử lý
                {job.matched > 0 ? ` · ${job.matched} khớp` : ""}
              </p>
              <p className="mt-0.5 text-xs text-slate-600">
                {formatDateTime(job.startedAt)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function WatchlistSection() {
  const query = api.watchlist.listItems.useQuery({});
  const items = query.data ?? [];

  return (
    <SectionCard
      icon={<BookmarkCheck className="h-4 w-4" aria-hidden="true" />}
      title="Danh sách theo dõi"
      action={
        items.length > 0 ? (
          <Badge tone="neutral">{items.length} mục</Badge>
        ) : null
      }
    >
      {query.isPending ? (
        <EmptyRow>Đang tải…</EmptyRow>
      ) : items.length === 0 ? (
        <EmptyRow>Chưa có mục theo dõi nào.</EmptyRow>
      ) : (
        <ul className="space-y-1.5">
          {items.slice(0, 8).map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-2 rounded border border-slate-400 bg-white px-3 py-2"
            >
              <span className="min-w-0 flex-1 truncate text-sm text-slate-800">
                {item.label}
              </span>
              <span className="shrink-0 text-xs text-slate-600">
                {formatDateTime(item.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function SavedFiltersSection() {
  const query = api.search.listSavedFilters.useQuery();
  const items = query.data ?? [];

  return (
    <SectionCard
      icon={<BookmarkCheck className="h-4 w-4" aria-hidden="true" />}
      title="Bộ lọc đã lưu"
      action={
        items.length > 0 ? (
          <Badge tone="neutral">{items.length} bộ lọc</Badge>
        ) : null
      }
    >
      {query.isPending ? (
        <EmptyRow>Đang tải…</EmptyRow>
      ) : items.length === 0 ? (
        <EmptyRow>Chưa có bộ lọc nào được lưu.</EmptyRow>
      ) : (
        <ul className="space-y-1.5">
          {items.slice(0, 8).map((filter) => (
            <li
              key={filter.id}
              className="flex items-center justify-between gap-2 rounded border border-slate-400 bg-white px-3 py-2"
            >
              <span className="min-w-0 flex-1 truncate text-sm text-slate-800">
                {filter.name}
              </span>
              {filter.keyword ? (
                <span className="shrink-0 truncate text-xs text-slate-600">
                  {filter.keyword}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

/**
 * Read-only customer portal home. Every query here is tenant-scoped on the
 * server, so the customer only ever sees their own tenant's data. No mutations
 * are called — customers have an empty permission set and gated mutations would
 * return FORBIDDEN.
 */
export function PortalHomeClient() {
  const unreadQuery = api.notification.unreadCount.useQuery();
  const researchQuery = api.excelResearch.listJobs.useQuery({ limit: 5 });
  const enrichmentQuery =
    api.materialEnrichment.listMaterialEnrichmentJobs.useQuery({ limit: 5 });
  const watchlistQuery = api.watchlist.listItems.useQuery({});
  const filtersQuery = api.search.listSavedFilters.useQuery();

  return (
    <div className="space-y-3">
      <section className="rounded border border-amber-200 bg-amber-50 p-4 text-amber-950 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-1">
          <div className="flex gap-1">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-white text-amber-700">
              <Eye className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-bold">Cổng khách hàng chỉ xem</h2>
                <Badge tone="warning">Chỉ xem</Badge>
              </div>
              <p className="mt-1 text-xs leading-5 text-amber-800">
                Bạn có thể xem thông báo, tiến độ nghiên cứu, job làm giàu,
                watchlist và bộ lọc đã lưu thuộc tổ chức của mình. Mọi thao tác
                tạo, sửa, chạy job hoặc quản trị hệ thống được ẩn khỏi portal.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {[
          {
            label: "Thông báo",
            value: unreadQuery.data ?? 0,
            hint: "chưa đọc",
          },
          {
            label: "Nghiên cứu",
            value: researchQuery.data?.length ?? 0,
            hint: "job gần đây",
          },
          {
            label: "Làm giàu",
            value: enrichmentQuery.data?.length ?? 0,
            hint: "job gần đây",
          },
          {
            label: "Watchlist",
            value: watchlistQuery.data?.length ?? 0,
            hint: "mục theo dõi",
          },
          {
            label: "Bộ lọc",
            value: filtersQuery.data?.length ?? 0,
            hint: "đã lưu",
          },
        ].map((metric) => (
          <article
            key={metric.label}
            className="rounded border border-slate-400 bg-white px-3 py-2.5 shadow-sm"
          >
            <p className="text-xs font-bold tracking-[0.14em] text-slate-700 uppercase">
              {metric.label}
            </p>
            <p className="mt-1 text-xl font-extrabold text-slate-950 tabular-nums">
              {metric.value}
            </p>
            <p className="mt-0.5 text-xs text-slate-700">{metric.hint}</p>
          </article>
        ))}
      </section>
      <NotificationsSection />
      <div className="grid gap-2 lg:grid-cols-2">
        <ResearchJobsSection />
        <EnrichmentJobsSection />
        <WatchlistSection />
        <SavedFiltersSection />
      </div>
    </div>
  );
}

export type { JobStatus };
