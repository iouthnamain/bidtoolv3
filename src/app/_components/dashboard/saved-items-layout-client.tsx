"use client";

import { usePathname } from "next/navigation";

import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { savedItemsSectionNavItems } from "~/app/_components/dashboard/page-nav-presets";

const PAGE_META: Record<string, { title: string; description: string }> = {
  "/saved-items/smart-views": {
    title: "Bộ lọc thông minh",
    description: "Quản lý bộ lọc đã lưu, áp dụng lại và tạo workflow cảnh báo.",
  },
  "/saved-items/watchlist": {
    title: "Danh sách theo dõi",
    description: "Theo dõi gói thầu, KHLCNT, dự án và các mục cần quay lại sau.",
  },
};

const DEFAULT_META = {
  title: "Bộ lọc thông minh & theo dõi",
  description: "Trang quản lý riêng cho bộ lọc đã lưu và danh sách theo dõi",
};

export function SavedItemsLayoutClient({
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
      sectionNavItems={savedItemsSectionNavItems}
      sectionNavTitle="Khu vực theo dõi"
    >
      {children}
    </DashboardShell>
  );
}
