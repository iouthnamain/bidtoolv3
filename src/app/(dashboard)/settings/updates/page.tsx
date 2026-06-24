import { createPageMetadata } from "~/app/_lib/seo";
import { AboutVersionSection } from "~/app/_components/dashboard/about-version-section";
import { requirePagePermission } from "../require-page-permission";

export const metadata = createPageMetadata({
  title: "Cập nhật BidTool",
  description: "Áp dụng bản mới và xem ghi chú phát hành BidTool v3.",
  path: "/settings/updates",
  noIndex: true,
});

export default async function SettingsUpdatesPage() {
  await requirePagePermission("onprem:admin");

  return <AboutVersionSection />;
}
