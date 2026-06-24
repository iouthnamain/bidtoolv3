import { Bot, Building2, ShieldCheck, Users } from "lucide-react";

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
  title: "Manager dashboard",
  description: "Dashboard governance cho quản lý người dùng, tenant và cấu hình.",
  path: "/manager",
  noIndex: true,
});

export default async function ManagerPage() {
  const snapshot = await getRoleDashboardSnapshot();
  const { governance } = snapshot;

  const governanceQueue = snapshot.attentionQueue.filter((item) =>
    item.id.startsWith("tenantless-"),
  );

  return (
    <RoleDashboardFrame
      role="manager"
      eyebrow="Governance dashboard"
      title="Manager governance board"
      description="Không gian quản lý tập trung vào user, tenant và cấu hình. Các tác vụ nghiệp vụ được cố ý ẩn khỏi dashboard này."
    >
      <MetricStrip
        metrics={[
          {
            label: "Users",
            value: governance.totalUsers,
            hint: `${governance.usersByRole.staff} staff · ${governance.usersByRole.customer} customer`,
            tone: "info",
          },
          {
            label: "Tenants",
            value: governance.totalTenants,
            hint: "Tổ chức khách hàng",
            tone: "neutral",
          },
          {
            label: "Customer chưa gán",
            value: governance.tenantlessCustomers,
            hint: "Cần gán tenant để portal có dữ liệu",
            tone: governance.tenantlessCustomers > 0 ? "warning" : "success",
          },
          {
            label: "Bị khóa",
            value: governance.bannedUsers,
            hint: "Tài khoản đang bị ban",
            tone: governance.bannedUsers > 0 ? "warning" : "success",
          },
        ]}
      />

      <div className="grid gap-3 xl:grid-cols-[0.95fr_1.05fr]">
        <WorkQueuePanel
          title="Governance queue"
          description="Các tài khoản cần hoàn thiện trước khi khách hàng dùng portal."
          items={governanceQueue}
          emptyText="Không có customer nào thiếu tenant."
        />
        <QuickLaunchGrid
          items={[
            {
              href: "/settings/users",
              label: "Quản lý người dùng",
              description: "Role, khóa/mở khóa và tenant assignment.",
              icon: Users,
            },
            {
              href: "/settings/tenants",
              label: "Quản lý tổ chức",
              description: "Tạo, đổi tên, kiểm tra tenant.",
              icon: Building2,
            },
            {
              href: "/settings/ai",
              label: "AI Providers",
              description: "Cấu hình khóa và provider AI.",
              icon: Bot,
            },
            {
              href: "/help/vai-tro",
              label: "Vai trò & quyền",
              description: "Ranh giới manager/staff/customer.",
              icon: ShieldCheck,
            },
          ]}
        />
      </div>

      <RoleBoundaryNotice
        title="Manager không làm nghiệp vụ"
        items={[
          "Không thấy Operations nav: search, materials, scrape, enrich, workflow.",
          "Không chạy job hoặc sửa catalog vật tư.",
          "Tập trung vào quyền truy cập, tenant, cấu hình và chuẩn bị customer portal.",
        ]}
      />
    </RoleDashboardFrame>
  );
}
