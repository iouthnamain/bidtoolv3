import { Suspense } from "react";
import { type Metadata } from "next";
import { notFound } from "next/navigation";

import { createPageMetadata } from "~/app/_lib/seo";
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

export async function generateMetadata({
  params,
}: MaterialDetailsPageProps): Promise<Metadata> {
  const { id } = await params;

  return createPageMetadata({
    title: `Chi tiết vật tư #${id}`,
    description:
      "Xem và chỉnh sửa thông tin catalog vật tư, đơn vị tính, thông số, nguồn cung và đơn giá.",
    path: `/materials/${id}`,
    keywords: ["chi tiết vật tư", "catalog vật tư", "thông tin vật tư"],
  });
}

function prefetchMaterialDetailsPageData(id: number) {
  void api.material.getById.prefetch({ id });
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
      description="Xem, chỉnh sửa và kiểm tra thông tin catalog vật tư"
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
