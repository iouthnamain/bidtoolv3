import { createPageMetadata } from "~/app/_lib/seo";
import { DesktopSettingsSection } from "~/app/_components/dashboard/desktop-settings-page-client";

export const metadata = createPageMetadata({
  title: "Desktop client",
  description: "Cấu hình server URL cho BidTool desktop client.",
  path: "/settings/desktop",
  noIndex: true,
});

export default function SettingsDesktopPage() {
  return <DesktopSettingsSection />;
}
