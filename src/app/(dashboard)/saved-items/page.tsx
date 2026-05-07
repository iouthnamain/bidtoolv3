import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { SavedItemsPageClient } from "~/app/_components/dashboard/saved-items-page-client";
import { HydrateClient, api } from "~/trpc/server";

export default function SavedItemsPage() {
  void api.search.listSavedFilters.prefetch(undefined);
  void api.watchlist.listItems.prefetch(undefined);

  return (
    <DashboardShell
      title="Smart Views & Watchlist"
      description="Trang quản lý riêng cho bộ lọc đã lưu và danh sách theo dõi"
    >
      <HydrateClient>
        <SavedItemsPageClient />
      </HydrateClient>
    </DashboardShell>
  );
}
