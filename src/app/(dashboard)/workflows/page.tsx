import { Suspense } from "react";

import { createPageMetadata } from "~/app/_lib/seo";
import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { workflowSectionNavItems } from "~/app/_components/dashboard/page-nav-presets";
import { WorkflowsPageClient } from "~/app/_components/dashboard/workflows-page-client";
import { HydrateClient, api } from "~/trpc/server";

export const metadata = createPageMetadata({
  title: "Workflow tự động",
  description:
    "Tạo và quản lý workflow cảnh báo gói thầu mới từ Smart View, watchlist và bộ lọc tìm kiếm.",
  path: "/workflows",
  keywords: ["workflow đấu thầu", "tự động cảnh báo", "Smart View"],
});

function prefetchWorkflowsPageData() {
  void api.workflow.list.prefetch(undefined);
  void api.notification.list.prefetch({ limit: 5 });
}

export default function WorkflowsPage() {
  prefetchWorkflowsPageData();

  return (
    <DashboardShell
      title="Workflow tự động"
      description="Quản lý trigger, hành động và lịch sử chạy"
      sectionNavItems={workflowSectionNavItems}
      sectionNavTitle="Khu vực workflow"
    >
      <HydrateClient>
        <Suspense
          fallback={
            <div className="rounded-2xl border border-slate-200/80 bg-white/95 px-4 py-6 text-sm text-slate-600 shadow-sm">
              Đang tải dữ liệu workflow…
            </div>
          }
        >
          <WorkflowsPageClient />
        </Suspense>
      </HydrateClient>
    </DashboardShell>
  );
}
