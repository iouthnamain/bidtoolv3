import Link from "next/link";

import { AlertCard } from "~/app/_components/dashboard/alert-card";
import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { KpiCard } from "~/app/_components/dashboard/kpi-card";
import { Badge, EmptyState } from "~/app/_components/ui";
import { getDashboardSnapshot } from "~/app/_lib/dashboard-data";

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Chưa có";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("vi-VN");
}

function workflowStatusLabel(status: string | null | undefined) {
  if (status === "success") return "Thành công";
  if (status === "failed") return "Thất bại";
  if (status === "running") return "Đang chạy";
  return "Chưa chạy";
}

function workflowStatusTone(status: string | null | undefined) {
  if (status === "success") return "success";
  if (status === "failed") return "critical";
  if (status === "running") return "info";
  return "neutral";
}

function MiniIcon({
  name,
}: {
  name: "search" | "saved" | "workflow" | "notification";
}) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className: "h-4 w-4",
  };

  if (name === "search") {
    return (
      <svg {...common}>
        <circle cx="11" cy="11" r="6.5" />
        <path d="m16 16 4.25 4.25" />
      </svg>
    );
  }

  if (name === "saved") {
    return (
      <svg {...common}>
        <path d="M6 4.5h12A1.5 1.5 0 0 1 19.5 6v14.5L12 16l-7.5 4.5V6A1.5 1.5 0 0 1 6 4.5Z" />
      </svg>
    );
  }

  if (name === "workflow") {
    return (
      <svg {...common}>
        <circle cx="6" cy="6" r="2.5" />
        <circle cx="18" cy="12" r="2.5" />
        <circle cx="6" cy="18" r="2.5" />
        <path d="M8.5 6h6" />
        <path d="M15.8 13.4 8.3 16.6" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <path d="M7.5 9a4.5 4.5 0 1 1 9 0v4l1.5 2.5h-12L7.5 13Z" />
      <path d="M10 18a2 2 0 0 0 4 0" />
    </svg>
  );
}

