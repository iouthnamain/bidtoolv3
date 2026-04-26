import Link from "next/link";
import { AlertCard } from "~/app/_components/dashboard/alert-card";
import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { KpiCard } from "~/app/_components/dashboard/kpi-card";
import { EmptyState } from "~/app/_components/ui";
import { getDashboardSnapshot } from "~/app/_lib/dashboard-data";

function formatDateTime(value: string | null) {
  if (!value) {
    return "Chưa có";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("vi-VN");
}

export default async function DashboardPage() {
  const {
    summary,
    latestAlerts: alerts,
    recentWorkflowRuns,
    isDegraded,
  } = await getDashboardSnapshot();

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

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Tổng gói thầu"
          value={summary.totalPackages}
          hint="Dữ liệu đang theo dõi"
        />
        <KpiCard
          label="Cảnh báo chưa đọc"
          value={summary.unreadAlerts}
          hint="Cần xử lý sớm"
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

      <section className="mt-4 grid gap-3 sm:grid-cols-3">
        <Link
          href="/search"
          className="panel flex flex-col gap-1.5 p-4 transition-colors duration-150 hover:bg-slate-50"
        >
          <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
            Tìm kiếm
          </p>
          <p className="font-semibold text-slate-800">Tạo bộ lọc mới</p>
          <p className="text-xs text-slate-500">
            Tìm gói thầu theo từ khóa, tỉnh, lĩnh vực và ngân sách.
          </p>
        </Link>
        <Link
          href="/saved-items"
          className="panel flex flex-col gap-1.5 p-4 transition-colors duration-150 hover:bg-slate-50"
        >
          <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
            Chế độ xem
          </p>
          <p className="font-semibold text-slate-800">Bộ lọc đã lưu</p>
          <p className="text-xs text-slate-500">
            Xem lại và quản lý các bộ lọc đã lưu trước đó.
          </p>
        </Link>
        <Link
          href="/workflows"
          className="panel flex flex-col gap-1.5 p-4 transition-colors duration-150 hover:bg-slate-50"
        >
          <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
            Quy trình
          </p>
          <p className="font-semibold text-slate-800">Tạo workflow</p>
          <p className="text-xs text-slate-500">
            Tự động hóa tác vụ theo dõi và thông báo.
          </p>
        </Link>
        <Link
          href="/notifications"
          className="panel flex flex-col gap-1.5 p-4 transition-colors duration-150 hover:bg-slate-50"
        >
          <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
            Thông báo
          </p>
          <p className="font-semibold text-slate-800">Mở trung tâm cảnh báo</p>
          <p className="text-xs text-slate-500">
            Xem các cảnh báo mới tạo bởi workflow và đánh dấu đã xử lý.
          </p>
        </Link>
      </section>

      <section className="mt-4 grid gap-3 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-slate-900">Cảnh báo mới</h2>
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
                  className="inline-flex items-center rounded-lg bg-sky-700 px-4 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-sky-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
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
            <h2 className="text-sm font-bold">Workflow chạy gần đây</h2>
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
                    <p className="text-sm font-semibold text-slate-900">
                      {workflow.name}
                    </p>
                    <Link
                      href={`/workflows/${workflow.id}`}
                      className="text-xs font-semibold text-sky-700 hover:underline"
                    >
                      Chi tiết
                    </Link>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {workflow.latestRun?.status === "success"
                      ? "Thành công"
                      : workflow.latestRun?.status === "failed"
                        ? "Thất bại"
                        : "Đang chạy"}{" "}
                    • {formatDateTime(workflow.latestRun?.startedAt ?? null)}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    {workflow.latestRun?.message}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>
    </DashboardShell>
  );
}
