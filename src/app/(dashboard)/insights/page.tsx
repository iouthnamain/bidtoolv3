import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { KpiCard } from "~/app/_components/dashboard/kpi-card";
import { api } from "~/trpc/server";

export default async function InsightsPage() {
  const summary = await api.insight.getDashboardSummary();
  const trend = await api.insight.getMarketTrend({ days: 7 });

  return (
    <DashboardShell
      title="Báo cáo & Insights"
      description="Tổng hợp nhanh xu hướng thị trường và hiệu quả vận hành"
    >
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Tổng gói thầu" value={summary.totalPackages} />
        <KpiCard label="Cảnh báo chưa đọc" value={summary.unreadAlerts} />
        <KpiCard label="Workflow đang bật" value={summary.activeWorkflows} />
        <KpiCard
          label="Tỷ lệ workflow thành công"
          value={`${summary.workflowSuccessRate}%`}
        />
      </section>

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold">Xu hướng 7 ngày gần nhất</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {trend.map((row) => (
            <li
              key={row.date}
              className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2"
            >
              <span className="text-slate-700">{row.date}</span>
              <span className="font-medium text-slate-900">
                {row.newPackages} gói mới
              </span>
            </li>
          ))}
        </ul>
      </section>
    </DashboardShell>
  );
}
