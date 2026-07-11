import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { MaterialProfileBulkSavePreview } from "~/app/_components/material-profiles/material-profile-bulk-save-preview";
import { createPageMetadata } from "~/app/_lib/seo";

export const dynamic = "force-dynamic";

export const metadata: Metadata = createPageMetadata({
  title: "Xem trước lưu vật tư",
  description: "Duyệt thay đổi trước khi lưu hồ sơ vào danh mục vật tư.",
  path: "/material-profiles/save-batches",
  noIndex: true,
});

export default async function MaterialProfileSaveBatchPage({
  params,
}: {
  params: Promise<{ id: string; batchId: string }>;
}) {
  const { id: rawId, batchId } = await params;
  const workspaceId = Number.parseInt(rawId, 10);
  if (
    !Number.isInteger(workspaceId) ||
    workspaceId <= 0 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      batchId,
    )
  ) {
    notFound();
  }
  return (
    <DashboardShell
      title="Xem trước & lưu /materials"
      description="Kiểm tra vật tư đích, từng thay đổi và cảnh báo trước khi lưu."
    >
      <MaterialProfileBulkSavePreview
        workspaceId={workspaceId}
        batchId={batchId}
      />
    </DashboardShell>
  );
}
