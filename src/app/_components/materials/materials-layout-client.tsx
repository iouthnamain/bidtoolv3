"use client";

import { usePathname } from "next/navigation";

import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { materialsSectionNavItems } from "~/app/_components/dashboard/page-nav-presets";

const PAGE_META: Record<string, { title: string; description: string }> = {
  "/materials": {
    title: "Sản phẩm / vật tư",
    description: "Quản lý danh mục nội bộ để nhập, đối chiếu và chuẩn hóa vật tư",
  },
  "/materials/stats": {
    title: "Thống kê vật tư",
    description: "Tổng quan số vật tư, đơn giá, nguồn và category trong catalog.",
  },
  "/materials/new": {
    title: "Thêm vật tư",
    description: "Tạo một vật tư chuẩn cho catalog.",
  },
  "/materials/import": {
    title: "Nhập catalog vật tư",
    description: "Upload Excel hoặc dán CSV để tạo danh mục catalog hàng loạt.",
  },
  "/materials/scrape": {
    title: "Scrape shop vật tư",
    description: "Preview URL shop rồi nhập sản phẩm vào catalog.",
  },
};

const DEFAULT_META = PAGE_META["/materials"]!;

export function MaterialsLayoutClient({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const meta = PAGE_META[pathname] ?? DEFAULT_META;

  if (pathname.startsWith("/materials/") && /\/materials\/\d+/.test(pathname)) {
    return <>{children}</>;
  }

  return (
    <DashboardShell
      title={meta.title}
      description={meta.description}
      sectionNavItems={materialsSectionNavItems}
      sectionNavTitle="Khu vực vật tư"
    >
      {children}
    </DashboardShell>
  );
}
