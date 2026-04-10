import { Suspense } from "react";

import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { WorkflowsPageClient } from "~/app/_components/dashboard/workflows-page-client";

export default function WorkflowsPage() {
  return (
    <DashboardShell
      title="Workflow tự động"
      description="Quản lý trigger, hành động và lịch sử chạy"
    >
      <Suspense fallback={<p>Đang tải workflows...</p>}>
        <WorkflowsPageClient />
      </Suspense>
    </DashboardShell>
  );
}
