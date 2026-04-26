import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { SavedItemsPageClient } from "~/app/_components/dashboard/saved-items-page-client";

export default function SavedItemsPage() {
  return (
    <DashboardShell
      title="Smart Views & Watchlist"
      description="Trang quản lý riêng cho bộ lọc đã lưu và danh sách theo dõi"
    >
      <SavedItemsPageClient />
    </DashboardShell>
  );
}
