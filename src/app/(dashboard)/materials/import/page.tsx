import { Suspense } from "react";

import { createPageMetadata } from "~/app/_lib/seo";
import { MaterialImportClient } from "~/app/_components/materials/import-client";

export const dynamic = "force-dynamic";

export const metadata = createPageMetadata({
  title: "Nhập catalog vật tư",
  description:
    "Upload Excel hoặc dán CSV, xem preview sau upload và nhập hàng loạt catalog vật tư.",
  path: "/materials/import",
  keywords: ["nhập vật tư Excel", "preview Excel", "import catalog vật tư"],
});

export default function ImportMaterialsPage() {
  return (
    <Suspense
      fallback={
        <div className="panel p-5 text-sm text-slate-600">
          Đang tải công cụ nhập vật tư…
        </div>
      }
    >
      <MaterialImportClient />
    </Suspense>
  );
}
