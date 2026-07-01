import { createPageMetadata } from "~/app/_lib/seo";
import { SearchSettingsSection } from "~/app/_components/dashboard/search-settings-section";
import { requirePagePermission } from "../require-page-permission";

export const metadata = createPageMetadata({
  title: "Tìm kiếm web",
  description:
    "Cấu hình SearXNG, domain ưu tiên và kiểm tra chất lượng tìm kiếm.",
  path: "/settings/search",
  noIndex: true,
});

export default async function SettingsSearchPage() {
  await requirePagePermission("settings:manage");

  return <SearchSettingsSection />;
}
