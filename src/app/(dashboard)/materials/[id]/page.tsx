import { Suspense } from "react";
import { notFound } from "next/navigation";

import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { MaterialDetailClient } from "~/app/_components/materials/detail-client";

export const dynamic = "force-dynamic";

type MaterialDetailsPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function MaterialDetailsPage({
  params,
}: MaterialDetailsPageProps) {
  const { id: rawId } = await params;
  const id = Number.parseInt(rawId, 10);

  if (!Number.isInteger(id) || id <= 0) {
    notFound();
  }

  return (
    <DashboardShell
      title="Chi tiết vật tư"
      description="Xem, chỉnh sửa và kiểm tra lịch sử sử dụng vật tư trong các workspace Excel"
    >
      <Suspense
        fallback={
          <div className="panel p-5 text-sm text-slate-600">
            Đang tải chi tiết vật tư...
          </div>
        }
      >
        <MaterialDetailClient id={id} />
      </Suspense>
    </DashboardShell>
  );
}
