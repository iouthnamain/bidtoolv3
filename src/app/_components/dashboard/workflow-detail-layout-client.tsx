"use client";

import { useMemo } from "react";
import { useParams, usePathname } from "next/navigation";

import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { workflowDetailSectionNavItems } from "~/app/_components/dashboard/page-nav-presets";
import type { PageSectionNavItem } from "~/app/_components/dashboard/page-section-nav";

const PAGE_META: Record<string, { title: string; description: string }> = {
  overview: {
    title: "Chi tiết workflow",
    description: "Trạng thái, lần chạy gần nhất và hành động nhanh.",
  },
  edit: {
    title: "Cấu hình workflow",
    description: "Sửa trigger, criteria và trạng thái hoạt động.",
  },
  runs: {
    title: "Lịch sử chạy",
    description: "Log chạy, kết quả và thông điệp lỗi.",
  },
};

export function WorkflowDetailLayoutClient({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams<{ id: string }>();
  const pathname = usePathname();
  const workflowId = params.id;

  const sectionKey = pathname.endsWith("/edit")
    ? "edit"
    : pathname.endsWith("/runs")
      ? "runs"
      : "overview";

  const meta = PAGE_META[sectionKey] ?? PAGE_META.overview!;

  const sectionNavItems = useMemo((): PageSectionNavItem[] => {
    return workflowDetailSectionNavItems.map((item) => ({
      ...item,
      href: item.href.replace("{id}", workflowId),
    }));
  }, [workflowId]);

  return (
    <DashboardShell
      title={meta.title}
      description={meta.description}
      sectionNavItems={sectionNavItems}
      sectionNavTitle="Chi tiết workflow"
    >
      <div className="space-y-4">{children}</div>
    </DashboardShell>
  );
}
