import { Bot, Building2, Download, ShieldCheck, Users, Workflow } from "lucide-react";

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
  title: "Quản trị",
  description: "Trung tâm quản trị người dùng, tổ chức, AI và cập nhật.",
  path: "/admin",
  noIndex: true,
});

export default async function AdminPage() {
  const snapshot = await getRoleDashboardSnapshot();
  const { governance, operations, version } = snapshot;

  return (
    <RoleDashboardFrame
      role="admin"
      eyebrow="Command dashboard"
      title="Admin command center"
      description="Một màn hình dày thông tin cho quản trị: user, tenant, trạng thái hệ thống và rủi ro vận hành cần xử lý."
    >
      <MetricStrip
        metrics={[
          {
            label: "Users",
            value: governance.totalUsers,
            hint: `${governance.usersByRole.admin} admin · ${governance.usersByRole.manager} manager`,
            tone: "info",
          },
          {
            label: "Tenants",
            value: governance.totalTenants,
            hint: `${governance.tenantlessCustomers} customer chưa gán tenant`,
            tone: governance.tenantlessCustomers > 0 ? "warning" : "success",
          },
          {
            label: "Operations",
            value: operations.totalMaterials,
            hint: `${operations.totalPackages} gói · ${operations.totalCatalogDocuments} PDF`,
            tone: "neutral",
          },
          {
            label: "Jobs",
            value: operations.activeJobs,
            hint: `${operations.failedJobs} job lỗi`,
            tone: operations.failedJobs > 0 ? "critical" : "success",
          },
          {
            label: "Workflows",
            value: operations.activeWorkflows,
            hint: `${operations.failedWorkflowRuns} lần chạy lỗi`,
            tone: operations.failedWorkflowRuns > 0 ? "warning" : "success",
          },
          {
            label: "Version",
            value: version?.current ?? "N/A",
            hint: version?.surface ?? "Không đọc được",
            tone: version?.updateAvailable ? "warning" : "neutral",
          },
        ]}
      />

      <div className="grid gap-3 xl:grid-cols-[1.1fr_0.9fr]">
        <WorkQueuePanel
          title="Attention needed"
          description="Rủi ro tổng hợp từ workflow, user/tenant và thông báo chưa đọc."
          items={snapshot.attentionQueue}
        />
        <QuickLaunchGrid
          items={[
            {
              href: "/settings/users",
              label: "Người dùng",
              description: "Tạo, phân quyền, khóa tài khoản.",
              icon: Users,
            },
            {
              href: "/settings/tenants",
              label: "Tổ chức",
              description: "Gán customer vào tenant.",
              icon: Building2,
            },
            {
              href: "/settings/ai",
              label: "AI Providers",
              description: "API key và model mặc định.",
              icon: Bot,
            },
            {
              href: "/settings/updates",
              label: "Cập nhật",
              description: "Kiểm tra và áp dụng bản mới.",
              icon: Download,
            },
            {
              href: "/workflows",
              label: "Workflow",
              description: "Kiểm tra automation lỗi.",
              icon: Workflow,
            },
            {
              href: "/help/vai-tro",
              label: "Vai trò",
              description: "Xem lại ranh giới quyền.",
              icon: ShieldCheck,
            },
          ]}
        />
      </div>

      <RoleBoundaryNotice
        title="Admin nhìn thấy cả governance và operations"
        items={[
          "Dùng Administration cho user, tenant, AI, cập nhật và desktop.",
          "Dùng Operations khi cần can thiệp nghiệp vụ như staff.",
          "Các cảnh báo ở đây là hàng đợi ưu tiên, không thay thế kiểm tra chi tiết từng module.",
        ]}
      />
    </RoleDashboardFrame>
  );
}
