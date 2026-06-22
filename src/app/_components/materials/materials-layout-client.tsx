"use client";

import { usePathname } from "next/navigation";

import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { materialsSectionNavItems } from "~/app/_components/dashboard/page-nav-presets";

const PAGE_META: Record<string, { title: string; description: string }> = {
  "/materials": {
    title: "Sản phẩm / vật tư",
    description: "Quản lý danh mục nội bộ để nhập, đối chiếu và chuẩn hóa vật tư",
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
    description:
      "Chạy job scrape nhiều trang, theo dõi tiến độ rồi nhập sản phẩm vào catalog.",
  },
  "/materials/enrich": {
    title: "Làm giàu vật tư",
    description:
      "Tìm kiếm web, bổ sung thông số và catalog PDF cho vật tư trong danh mục.",
  },
};

const DEFAULT_META = PAGE_META["/materials"]!;

export function MaterialsLayoutClient({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const meta = pathname.startsWith("/materials/enrich/jobs/")
    ? {
        title: "Job làm giàu vật tư",
        description:
          "Theo dõi tiến độ enrichment, duyệt kết quả và commit vào catalog.",
      }
    : pathname.startsWith("/materials/scrape/jobs/")
      ? {
          title: "Scrape job shop",
          description:
            "Theo dõi tiến độ scrape, duyệt sản phẩm và nhập vào catalog.",
        }
      : (PAGE_META[pathname] ?? DEFAULT_META);

  if (pathname.startsWith("/materials/") && /\/materials\/\d+/.test(pathname)) {
    return <>{children}</>;
  }

  return (
    <DashboardShell
      title={meta.title}
      description={meta.description}
      sectionNavItems={materialsSectionNavItems}
      sectionNavTitle="Khu vực vật tư"
      sectionNavVariant="compact"
    >
      {children}
    </DashboardShell>
  );
}
