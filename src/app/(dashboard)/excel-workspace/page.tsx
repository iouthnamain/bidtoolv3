import { Suspense } from "react";

import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { ExcelWorkspaceListClient } from "~/app/_components/excel-workspace/list-client";

export const dynamic = "force-dynamic";

export default function ExcelWorkspacePage() {
  return (
    <DashboardShell
      title="Không gian Excel"
      description="Nhập Excel, ghép cột sản phẩm, chọn nguồn khớp và xuất tệp đã bổ sung dữ liệu"
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
