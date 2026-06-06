import { Suspense } from "react";
import { notFound } from "next/navigation";

import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { materialDetailSectionNavItems } from "~/app/_components/dashboard/page-nav-presets";
import { MaterialDetailClient } from "~/app/_components/materials/detail-client";
import { HydrateClient, api } from "~/trpc/server";

export const dynamic = "force-dynamic";

type MaterialDetailsPageProps = {
  params: Promise<{
    id: string;
  }>;
};

function prefetchMaterialDetailsPageData(id: number) {
  void api.material.getById.prefetch({ id });
  void api.material.getUsage.prefetch({ materialId: id, limit: 20 });
}

export default async function MaterialDetailsPage({
  params,
}: MaterialDetailsPageProps) {
  const { id: rawId } = await params;
  const id = Number.parseInt(rawId, 10);

  if (!Number.isInteger(id) || id <= 0) {
    notFound();
  }

  prefetchMaterialDetailsPageData(id);

  return (
    <DashboardShell
      title="Chi tiết vật tư"
      description="Xem, chỉnh sửa và kiểm tra lịch sử sử dụng vật tư trong các workspace Excel"
      sectionNavItems={materialDetailSectionNavItems}
      sectionNavTitle="Chi tiết vật tư"
    >
      <HydrateClient>
        <Suspense
          fallback={
            <div className="panel p-5 text-sm text-slate-600">
              Đang tải chi tiết vật tư…
            </div>
          }
        >
          <MaterialDetailClient id={id} />
        </Suspense>
      </HydrateClient>
    </DashboardShell>
  );
}
