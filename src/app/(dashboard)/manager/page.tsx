import { Bot, Building2, Users } from "lucide-react";

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
  title: "Bảng điều khiển quản lý",
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
      eyebrow="Bảng điều khiển điều hành"
      title="Bảng điều hành quản lý"
      description="Không gian quản lý tập trung vào người dùng, tổ chức và cấu hình. Các tác vụ nghiệp vụ được cố ý ẩn khỏi bảng điều khiển này."
    >
      <MetricStrip
        metrics={[
          {
            label: "Người dùng",
            value: governance.totalUsers,
            hint: `${governance.usersByRole.staff} staff · ${governance.usersByRole.customer} customer`,
            tone: "info",
          },
          {
            label: "Tổ chức",
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

      <div className="grid gap-1 xl:grid-cols-[0.95fr_1.05fr]">
        <WorkQueuePanel
          title="Hàng đợi điều hành"
          description="Các tài khoản cần hoàn thiện trước khi khách hàng dùng portal."
          items={governanceQueue}
          emptyText="Không có customer nào thiếu tenant."
        />
        <QuickLaunchGrid
          items={[
            {
              href: "/settings/users",
              label: "Quản lý người dùng",
              description: "Vai trò, khóa/mở khóa và gán tổ chức.",
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
          ]}
        />
      </div>

      <RoleBoundaryNotice
        title="Manager không làm nghiệp vụ"
        items={[
          "Không thấy menu vận hành: tìm kiếm, vật tư, quét shop, làm giàu, quy trình.",
          "Không chạy job hoặc sửa catalog vật tư.",
          "Tập trung vào quyền truy cập, tenant, cấu hình và chuẩn bị customer portal.",
        ]}
      />
    </RoleDashboardFrame>
  );
}
