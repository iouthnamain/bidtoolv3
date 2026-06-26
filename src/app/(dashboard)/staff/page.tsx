import {
  Boxes,
  FileSpreadsheet,
  Search,
  Sparkles,
  Workflow,
} from "lucide-react";

import { createPageMetadata } from "~/app/_lib/seo";
import {
  MetricStrip,
  QuickLaunchGrid,
  RoleBoundaryNotice,
  RoleDashboardFrame,
  WorkQueuePanel,
} from "~/app/_components/dashboard/role-dashboard-widgets";
import { getRoleDashboardSnapshot } from "~/app/_lib/role-dashboard-data";

export const metadata = createPageMetadata({
  title: "Bảng điều khiển nhân viên",
  description: "Dashboard vận hành cho tìm kiếm, vật tư, workflow và job.",
  path: "/staff",
  noIndex: true,
});

function pct(value: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}

export default async function StaffPage() {
  const snapshot = await getRoleDashboardSnapshot();
  const { operations } = snapshot;

  return (
    <RoleDashboardFrame
      role="staff"
      eyebrow="Bảng điều khiển vận hành"
      title="Bảng vận hành nhân viên"
      description="Bảng điều khiển nghiệp vụ dày thông tin: cảnh báo, sức khỏe vật tư/catalog, job đang chạy và lối tắt tác vụ."
    >
      <MetricStrip
        metrics={[
          {
            label: "Cảnh báo",
            value: operations.unreadAlerts,
            hint: "Thông báo chưa đọc",
            tone: operations.unreadAlerts > 0 ? "warning" : "success",
          },
          {
            label: "Vật tư",
            value: operations.totalMaterials,
            hint: `${pct(operations.pricedMaterials, operations.totalMaterials)} có giá`,
            tone: "info",
          },
          {
            label: "Thư viện catalog PDF",
            value: operations.totalCatalogDocuments,
            hint: `${operations.catalogLinkedMaterials} vật tư có link catalog`,
            tone: "neutral",
          },
          {
            label: "Quy trình",
            value: operations.activeWorkflows,
            hint: `${operations.totalWorkflows} tổng workflow`,
            tone: operations.failedWorkflowRuns > 0 ? "warning" : "success",
          },
          {
            label: "Job đang chạy",
            value: operations.activeJobs,
            hint: `${operations.failedJobs} job lỗi`,
            tone: operations.failedJobs > 0 ? "critical" : "success",
          },
          {
            label: "Gói thầu",
            value: operations.totalPackages,
            hint: "Gói đã lưu",
            tone: "neutral",
          },
        ]}
      />

      <div className="grid gap-1 xl:grid-cols-[1.05fr_0.95fr]">
        <WorkQueuePanel
          title="Hàng đợi công việc"
          description="Cảnh báo và lỗi vận hành cần xử lý trước."
          items={snapshot.attentionQueue.filter(
            (item) => !item.id.startsWith("tenantless-"),
          )}
        />
        <QuickLaunchGrid
          items={[
            {
              href: "/search/packages",
              label: "Tìm gói thầu",
              description: "Tìm kiếm và lưu bộ lọc thông minh.",
              icon: Search,
            },
            {
              href: "/materials",
              label: "Catalog vật tư",
              description: "Mở danh mục, giá và catalog PDF.",
              icon: Boxes,
            },
            {
              href: "/materials/scrape",
              label: "Quét cửa hàng",
              description: "Lấy dữ liệu sản phẩm từ shop.",
              icon: Search,
            },
            {
              href: "/enrich",
              label: "Đối chiếu Excel",
              description: "Ghép catalog và điền file.",
              icon: FileSpreadsheet,
            },
            {
              href: "/materials/enrich",
              label: "Làm giàu vật tư",
              description: "Tìm web, PDF và thông số.",
              icon: Sparkles,
            },
            {
              href: "/workflows",
              label: "Quy trình",
              description: "Chạy, tạm dừng và kiểm tra automation.",
              icon: Workflow,
            },
          ]}
        />
      </div>

      <WorkQueuePanel
        title="Hoạt động gần đây"
        description="Thông báo mới nhất để staff quay lại bối cảnh nhanh."
        items={snapshot.recentAlerts}
        emptyText="Chưa có hoạt động mới."
      />

      <RoleBoundaryNotice
        title="Staff không quản trị hệ thống"
        items={[
          "Không thấy user/tenant management, AI provider settings hoặc cập nhật on-prem.",
          "Nếu cần đổi quyền hoặc tenant, chuyển yêu cầu cho manager/admin.",
          "Dashboard này tối ưu cho tốc độ thao tác nghiệp vụ.",
        ]}
      />
    </RoleDashboardFrame>
  );
}
