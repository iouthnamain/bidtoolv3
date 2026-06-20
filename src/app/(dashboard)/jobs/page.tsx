import { Suspense } from "react";

import { JobsListClient } from "~/app/_components/dashboard/jobs-list-client";
import { createPageMetadata } from "~/app/_lib/seo";

export const dynamic = "force-dynamic";

export const metadata = createPageMetadata({
  title: "Danh sách job",
  description:
    "Theo dõi mọi job nền: scrape shop, nhập catalog, đối chiếu Excel và enrich vật tư trong một danh sách thống nhất.",
  path: "/jobs",
  keywords: ["danh sách job", "job nền", "scrape", "enrich", "đối chiếu Excel"],
});

export default function JobsPage() {
  return (
    <Suspense
      fallback={
        <div className="panel p-5 text-sm text-slate-600">
          Đang tải danh sách job…
        </div>
      }
    >
      <JobsListClient />
    </Suspense>
  );
}
