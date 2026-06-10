import { Suspense } from "react";

import { createPageMetadata } from "~/app/_lib/seo";
import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { materialsSectionNavItems } from "~/app/_components/dashboard/page-nav-presets";
import { MaterialScrapeClient } from "~/app/_components/materials/scrape-client";

export const dynamic = "force-dynamic";

export const metadata = createPageMetadata({
  title: "Scrape shop vật tư",
  description:
    "Chạy job scrape shop nhiều trang, theo dõi tiến độ rồi nhập sản phẩm vào catalog vật tư.",
  path: "/materials/scrape",
  keywords: ["scrape shop vật tư", "nhập catalog từ URL", "giá vật tư shop"],
});

export default function ScrapeMaterialsPage() {
  return (
    <DashboardShell
      title="Scrape shop vật tư"
      description="Chạy job nhiều trang, theo dõi tiến độ và duyệt sản phẩm trước khi nhập catalog"
      sectionNavItems={materialsSectionNavItems}
      sectionNavTitle="Khu vực vật tư"
    >
      <Suspense
        fallback={
          <div className="panel p-5 text-sm text-slate-600">
            Đang tải công cụ scrape shop…
          </div>
        }
      >
        <MaterialScrapeClient />
      </Suspense>
    </DashboardShell>
  );
}
