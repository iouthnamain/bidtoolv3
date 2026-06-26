import { Suspense } from "react";

import { MaterialsLayoutClient } from "~/app/_components/materials/materials-layout-client";

export const dynamic = "force-dynamic";

export default function MaterialsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <MaterialsLayoutClient>
      <Suspense
        fallback={
          <div className="panel p-2 text-sm text-slate-600">
            Đang tải khu vực vật tư…
          </div>
        }
      >
        {children}
      </Suspense>
    </MaterialsLayoutClient>
  );
}
