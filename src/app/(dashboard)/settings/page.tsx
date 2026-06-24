import { createPageMetadata } from "~/app/_lib/seo";
import { MaterialProfileExportSettingsSection } from "~/app/_components/dashboard/material-profile-export-settings-section";
import { SettingsRoleOverview } from "~/app/_components/dashboard/settings-role-overview";
import { SettingsStatusStrip } from "~/app/_components/dashboard/settings-status-strip";

export const metadata = createPageMetadata({
  title: "Cài đặt",
  description:
    "Theo dõi phiên bản, cấu hình desktop client và áp dụng cập nhật BidTool v3.",
  path: "/settings",
  noIndex: true,
});

export default function SettingsPage() {
  return (
    <div className="space-y-5">
      <SettingsRoleOverview />
      <SettingsStatusStrip />
      <MaterialProfileExportSettingsSection />
    </div>
  );
}
