import { createPageMetadata } from "~/app/_lib/seo";
import { AboutVersionSection } from "~/app/_components/dashboard/about-version-section";

export const metadata = createPageMetadata({
  title: "Cập nhật BidTool",
  description: "Áp dụng bản mới và xem ghi chú phát hành BidTool v3.",
  path: "/settings/updates",
  noIndex: true,
});

export default function SettingsUpdatesPage() {
  return <AboutVersionSection />;
}
