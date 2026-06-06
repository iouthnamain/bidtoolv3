import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { savedItemsSectionNavItems } from "~/app/_components/dashboard/page-nav-presets";
import { SavedItemsPageClient } from "~/app/_components/dashboard/saved-items-page-client";

export default function SavedItemsPage() {
  return (
    <DashboardShell
      title="Smart Views & Watchlist"
      description="Trang quản lý riêng cho bộ lọc đã lưu và danh sách theo dõi"
      sectionNavItems={savedItemsSectionNavItems}
      sectionNavTitle="Khu vực theo dõi"
    >
      <SavedItemsPageClient />
    </DashboardShell>
  );
}
