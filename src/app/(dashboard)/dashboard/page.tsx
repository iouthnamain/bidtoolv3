import { AlertCard } from "~/app/_components/dashboard/alert-card";
import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { KpiCard } from "~/app/_components/dashboard/kpi-card";
import { api } from "~/trpc/server";

export default async function DashboardPage() {
  const summary = await api.insight.getDashboardSummary();
  const alerts = await api.notification.list({ limit: 3 });

  return (
    <DashboardShell
      title="Tổng quan điều hành"
      description="Theo dõi nhanh KPI, cảnh báo và trạng thái automation"
    >
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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

      <section className="mt-6 grid gap-4">
        {alerts.map((item) => (
          <AlertCard
            key={item.id}
            title={item.title}
            body={item.body}
            severity={item.severity}
          />
        ))}
      </section>
    </DashboardShell>
  );
}
