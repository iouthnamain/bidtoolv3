import { createPageMetadata } from "~/app/_lib/seo";
import { WorkflowHealthClient } from "~/app/_components/dashboard/workflow-health-client";
import { HydrateClient, api } from "~/trpc/server";

export const metadata = createPageMetadata({
  title: "Trạng thái workflow",
  description:
    "Xem tổng quan workflow đang hoạt động, tạm dừng, cần xem lại và chưa từng chạy.",
  path: "/workflows/health",
  keywords: ["trạng thái workflow", "workflow đấu thầu"],
});

function prefetchWorkflowHealthData() {
  void api.workflow.list.prefetch(undefined);
}

export default function WorkflowHealthPage() {
  prefetchWorkflowHealthData();

  return (
    <HydrateClient>
      <WorkflowHealthClient />
    </HydrateClient>
  );
}
