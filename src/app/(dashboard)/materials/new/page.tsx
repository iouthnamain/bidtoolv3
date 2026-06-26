import { Suspense } from "react";

import { createPageMetadata } from "~/app/_lib/seo";
import { MaterialCreateClient } from "~/app/_components/materials/new-client";

export const dynamic = "force-dynamic";

export const metadata = createPageMetadata({
  title: "Thêm vật tư",
  description:
    "Tạo thủ công một vật tư catalog với đơn vị, thông số, nhà cung cấp, xuất xứ và đơn giá.",
  path: "/materials/new",
  keywords: ["thêm vật tư", "tạo catalog vật tư", "giá vật tư"],
});

export default function NewMaterialPage() {
  return (
    <Suspense
      fallback={
        <div className="panel p-2 text-sm text-slate-600">
          Đang tải form thêm vật tư…
        </div>
      }
    >
      <MaterialCreateClient />
    </Suspense>
  );
}
