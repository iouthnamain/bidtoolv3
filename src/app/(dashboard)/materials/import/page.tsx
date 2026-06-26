import { Suspense } from "react";

import { createPageMetadata } from "~/app/_lib/seo";
import { MaterialImportClient } from "~/app/_components/materials/import-client";

export const dynamic = "force-dynamic";

export const metadata = createPageMetadata({
  title: "Nhập catalog vật tư",
  description:
    "Tải file Excel hoặc dán CSV, xem trước sau khi tải lên và nhập hàng loạt catalog vật tư.",
  path: "/materials/import",
  keywords: ["nhập vật tư Excel", "preview Excel", "import catalog vật tư"],
});

export default function ImportMaterialsPage() {
  return (
    <Suspense
      fallback={
        <div className="panel p-2 text-sm text-slate-600">
          Đang tải công cụ nhập vật tư…
        </div>
      }
    >
      <MaterialImportClient />
    </Suspense>
  );
}
