import { Suspense } from "react";

import { EnrichJobsClient } from "~/app/_components/enrich/enrich-jobs-client";
import { createPageMetadata } from "~/app/_lib/seo";

export const dynamic = "force-dynamic";

export const metadata = createPageMetadata({
  title: "Job nghiên cứu Excel",
  description:
    "Xem và tiếp tục các job nghiên cứu sản phẩm trên web đã tạo từ đối chiếu Excel.",
  path: "/enrich/jobs",
  keywords: ["job nghiên cứu Excel", "excel research", "nghiên cứu web"],
});

export default function EnrichJobsPage() {
  return (
    <Suspense
      fallback={
        <div className="panel p-5 text-sm text-slate-600">
          Đang tải danh sách job…
        </div>
      }
    >
      <EnrichJobsClient />
    </Suspense>
  );
}
