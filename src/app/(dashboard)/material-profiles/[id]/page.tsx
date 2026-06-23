import { type Metadata } from "next";
import { notFound } from "next/navigation";

import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { MaterialProfileDetailClient } from "~/app/_components/material-profiles/material-profile-detail-client";
import { createPageMetadata } from "~/app/_lib/seo";

export const dynamic = "force-dynamic";

type MaterialProfileDetailPageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({
  params,
}: MaterialProfileDetailPageProps): Promise<Metadata> {
  const { id } = await params;
  return createPageMetadata({
    title: `Hồ sơ vật tư #${id}`,
    description:
      "Upload, chỉnh sửa, map vật tư và export Excel/Catalog cho hồ sơ vật tư.",
    path: `/material-profiles/${id}`,
    noIndex: true,
  });
}

export default async function MaterialProfileDetailPage({
  params,
}: MaterialProfileDetailPageProps) {
  const { id: rawId } = await params;
  const id = Number.parseInt(rawId, 10);
  if (!Number.isInteger(id) || id <= 0) {
    notFound();
  }

  return (
    <DashboardShell
      title="Hồ sơ vật tư"
      description="Upload Excel, chỉnh cell, map vật tư, duyệt catalog và export output local."
    >
      <MaterialProfileDetailClient workspaceId={id} />
    </DashboardShell>
  );
}