export default async function DashboardPage() {
  const {
    summary,
    latestAlerts: alerts,
    recentWorkflowRuns,
    isDegraded,
  } = await getDashboardSnapshot();

  const hasAttention = summary.unreadAlerts > 0;
  const latestWorkflow = recentWorkflowRuns[0] ?? null;
  const nextActions = [
    {
      href: "/search",
      label: "Tạo bộ lọc mới",
      body: "Tìm realtime, lưu Smart View và chọn gói cần theo dõi.",
      icon: "search" as const,
    },
    {
      href: "/saved-items",
      label: "Mở bộ lọc đã lưu",
      body: "Áp lại Smart View hoặc kiểm tra Watchlist.",
      icon: "saved" as const,
    },
    {
      href: "/workflows",
      label: "Quản lý workflow",
      body: "Bật, tạm dừng hoặc xem lịch sử chạy tự động.",
      icon: "workflow" as const,
    },
    {
      href: "/notifications",
      label: "Xử lý cảnh báo",
      body: "Đọc các cảnh báo workflow vừa tạo.",
      icon: "notification" as const,
    },
  ];

  return (
    <DashboardShell
      title="Tổng quan điều hành"
      description="Theo dõi nhanh KPI, cảnh báo và trạng thái automation"
    >
      {isDegraded ? (
        <section className="panel mb-3 border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Không tải được dữ liệu dashboard từ database. Kiểm tra Postgres và
          chạy migration trước khi dùng dữ liệu thật.
        </section>
      ) : null}

      <section className="grid gap-3 lg:grid-cols-[1.15fr_0.85fr]">
        <article className="panel overflow-hidden">
          <div className="border-b border-slate-200 bg-gradient-to-r from-slate-950 via-sky-950 to-teal-950 px-4 py-4 text-white sm:px-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold tracking-[0.16em] text-cyan-100/90 uppercase">
                  Trạng thái hôm nay
                </p>
                <h2 className="mt-1 text-xl font-bold tracking-tight">
                  {hasAttention
                    ? "Có cảnh báo cần xử lý"
                    : "Hệ thống đang ổn định"}
                </h2>
              </div>
              <Badge tone={hasAttention ? "warning" : "success"}>
                {hasAttention
                  ? `${summary.unreadAlerts} cảnh báo`
                  : "Không có cảnh báo mới"}
              </Badge>
            </div>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-cyan-50/90">
              Bắt đầu bằng cảnh báo chưa đọc nếu có. Nếu mọi thứ ổn, tiếp tục
              tạo Smart View mới hoặc kiểm tra workflow gần nhất.
            </p>
          </div>

          <div className="grid gap-3 p-4 sm:grid-cols-3 sm:p-5">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
              <p className="text-xs font-semibold text-slate-500">
                Workflow gần nhất
              </p>
              <p className="mt-1 text-sm font-bold text-slate-950">
                {latestWorkflow?.name ?? "Chưa có lịch sử chạy"}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {formatDateTime(latestWorkflow?.latestRun?.startedAt)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
              <p className="text-xs font-semibold text-slate-500">
                Tự động hóa
              </p>
              <p className="mt-1 text-sm font-bold text-slate-950">
                {summary.activeWorkflows} workflow đang bật
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Tỷ lệ thành công {summary.workflowSuccessRate}%
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
              <p className="text-xs font-semibold text-slate-500">
                Dữ liệu theo dõi
              </p>
              <p className="mt-1 text-sm font-bold text-slate-950">
                {summary.totalPackages} gói đã lưu
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Cập nhật khi người dùng lưu kết quả.
              </p>
            </div>
          </div>
        </article>

        <article className="panel p-4 sm:p-5">
          <p className="section-title">Làm tiếp</p>
          <h2 className="mt-1 text-base font-bold text-slate-950">
            Lối đi nhanh theo tác vụ
          </h2>
          <div className="mt-3 grid gap-2">
            {nextActions.map((action) => (
              <Link
                key={action.href}
                href={action.href}
                className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 transition-colors duration-150 hover:border-sky-300 hover:bg-sky-50/70 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-700">
                  <MiniIcon name={action.icon} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-bold text-slate-950">
                    {action.label}
                  </span>
                  <span className="mt-0.5 block text-xs leading-5 text-slate-600">
                    {action.body}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </article>
      </section>

      <section className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Tổng gói thầu"
          value={summary.totalPackages}
          hint="Dữ liệu đang theo dõi"
        />
        <KpiCard
          label="Cảnh báo chưa đọc"
          value={summary.unreadAlerts}
          hint={hasAttention ? "Cần xử lý sớm" : "Đang sạch"}
          trend={hasAttention ? "up" : undefined}
        />
        <KpiCard
          label="Workflow đang bật"
          value={summary.activeWorkflows}
          hint="Đang chạy tự động"
        />
        <KpiCard
          label="Tỷ lệ thành công"
          value={`${summary.workflowSuccessRate}%`}
          hint="Từ lịch sử workflow runs"
        />
      </section>

      <section className="mt-4 grid gap-3 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="section-title">Cần chú ý</p>
              <h2 className="mt-1 text-sm font-bold text-slate-900">
                Cảnh báo mới
              </h2>
            </div>
            <Link
              href="/notifications"
              className="text-xs font-semibold text-sky-700 hover:underline"
            >
              Xem tất cả
            </Link>
          </div>

          {alerts.length === 0 ? (
            <EmptyState
              icon={
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-5 w-5"
                  aria-hidden
                >
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
              }
              title="Chưa có cảnh báo nào"
              description="Tạo bộ lọc và bật thông báo để nhận cảnh báo khi có gói thầu mới."
              cta={
                <Link
                  href="/search"
                  className="inline-flex items-center rounded-lg bg-sky-700 px-4 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-sky-800 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
                >
                  Tạo bộ lọc
                </Link>
              }
            />
          ) : (
            alerts.map((item) => (
              <AlertCard
                key={item.id}
                title={item.title}
                body={item.body}
                severity={item.severity}
              />
            ))
          )}
        </div>

        <article className="panel p-4">
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-2">
            <div>
              <p className="section-title">Lịch sử</p>
              <h2 className="mt-1 text-sm font-bold">Workflow chạy gần đây</h2>
            </div>
            <Link
              href="/workflows"
              className="text-xs font-semibold text-sky-700 hover:underline"
            >
              Quản lý workflow
            </Link>
          </div>

          {recentWorkflowRuns.length === 0 ? (
            <EmptyState
              className="mt-3"
              title="Chưa có lịch sử chạy"
              description="Khi workflow được chạy thủ công hoặc theo lịch, lịch sử gần đây sẽ xuất hiện tại đây."
            />
          ) : (
            <ul className="mt-3 space-y-2">
              {recentWorkflowRuns.map((workflow) => (
                <li
                  key={workflow.id}
                  className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="min-w-0 flex-1 text-sm font-semibold [overflow-wrap:anywhere] text-slate-900">
                      {workflow.name}
                    </p>
                    <Badge
                      tone={workflowStatusTone(workflow.latestRun?.status)}
                    >
                      {workflowStatusLabel(workflow.latestRun?.status)}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {formatDateTime(workflow.latestRun?.startedAt)}
                  </p>
                  {workflow.latestRun?.message ? (
                    <p className="mt-1 text-xs leading-5 text-slate-600">
                      {workflow.latestRun.message}
                    </p>
                  ) : null}
                  <Link
                    href={`/workflows/${workflow.id}`}
                    className="mt-2 inline-flex text-xs font-semibold text-sky-700 hover:underline"
                  >
                    Chi tiết workflow
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>
    </DashboardShell>
  );
}
