import { createPageMetadata } from "~/app/_lib/seo";
import { WorkflowAlertsClient } from "~/app/_components/dashboard/workflow-alerts-client";
import { HydrateClient, api } from "~/trpc/server";

export const metadata = createPageMetadata({
  title: "Thông báo workflow",
  description:
    "Xem cảnh báo gần đây được tạo ra từ các lần chạy workflow trong BidTool v3.",
  path: "/workflows/alerts",
  keywords: ["thông báo workflow", "cảnh báo đấu thầu"],
});

function prefetchWorkflowAlertsData() {
  void api.notification.list.prefetch({ limit: 5 });
}

export default function WorkflowAlertsPage() {
  prefetchWorkflowAlertsData();

  return (
    <HydrateClient>
      <WorkflowAlertsClient />
    </HydrateClient>
  );
}
