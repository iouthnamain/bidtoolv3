import { Building2, Search, ShieldCheck, Users, Workflow } from "lucide-react";

import { createPageMetadata } from "~/app/_lib/seo";
import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import {
  MetricStrip,
  QuickLaunchGrid,
  WorkQueuePanel,
} from "~/app/_components/dashboard/role-dashboard-widgets";
import { getRoleDashboardSnapshot } from "~/app/_lib/role-dashboard-data";

export const metadata = createPageMetadata({
  title: "Dashboard điều hành",
  description:
    "Theo dõi tổng quan gói thầu, cảnh báo, workflow và trạng thái vận hành trong BidTool v3.",
  path: "/dashboard",
  keywords: ["dashboard đấu thầu", "theo dõi gói thầu", "cảnh báo đấu thầu"],
});

export default async function DashboardPage() {
  const snapshot = await getRoleDashboardSnapshot();
  const { operations, governance } = snapshot;

  return (
    <DashboardShell
      title="Role dashboard launcher"
      description="Khi có role thật hoặc role preview, bạn sẽ được đưa sang /admin, /manager, /staff hoặc /portal. Màn hình này giữ trải nghiệm dev khi auth tắt và preview chưa chọn."
    >
      <div className="space-y-3">
        <MetricStrip
          metrics={[
            {
              label: "Users",
              value: governance.totalUsers,
              hint: "Chọn manager/admin preview để quản trị",
              tone: "info",
            },
            {
              label: "Materials",
              value: operations.totalMaterials,
              hint: "Chọn staff preview để vận hành",
              tone: "neutral",
            },
            {
              label: "Workflows",
              value: operations.activeWorkflows,
              hint: `${operations.failedWorkflowRuns} lần chạy lỗi`,
              tone: operations.failedWorkflowRuns > 0 ? "warning" : "success",
            },
            {
              label: "Alerts",
              value: operations.unreadAlerts,
              hint: "Thông báo chưa đọc",
              tone: operations.unreadAlerts > 0 ? "warning" : "success",
            },
          ]}
        />

        <div className="grid gap-1 xl:grid-cols-[0.95fr_1.05fr]">
          <WorkQueuePanel
            title="Role preview start"
            description="Dùng banner preview phía trên để chuyển sang dashboard riêng từng vai trò."
            items={snapshot.attentionQueue}
            emptyText="Chọn Admin, Manager, Staff hoặc Customer trên preview banner để vào đúng surface."
          />
          <QuickLaunchGrid
            items={[
              {
                href: "/admin",
                label: "Admin",
                description: "Command center quản trị.",
                icon: ShieldCheck,
              },
              {
                href: "/manager",
                label: "Manager",
                description: "Governance board.",
                icon: Users,
              },
              {
                href: "/staff",
                label: "Staff",
                description: "Operations board.",
                icon: Workflow,
              },
              {
                href: "/portal",
                label: "Customer",
                description: "Read-only portal.",
                icon: Building2,
              },
              {
                href: "/search/packages",
                label: "Tìm kiếm cũ",
                description: "Auth off/no preview vẫn dùng được.",
                icon: Search,
              },
            ]}
          />
        </div>
      </div>
    </DashboardShell>
  );
}
