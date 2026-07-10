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
    title: `Xử lý hồ sơ vật tư #${id}`,
    description:
      "Kiểm tra sheet vật tư, tự tìm dữ liệu sản phẩm, lưu danh mục và tải file chuẩn.",
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
      title="Xử lý hồ sơ vật tư"
      description="Kiểm tra dữ liệu đầu vào, tự tìm & điền kết quả đáng tin cậy, rồi tải file chuẩn."
    >
      <MaterialProfileDetailClient workspaceId={id} />
    </DashboardShell>
  );
}
