import { Suspense } from "react";

import { createPageMetadata } from "~/app/_lib/seo";
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
    <Suspense
      fallback={
        <div className="panel p-5 text-sm text-slate-600">
          Đang tải công cụ scrape shop…
        </div>
      }
    >
      <MaterialScrapeClient />
    </Suspense>
  );
}
