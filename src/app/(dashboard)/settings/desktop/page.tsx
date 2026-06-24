import { createPageMetadata } from "~/app/_lib/seo";
import { DesktopSettingsSection } from "~/app/_components/dashboard/desktop-settings-page-client";
import { requireAdminRole } from "../require-page-permission";

export const metadata = createPageMetadata({
  title: "Desktop client",
  description: "Cấu hình server URL cho BidTool desktop client.",
  path: "/settings/desktop",
  noIndex: true,
});

export default async function SettingsDesktopPage() {
  await requireAdminRole();

  return <DesktopSettingsSection />;
}
