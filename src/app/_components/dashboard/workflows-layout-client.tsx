"use client";

import { usePathname } from "next/navigation";

import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { workflowSectionNavItems } from "~/app/_components/dashboard/page-nav-presets";

const PAGE_META: Record<string, { title: string; description: string }> = {
  "/workflows": {
    title: "Workflow tự động",
    description: "Tạo mới, lọc, chạy thử và mở từng workflow.",
  },
  "/workflows/health": {
    title: "Trạng thái workflow",
    description: "Active, paused, lỗi gần nhất và workflow chưa chạy.",
  },
  "/workflows/alerts": {
    title: "Thông báo workflow",
    description: "Cảnh báo gần đây sinh ra từ workflow.",
  },
};

const DEFAULT_META = {
  title: "Workflow tự động",
  description: "Quản lý trigger, hành động và lịch sử chạy",
};

export function WorkflowsLayoutClient({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const meta = PAGE_META[pathname] ?? DEFAULT_META;

  return (
    <DashboardShell
      title={meta.title}
      description={meta.description}
      sectionNavItems={workflowSectionNavItems}
      sectionNavTitle="Khu vực workflow"
    >
      {children}
    </DashboardShell>
  );
}
