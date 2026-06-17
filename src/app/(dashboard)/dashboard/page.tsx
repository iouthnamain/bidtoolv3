import Link from "next/link";
import {
  Activity,
  Bell,
  BookmarkCheck,
  ChevronRight,
  Database,
  FileText,
  Search,
  TriangleAlert,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { createPageMetadata } from "~/app/_lib/seo";
import { AlertCard } from "~/app/_components/dashboard/alert-card";
import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { KpiCard } from "~/app/_components/dashboard/kpi-card";
import { Badge, EmptyState } from "~/app/_components/ui";
import { getDashboardSnapshot } from "~/app/_lib/dashboard-data";

export const metadata = createPageMetadata({
  title: "Dashboard điều hành",
  description:
    "Theo dõi tổng quan gói thầu, cảnh báo, workflow và trạng thái vận hành trong BidTool v3.",
  path: "/dashboard",
  keywords: ["dashboard đấu thầu", "theo dõi gói thầu", "cảnh báo đấu thầu"],
});

const dateTimeFormatter = new Intl.DateTimeFormat("vi-VN", {
  dateStyle: "short",
  timeStyle: "short",
});

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Chưa có";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return dateTimeFormatter.format(date);
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

function workflowStatusBorder(status: string | null | undefined) {
  if (status === "success") return "border-l-emerald-500";
  if (status === "failed") return "border-l-rose-500";
  if (status === "running") return "border-l-sky-500";
  return "border-l-slate-300";
}

type MiniIconName =
  | "search"
  | "documents"
  | "saved"
  | "workflow"
  | "notification";

const miniIconMap: Record<MiniIconName, LucideIcon> = {
  search: Search,
  documents: FileText,
  saved: BookmarkCheck,
  workflow: Workflow,
  notification: Bell,
};

const miniIconColorMap: Record<MiniIconName, string> = {
  search: "bg-sky-100 text-sky-700",
  documents: "bg-violet-100 text-violet-700",
  saved: "bg-emerald-100 text-emerald-700",
  workflow: "bg-amber-100 text-amber-700",
  notification: "bg-rose-100 text-rose-700",
};

function MiniIcon({ name }: { name: MiniIconName }) {
  const Icon = miniIconMap[name];
  return <Icon className="h-4.5 w-4.5" aria-hidden="true" />;
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
      href: "/search/packages",
      label: "Tạo bộ lọc mới",
      icon: "search" as const,
    },
    {
      href: "/documents",
      label: "Mở Documents",
      icon: "documents" as const,
    },
    {
      href: "/saved-items/smart-views",
      label: "Mở bộ lọc đã lưu",
      icon: "saved" as const,
    },
    {
      href: "/workflows",
      label: "Quản lý workflow",
      icon: "workflow" as const,
    },
    {
      href: "/notifications",
      label: "Xử lý cảnh báo",
      icon: "notification" as const,
    },
  ];

  return (
    <DashboardShell
      title="Tổng quan điều hành"
      description="Theo dõi nhanh KPI, cảnh báo và trạng thái automation"
    >
      <div className="animate-rise">
        {isDegraded ? (
          <section className="panel mb-3 flex items-center gap-3 border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <TriangleAlert
              className="h-5 w-5 shrink-0 text-amber-600"
              aria-hidden
            />
            <span>
              Không tải được dữ liệu dashboard từ database. Kiểm tra Postgres
              và chạy migration trước khi dùng dữ liệu thật.
            </span>
          </section>
        ) : null}

        <section className="grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
          {/* Status hero card */}
          <article className="brand-surface overflow-hidden rounded-xl">
            <div className="px-4 py-5 sm:px-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h2 className="text-lg font-bold tracking-tight text-white">
                  {hasAttention
                    ? "Có cảnh báo cần xử lý"
                    : "Hệ thống đang ổn định"}
                </h2>
                <Badge tone={hasAttention ? "warning" : "success"}>
                  {hasAttention
                    ? `${summary.unreadAlerts} cảnh báo`
                    : "Không có cảnh báo mới"}
                </Badge>
              </div>
            </div>

            <div className="grid gap-3 bg-white/5 px-4 py-4 backdrop-blur-sm sm:grid-cols-3 sm:px-6">
              <div className="flex items-start gap-3 rounded-lg bg-white/10 px-3 py-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white/20 text-white">
                  <Activity className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-white/70">
                    Workflow gần nhất
                  </p>
                  <p className="mt-0.5 text-sm font-bold text-white">
                    {latestWorkflow?.name ?? "Chưa có lịch sử chạy"}
                  </p>
                  <p className="mt-0.5 text-xs text-white/60">
                    {formatDateTime(latestWorkflow?.latestRun?.startedAt)}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-lg bg-white/10 px-3 py-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white/20 text-white">
                  <Zap className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-white/70">
                    Tự động hóa
                  </p>
                  <p className="mt-0.5 text-sm font-bold text-white">
                    {summary.activeWorkflows} workflow đang bật
                  </p>
                  <p className="mt-0.5 text-xs text-white/60">
                    Tỷ lệ thành công {summary.workflowSuccessRate}%
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-lg bg-white/10 px-3 py-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white/20 text-white">
                  <Database className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-white/70">
                    Dữ liệu theo dõi
                  </p>
                  <p className="mt-0.5 text-sm font-bold text-white">
                    {summary.totalPackages} gói đã lưu
                  </p>
                  <p className="mt-0.5 text-xs text-white/60">
                    Cập nhật khi người dùng lưu kết quả.
                  </p>
                </div>
              </div>
            </div>
          </article>

          {/* Quick actions panel */}
          <article className="panel p-4 sm:p-5">
            <p className="section-title">Làm tiếp</p>
            <h2 className="mt-1 text-base font-bold text-slate-950">
              Lối đi nhanh
            </h2>
            <div className="mt-3 grid gap-2">
              {nextActions.map((action) => (
                <Link
                  key={action.href}
                  href={action.href}
                  className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 transition-colors duration-150 hover:border-sky-300 hover:bg-sky-50/70 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
                >
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${miniIconColorMap[action.icon]}`}
                  >
                    <MiniIcon name={action.icon} />
                  </span>
                  <span className="min-w-0 flex-1 text-sm font-bold text-slate-950">
                    {action.label}
                  </span>
                  <ChevronRight
                    className="h-4 w-4 shrink-0 text-slate-400"
                    aria-hidden
                  />
                </Link>
              ))}
            </div>
          </article>
        </section>

        {/* KPI row */}
        <section className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            label="Tổng gói thầu"
            value={summary.totalPackages}
            hint="Dữ liệu đang theo dõi"
            accent={true}
          />
          <KpiCard
            label="Cảnh báo chưa đọc"
            value={summary.unreadAlerts}
            hint={hasAttention ? "Cần xử lý sớm" : "Đang sạch"}
            trend={hasAttention ? "up" : undefined}
            accent={hasAttention}
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

        {/* Alerts & Workflow runs */}
        <section className="mt-4 grid gap-3 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="section-title">Cảnh báo mới</p>
              <Link
                href="/notifications"
                className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:underline"
              >
                <Bell className="h-3.5 w-3.5" aria-hidden />
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
                    href="/search/packages"
                    className="inline-flex items-center gap-1.5 rounded-md bg-sky-700 px-4 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-sky-800 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
                  >
                    <Search className="h-4 w-4" aria-hidden />
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

          {/* Workflow runs */}
          <article className="panel p-4">
            <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-2">
              <div>
                <p className="section-title">Lịch sử</p>
                <h2 className="mt-1 text-sm font-bold">
                  Workflow chạy gần đây
                </h2>
              </div>
              <Link
                href="/workflows"
                className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:underline"
              >
                <Workflow className="h-3.5 w-3.5" aria-hidden />
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
                    className={`rounded-lg border border-slate-200 border-l-4 bg-white px-3 py-3 ${workflowStatusBorder(workflow.latestRun?.status)}`}
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
      </div>
    </DashboardShell>
  );
}
