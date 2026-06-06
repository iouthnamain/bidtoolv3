import { Suspense } from "react";

import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { materialsSectionNavItems } from "~/app/_components/dashboard/page-nav-presets";
import { MaterialImportClient } from "~/app/_components/materials/import-client";

export const dynamic = "force-dynamic";

export default function ImportMaterialsPage() {
  return (
    <DashboardShell
      title="Nhập sản phẩm / vật tư"
      description="Upload Excel hoặc dán CSV để tạo danh mục catalog hàng loạt"
      sectionNavItems={materialsSectionNavItems}
      sectionNavTitle="Khu vực vật tư"
    >
      <Suspense
        fallback={
          <div className="panel p-5 text-sm text-slate-600">
            Đang tải công cụ nhập vật tư…
          </div>
        }
      >
        <MaterialImportClient />
      </Suspense>
    </DashboardShell>
  );
}
