import { Suspense } from "react";

import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { SavedItemsPageClient } from "~/app/_components/dashboard/saved-items-page-client";

export default function SavedItemsPage() {
  return (
    <DashboardShell
      title="Smart Views & Watchlist"
      description="Trang quản lý riêng cho bộ lọc đã lưu và danh sách theo dõi"
    >
      <Suspense
        fallback={
          <div className="rounded-2xl border border-slate-200/80 bg-white/95 px-4 py-6 text-sm text-slate-600 shadow-sm">
            Đang tải dữ liệu đã lưu...
          </div>
        }
      >
        <SavedItemsPageClient />
      </Suspense>
    </DashboardShell>
  );
}
