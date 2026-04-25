import { Suspense } from "react";

import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { MaterialsListClient } from "~/app/_components/materials/list-client";

export const dynamic = "force-dynamic";

export default function MaterialsPage() {
  return (
    <DashboardShell
      title="Material Master"
      description="Quản lý danh mục vật tư làm nguồn đầu vào cho Excel Workspace"
    >
      <Suspense
        fallback={
          <div className="panel p-5 text-sm text-slate-600">
            Đang tải material master...
          </div>
        }
      >
        <MaterialsListClient />
      </Suspense>
    </DashboardShell>
  );
}
