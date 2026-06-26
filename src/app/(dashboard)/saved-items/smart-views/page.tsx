import { createPageMetadata } from "~/app/_lib/seo";
import { SavedFiltersSection } from "~/app/_components/dashboard/saved-filters-section";

export const metadata = createPageMetadata({
  title: "Bộ lọc thông minh",
  description:
    "Quản lý bộ lọc đã lưu, áp dụng lại điều kiện tìm kiếm và tạo workflow cảnh báo trong BidTool v3.",
  path: "/saved-items/smart-views",
  keywords: ["Bộ lọc thông minh", "bộ lọc đã lưu", "tìm kiếm đấu thầu"],
});

export default function SmartViewsPage() {
  return <SavedFiltersSection />;
}
