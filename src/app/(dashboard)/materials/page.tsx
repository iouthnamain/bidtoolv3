import { Suspense } from "react";

import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { MaterialsListClient } from "~/app/_components/materials/list-client";

export const dynamic = "force-dynamic";

export default function MaterialsPage() {
  return (
    <DashboardShell
      title="Sản phẩm / vật tư"
      description="Quản lý danh mục nội bộ để đối chiếu và chọn sản phẩm trong Không gian Excel"
    >
      <Suspense
        fallback={
          <div className="panel p-5 text-sm text-slate-600">
            Đang tải danh mục sản phẩm / vật tư...
          </div>
        }
      >
        <MaterialsListClient />
      </Suspense>
    </DashboardShell>
  );
}
