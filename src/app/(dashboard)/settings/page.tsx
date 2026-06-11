import { createPageMetadata } from "~/app/_lib/seo";
import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { SettingsPageClient } from "~/app/_components/dashboard/settings-page-client";

export const metadata = createPageMetadata({
  title: "Cài đặt",
  description:
    "Theo dõi phiên bản, cấu hình desktop client và áp dụng cập nhật BidTool v3.",
  path: "/settings",
  noIndex: true,
});

export default function SettingsPage() {
  return (
    <DashboardShell
      title="Cài đặt"
      description="Phiên bản, desktop client và cập nhật hệ thống"
    >
      <SettingsPageClient />
    </DashboardShell>
  );
}
