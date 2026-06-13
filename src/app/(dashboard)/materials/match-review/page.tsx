import { Suspense } from "react";

import { createPageMetadata } from "~/app/_lib/seo";
import { MatchReviewClient } from "~/app/_components/materials/match-review-client";

export const dynamic = "force-dynamic";

export const metadata = createPageMetadata({
  title: "Xét duyệt ghép sản phẩm",
  description:
    "Xem và xét duyệt các đề xuất ghép sản phẩm scrape với vật tư catalog dựa trên độ tương tự.",
  path: "/materials/match-review",
  keywords: ["ghép sản phẩm", "AI match", "xét duyệt vật tư"],
});

export default function MatchReviewPage() {
  return (
    <Suspense
      fallback={
        <div className="panel p-5 text-sm text-slate-600">
          Đang tải danh sách ghép…
        </div>
      }
    >
      <MatchReviewClient />
    </Suspense>
  );
}
