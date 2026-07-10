import { Boxes, FileSpreadsheet, Search, Workflow } from "lucide-react";

import { createPageMetadata } from "~/app/_lib/seo";
import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import {
  MetricStrip,
  QuickLaunchGrid,
  WorkQueuePanel,
} from "~/app/_components/dashboard/role-dashboard-widgets";
import { getRoleDashboardSnapshot } from "~/app/_lib/role-dashboard-data";

export const metadata = createPageMetadata({
  title: "Bảng điều hành",
  description:
    "Theo dõi vật tư, catalog, job và quy trình vận hành trong BidTool.",
  path: "/dashboard",
  keywords: ["dashboard đấu thầu", "vật tư", "catalog", "quy trình"],
});

export default async function DashboardPage() {
  const snapshot = await getRoleDashboardSnapshot();
  const { operations } = snapshot;

  return (
    <DashboardShell
      title="Bảng điều hành"
      description="Không gian local một người dùng để theo dõi công việc và đi nhanh tới các luồng chính."
    >
      <div className="space-y-3">
        <MetricStrip
          metrics={[
            {
              label: "Vật tư",
              value: operations.totalMaterials,
              hint: `${operations.pricedMaterials} vật tư đã có giá`,
              tone: "info",
            },
            {
              label: "Catalog PDF",
              value: operations.totalCatalogDocuments,
              hint: `${operations.catalogLinkedMaterials} vật tư đã liên kết`,
              tone: "neutral",
            },
            {
              label: "Job đang chạy",
              value: operations.activeJobs,
              hint: `${operations.failedJobs} job lỗi`,
              tone: operations.failedJobs > 0 ? "critical" : "success",
            },
            {
              label: "Quy trình",
              value: operations.activeWorkflows,
              hint: `${operations.failedWorkflowRuns} lần chạy lỗi`,
              tone: operations.failedWorkflowRuns > 0 ? "warning" : "success",
            },
          ]}
        />

        <div className="grid gap-1 xl:grid-cols-[0.95fr_1.05fr]">
          <WorkQueuePanel
            title="Cần chú ý"
            description="Cảnh báo và lỗi vận hành cần được xử lý trước."
            items={snapshot.attentionQueue}
            emptyText="Chưa có việc nào cần xử lý."
          />
          <QuickLaunchGrid
            items={[
              {
                href: "/material-profiles",
                label: "Hồ sơ vật tư",
                description: "Nhập sheet, tự tìm và tải danh mục chuẩn.",
                icon: FileSpreadsheet,
              },
              {
                href: "/materials",
                label: "Danh mục vật tư",
                description: "Quản lý sản phẩm, giá, nguồn và catalog.",
                icon: Boxes,
              },
              {
                href: "/search/packages",
                label: "Tìm gói thầu",
                description: "Tìm kiếm và lưu bộ lọc thông minh.",
                icon: Search,
              },
              {
                href: "/workflows",
                label: "Quy trình",
                description: "Theo dõi workflow và các lần chạy.",
                icon: Workflow,
              },
            ]}
          />
        </div>
      </div>
    </DashboardShell>
  );
}
