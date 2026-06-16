"use client";

import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { enrichSectionNavItems } from "~/app/_components/dashboard/page-nav-presets";

export function EnrichLayoutClient({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <DashboardShell
      title="Đối chiếu & điền Excel"
      description="Tải Excel còn thiếu trường, ghép catalog, nghiên cứu web (tùy chọn) và xuất file đã điền."
      sectionNavItems={enrichSectionNavItems}
      sectionNavTitle="Khu vực đối chiếu"
    >
      {children}
    </DashboardShell>
  );
}
