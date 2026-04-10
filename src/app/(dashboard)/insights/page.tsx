import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { KpiCard } from "~/app/_components/dashboard/kpi-card";
import { api } from "~/trpc/server";

export default async function InsightsPage() {
  const summary = await api.insight.getDashboardSummary();
  const trend = await api.insight.getMarketTrend({ days: 7 });
  const maxPackages = Math.max(1, ...trend.map((row) => row.newPackages));
  const latestVsPrev = (trend[0]?.newPackages ?? 0) - (trend[1]?.newPackages ?? 0);

  return (
    <DashboardShell
      title="Insights & Trends"
      description="Market overview and operational metrics"
    >
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total Packages" value={summary.totalPackages} trend={latestVsPrev > 0 ? "up" : "down"} />
        <KpiCard label="Unread Alerts" value={summary.unreadAlerts} />
        <KpiCard label="Active Workflows" value={summary.activeWorkflows} />
        <KpiCard
          label="Success Rate"
          value={`${summary.workflowSuccessRate}%`}
          trend={summary.workflowSuccessRate >= 90 ? "up" : "down"}
        />
      </section>

      <section className="panel mt-4 p-3">
        <h2 className="border-b border-slate-200 pb-2 text-sm font-bold">7-Day Trend</h2>
        <ul className="mt-2 space-y-2 text-xs">
          {trend.map((row, idx) => {
            const prevRow = idx > 0 ? trend[idx - 1] : null;
            const change = prevRow ? row.newPackages - prevRow.newPackages : 0;
            const pctChange = prevRow ? Math.round((change / prevRow.newPackages) * 100) : 0;
            return (
              <li key={row.date} className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 transition-colors hover:bg-slate-100">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="font-semibold text-slate-900">{row.date}</span>
                  <div className="flex items-center gap-1">
                    <span className="font-bold text-slate-900">{row.newPackages}</span>
                    {change !== 0 && (
                      <span className={`text-xs font-bold ${change > 0 ? "text-emerald-600" : "text-rose-600"}`}>
                        {change > 0 ? "+" : ""}{pctChange}%
                      </span>
                    )}
                  </div>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-300">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-sky-600 transition-all"
                    style={{ width: `${Math.max(3, (row.newPackages / maxPackages) * 100)}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </DashboardShell>
  );
}
