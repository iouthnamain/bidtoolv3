import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { KpiCard } from "~/app/_components/dashboard/kpi-card";
import { api } from "~/trpc/server";

export default async function InsightsPage() {
  const [summary, trend, workflowHealth, topSignals] = await Promise.all([
    api.insight.getDashboardSummary(),
    api.insight.getMarketTrend({ days: 7 }),
    api.insight.getWorkflowHealth(),
    api.insight.getTopTenderSignals({ limit: 5 }),
  ]);
  const maxPackages = Math.max(1, ...trend.map((row) => row.newPackages));
  const latestVsPrev =
    (trend[0]?.newPackages ?? 0) - (trend[1]?.newPackages ?? 0);

  return (
    <DashboardShell
      title="Insights & Xu hướng"
      description="Tổng quan thị trường và chỉ số vận hành"
    >
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Tổng gói thầu"
          value={summary.totalPackages}
          trend={latestVsPrev > 0 ? "up" : "down"}
        />
        <KpiCard label="Cảnh báo chưa đọc" value={summary.unreadAlerts} />
        <KpiCard label="Workflow đang chạy" value={summary.activeWorkflows} />
        <KpiCard
          label="Tỉ lệ thành công"
          value={`${summary.workflowSuccessRate}%`}
          trend={summary.workflowSuccessRate >= 90 ? "up" : "down"}
        />
      </section>

      <section className="panel mt-4 p-3">
        <h2 className="border-b border-slate-200 pb-2 text-sm font-bold">
          Xu hướng 7 ngày
        </h2>
        <ul className="mt-2 space-y-2 text-xs">
          {trend.map((row, idx) => {
            const prevRow = idx > 0 ? trend[idx - 1] : null;
            const change = prevRow ? row.newPackages - prevRow.newPackages : 0;
            const pctChange = prevRow
              ? Math.round((change / prevRow.newPackages) * 100)
              : 0;
            return (
              <li
                key={row.date}
                className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 transition-colors duration-150 hover:bg-slate-100"
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900">
                    {row.date}
                  </span>
                  <div className="flex items-center gap-1">
                    <span className="font-bold text-slate-900">
                      {row.newPackages}
                    </span>
                    {change !== 0 && (
                      <span
                        className={`text-xs font-bold ${change > 0 ? "text-emerald-600" : "text-rose-600"}`}
                      >
                        {change > 0 ? "+" : ""}
                        {pctChange}%
                      </span>
                    )}
                  </div>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-300">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-sky-600 transition-all"
                    style={{
                      width: `${Math.max(3, (row.newPackages / maxPackages) * 100)}%`,
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mt-4 grid gap-3 lg:grid-cols-[0.9fr_1.1fr]">
        <article className="panel p-4">
          <h2 className="border-b border-slate-200 pb-2 text-sm font-bold">
            Sức khoẻ workflow
          </h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {workflowHealth.healthy} workflow ổn định
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              {workflowHealth.inactive} workflow tạm dừng
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {workflowHealth.attention} workflow cần xem lại
            </div>
            <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">
              {workflowHealth.neverRan} workflow chưa từng chạy
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Tỷ lệ thành công toàn hệ thống: {workflowHealth.successRate}%
          </p>
        </article>

        <article className="panel p-4">
          <h2 className="border-b border-slate-200 pb-2 text-sm font-bold">
            Top tín hiệu thị trường
          </h2>

          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <div>
              <h3 className="text-xs font-semibold tracking-[0.14em] text-slate-500 uppercase">
                Bên mời thầu nổi bật
              </h3>
              <ul className="mt-2 space-y-2">
                {topSignals.inviters.map((item) => (
                  <li
                    key={item.name}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                  >
                    <p className="text-sm font-semibold text-slate-900">
                      {item.name}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {item.packageCount} gói •{" "}
                      {item.totalBudget.toLocaleString("vi-VN")} VNĐ
                    </p>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="text-xs font-semibold tracking-[0.14em] text-slate-500 uppercase">
                Lĩnh vực nổi bật
              </h3>
              <ul className="mt-2 space-y-2">
                {topSignals.categories.map((item) => (
                  <li
                    key={item.name}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                  >
                    <p className="text-sm font-semibold text-slate-900">
                      {item.name}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {item.packageCount} gói •{" "}
                      {item.totalBudget.toLocaleString("vi-VN")} VNĐ
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </article>
      </section>
    </DashboardShell>
  );
}
