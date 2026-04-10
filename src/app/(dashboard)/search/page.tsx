import { Suspense } from "react";

import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { SearchPageClient } from "~/app/_components/dashboard/search-page-client";

export default function SearchPage() {
  return (
    <DashboardShell
      title="Tìm kiếm realtime từ BidWinner"
      description="Lọc dữ liệu realtime, xem trước kết quả và chỉ lưu các gói bạn chọn"
    >
      <Suspense
        fallback={
          <div className="rounded-2xl border border-slate-200/80 bg-white/95 px-4 py-6 text-sm text-slate-600 shadow-sm">
            Đang tải dữ liệu tìm kiếm realtime...
          </div>
        }
      >
        <SearchPageClient />
      </Suspense>
    </DashboardShell>
  );
}
