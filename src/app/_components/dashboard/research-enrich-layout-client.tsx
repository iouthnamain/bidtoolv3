"use client";

import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { researchEnrichSectionNavItems } from "~/app/_components/dashboard/page-nav-presets";

export function ResearchEnrichLayoutClient({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <DashboardShell
      title="Nghiên cứu Excel"
      description="Tải Excel sản phẩm, chạy job nghiên cứu AI, xét duyệt bằng chứng và kế hoạch điền rồi xuất file hoàn chỉnh."
      sectionNavItems={researchEnrichSectionNavItems}
      sectionNavTitle="Khu vực nghiên cứu"
    >
      {children}
    </DashboardShell>
  );
}
