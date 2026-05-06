import { Suspense } from "react";

import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { SearchPageClient } from "~/app/_components/dashboard/search-page-client";

export default function SearchPage() {
  return (
    <DashboardShell
      title="Tìm kiếm public từ BidWinner"
      description="Một trung tâm tìm kiếm cho gói thầu, theo địa phương, ngành nghề & địa phương, KHLCNT và dự án đầu tư phát triển"
    >
      <Suspense
        fallback={
          <div className="rounded-2xl border border-slate-200/80 bg-white/95 px-4 py-6 text-sm text-slate-600 shadow-sm">
            Đang tải dữ liệu tìm kiếm public...
          </div>
        }
      >
        <SearchPageClient />
      </Suspense>
    </DashboardShell>
  );
}
