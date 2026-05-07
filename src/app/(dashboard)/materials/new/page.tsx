import { Suspense } from "react";

import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { MaterialCreateClient } from "~/app/_components/materials/new-client";

export const dynamic = "force-dynamic";

export default function NewMaterialPage() {
  return (
    <DashboardShell
      title="Thêm sản phẩm / vật tư"
      description="Tạo thủ công một vật tư catalog để dùng trong Workspace Excel"
    >
      <Suspense
        fallback={
          <div className="panel p-5 text-sm text-slate-600">
            Đang tải form thêm vật tư...
          </div>
        }
      >
        <MaterialCreateClient />
      </Suspense>
    </DashboardShell>
  );
}
