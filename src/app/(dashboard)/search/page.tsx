import { Suspense } from "react";

import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { SearchPageClient } from "~/app/_components/dashboard/search-page-client";

export default function SearchPage() {
  return (
    <DashboardShell
      title="Tìm kiếm tùy chỉnh"
      description="Tạo bộ lọc thông minh và theo dõi gói thầu phù hợp"
    >
      <Suspense fallback={<p>Đang tải dữ liệu tìm kiếm...</p>}>
        <SearchPageClient />
      </Suspense>
    </DashboardShell>
  );
}
