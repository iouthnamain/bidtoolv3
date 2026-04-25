import { Suspense } from "react";

import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { ExcelWorkspaceWizardClient } from "~/app/_components/excel-workspace/workspace-wizard-client";

export const dynamic = "force-dynamic";

type ExcelWorkspaceDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function ExcelWorkspaceDetailPage({
  params,
}: ExcelWorkspaceDetailPageProps) {
  const { id } = await params;
  const workspaceId = Number.parseInt(id, 10);

  return (
    <DashboardShell
      title="Không gian Excel"
      description="Nhập tệp → Ghép cột → Duyệt dòng → Tìm sản phẩm → Xuất tệp"
    >
      <Suspense
        fallback={
          <div className="panel p-5 text-sm text-slate-600">
            Đang tải wizard...
          </div>
        }
      >
        <ExcelWorkspaceWizardClient workspaceId={workspaceId} />
      </Suspense>
    </DashboardShell>
  );
}
