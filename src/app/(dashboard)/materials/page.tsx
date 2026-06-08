import { Suspense } from "react";

import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { materialsSectionNavItems } from "~/app/_components/dashboard/page-nav-presets";
import { MaterialsListClient } from "~/app/_components/materials/list-client";
import { HydrateClient, api } from "~/trpc/server";

export const dynamic = "force-dynamic";

function prefetchMaterialsPageData() {
  void api.material.searchMaterials.prefetch({
    keyword: "",
    limit: 80,
    offset: 0,
  });
}

export default function MaterialsPage() {
  prefetchMaterialsPageData();

  return (
    <DashboardShell
      title="Sản phẩm / vật tư"
      description="Quản lý danh mục nội bộ để nhập, đối chiếu và chuẩn hóa vật tư"
      sectionNavItems={materialsSectionNavItems}
      sectionNavTitle="Khu vực vật tư"
    >
      <HydrateClient>
        <Suspense
          fallback={
            <div className="panel p-5 text-sm text-slate-600">
              Đang tải danh mục sản phẩm / vật tư…
            </div>
          }
        >
          <MaterialsListClient />
        </Suspense>
      </HydrateClient>
    </DashboardShell>
  );
}
