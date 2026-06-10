import { createPageMetadata } from "~/app/_lib/seo";
import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { SettingsPageClient } from "~/app/_components/dashboard/settings-page-client";

export const metadata = createPageMetadata({
  title: "Cài đặt",
  description:
    "Cấu hình ứng dụng, desktop client và môi trường vận hành BidTool v3.",
  path: "/settings",
  noIndex: true,
});

export default function SettingsPage() {
  return (
    <DashboardShell
      title="Cài đặt"
      description="Cấu hình ứng dụng và môi trường chạy"
    >
      <SettingsPageClient />
    </DashboardShell>
  );
}
