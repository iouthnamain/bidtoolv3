import { createPageMetadata } from "~/app/_lib/seo";
import { DesktopSettingsPageClient } from "~/app/_components/dashboard/desktop-settings-page-client";

export const metadata = createPageMetadata({
  title: "Desktop client",
  description:
    "Cấu hình client desktop BidTool v3 cho môi trường vận hành cục bộ.",
  path: "/desktop",
  noIndex: true,
});

export default function DesktopSettingsPage() {
  return <DesktopSettingsPageClient />;
}
