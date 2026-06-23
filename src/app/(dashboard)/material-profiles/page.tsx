import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { MaterialProfilesClient } from "~/app/_components/material-profiles/material-profiles-client";
import { createPageMetadata } from "~/app/_lib/seo";

export const metadata = createPageMetadata({
  title: "Hồ sơ vật tư",
  description:
    "Tập hợp hồ sơ vật tư, lối tắt tạo mới và danh sách công việc liên quan đến catalog vật tư trong BidTool v3.",
  path: "/material-profiles",
  keywords: ["hồ sơ vật tư", "catalog vật tư", "quản lý vật tư"],
});

export default function MaterialProfilesPage() {
  return (
    <DashboardShell
      title="Hồ sơ vật tư"
      description="Bắt đầu tạo hồ sơ vật tư mới hoặc quay lại các danh sách vật tư đã có."
    >
      <MaterialProfilesClient />
    </DashboardShell>
  );
}
