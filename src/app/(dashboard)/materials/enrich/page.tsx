import { Suspense } from "react";

import { MaterialEnrichClient } from "~/app/_components/materials/enrich-client";
import { createPageMetadata } from "~/app/_lib/seo";

export const dynamic = "force-dynamic";

export const metadata = createPageMetadata({
  title: "Làm giàu vật tư",
  description:
    "Tìm kiếm web, bổ sung thông số và catalog PDF cho vật tư trong danh mục.",
  path: "/materials/enrich",
  keywords: ["làm giàu vật tư", "enrichment catalog", "bổ sung thông số vật tư"],
});

export default function MaterialEnrichPage() {
  return (
    <Suspense
      fallback={
        <div className="panel p-2 text-sm text-slate-600">
          Đang tải công cụ làm giàu vật tư…
        </div>
      }
    >
      <MaterialEnrichClient />
    </Suspense>
  );
}
