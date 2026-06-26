import { createPageMetadata } from "~/app/_lib/seo";
import { WorkflowsListClient } from "~/app/_components/dashboard/workflows-list-client";
import { HydrateClient, api } from "~/trpc/server";

export const metadata = createPageMetadata({
  title: "Quy trình tự động",
  description:
    "Tạo và quản lý workflow cảnh báo gói thầu mới từ bộ lọc thông minh, watchlist và bộ lọc tìm kiếm.",
  path: "/workflows",
  keywords: ["workflow đấu thầu", "tự động cảnh báo", "Bộ lọc thông minh"],
});

function prefetchWorkflowsListData() {
  void api.workflow.list.prefetch(undefined);
}

export default function WorkflowsPage() {
  prefetchWorkflowsListData();

  return (
    <HydrateClient>
      <WorkflowsListClient />
    </HydrateClient>
  );
}
