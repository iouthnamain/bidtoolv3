import { Suspense } from "react";

import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { ExcelWorkspaceListClient } from "~/app/_components/excel-workspace/list-client";

export const dynamic = "force-dynamic";

export default function ExcelWorkspacePage() {
  return (
    <DashboardShell
      title="Excel Workspace"
      description="Tạo workbook vật tư chuẩn, map cột từ Excel nguồn, chuẩn hóa dòng và xuất các sheet THVT, đề nghị mua, biên bản kiểm tra và evidence"
    >
      <Suspense
        fallback={
          <div className="panel p-5 text-sm text-slate-600">
            Đang tải workspace...
          </div>
        }
      >
        <ExcelWorkspaceListClient />
      </Suspense>
    </DashboardShell>
  );
}
