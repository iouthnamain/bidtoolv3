"use client";

import { usePathname } from "next/navigation";

import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { catalogPdfSectionNavItems } from "~/app/_components/dashboard/page-nav-presets";

const PAGE_META: Record<string, { title: string; description: string }> = {
  "/catalog-pdfs": {
    title: "Thư viện catalog PDF",
    description: "Quản lý tài liệu catalog của sản phẩm và liên kết nhiều vật tư với một tài liệu",
  },
  "/catalog-pdfs/new": {
    title: "Thêm tài liệu catalog PDF",
    description: "Tạo tài liệu từ URL PDF hoặc upload tệp.",
  },
};

export function CatalogPdfsLayoutClient({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isDetail = /^\/catalog-pdfs\/\d+$/.test(pathname);
  const meta = isDetail
    ? {
        title: "Chi tiết tài liệu catalog PDF",
        description: "Sửa metadata, tải bản cục bộ và gắn vật tư.",
      }
    : (PAGE_META[pathname] ?? PAGE_META["/catalog-pdfs"]!);

  return (
    <DashboardShell
      title={meta.title}
      description={meta.description}
      sectionNavItems={catalogPdfSectionNavItems}
      sectionNavTitle="Thư viện catalog"
    >
      {children}
    </DashboardShell>
  );
}
