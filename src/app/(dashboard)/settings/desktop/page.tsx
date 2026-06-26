import { createPageMetadata } from "~/app/_lib/seo";
import { DesktopSettingsSection } from "~/app/_components/dashboard/desktop-settings-page-client";
import { requireAdminRole } from "../require-page-permission";

export const metadata = createPageMetadata({
  title: "Ứng dụng desktop",
  description: "Cấu hình server URL cho BidTool desktop client.",
  path: "/settings/desktop",
  noIndex: true,
});

export default async function SettingsDesktopPage() {
  await requireAdminRole();

  return <DesktopSettingsSection />;
}
