import { AlertCard } from "~/app/_components/dashboard/alert-card";
import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { KpiCard } from "~/app/_components/dashboard/kpi-card";
import { getDashboardSnapshot } from "~/app/_lib/dashboard-data";

export default async function DashboardPage() {
  const {
    summary,
    latestAlerts: alerts,
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

      <section className="mt-4 grid gap-3">
        {alerts.length === 0 ? (
          <article className="panel p-5 text-sm text-slate-600">
            Chưa có cảnh báo mới. Hệ thống sẽ hiển thị cảnh báo tại đây khi
            workflow tạo sự kiện.
          </article>
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
      </section>
    </DashboardShell>
  );
}
