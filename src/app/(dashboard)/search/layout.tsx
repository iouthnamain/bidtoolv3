import { Suspense } from "react";

import { SearchLayoutClient } from "~/app/_components/dashboard/search-layout-client";

export default function SearchLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SearchLayoutClient>
      <Suspense
        fallback={
          <div className="rounded border border-slate-400/80 bg-white/95 px-4 py-6 text-sm text-slate-600 shadow-sm">
            Đang tải dữ liệu tìm kiếm public…
          </div>
        }
      >
        {children}
      </Suspense>
    </SearchLayoutClient>
  );
}
