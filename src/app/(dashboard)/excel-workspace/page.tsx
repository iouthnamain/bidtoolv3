import { Suspense } from "react";

import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { excelWorkspaceSectionNavItems } from "~/app/_components/dashboard/page-nav-presets";
import { ExcelWorkspaceListClient } from "~/app/_components/excel-workspace/list-client";
import { HydrateClient, api } from "~/trpc/server";

export const dynamic = "force-dynamic";

function prefetchExcelWorkspacePageData() {
  void api.excelWorkspace.listWorkspaces.prefetch(undefined);
}

export default function ExcelWorkspacePage() {
  prefetchExcelWorkspacePageData();

  return (
    <DashboardShell
      title="Excel Workspace"
      description="Tạo workbook vật tư chuẩn, map cột từ Excel nguồn, chuẩn hóa dòng và xuất các sheet THVT, đề nghị mua, biên bản kiểm tra và evidence"
      sectionNavItems={excelWorkspaceSectionNavItems}
      sectionNavTitle="Luồng Excel"
    >
      <HydrateClient>
        <Suspense
          fallback={
            <div className="panel p-5 text-sm text-slate-600">
              Đang tải workspace…
            </div>
          }
        >
          <ExcelWorkspaceListClient />
        </Suspense>
      </HydrateClient>
    </DashboardShell>
  );
}
