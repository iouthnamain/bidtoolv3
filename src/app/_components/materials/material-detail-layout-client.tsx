"use client";

import { useMemo } from "react";
import { useParams, usePathname } from "next/navigation";

import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { materialDetailSectionNavItems } from "~/app/_components/dashboard/page-nav-presets";
import type { PageSectionNavItem } from "~/app/_components/dashboard/page-section-nav";

const VIEW_META: Record<string, { title: string; description: string }> = {
  overview: {
    title: "Chi tiết vật tư",
    description: "Mã, giá, nguồn và trạng thái dữ liệu.",
  },
  prices: {
    title: "Nguồn giá",
    description: "Nhà cung cấp, URL, giá và ghi chú.",
  },
  documents: {
    title: "Thư viện catalog PDF",
    description: "Tài liệu catalog gắn với vật tư.",
  },
  edit: {
    title: "Chỉnh sửa vật tư",
    description: "Thông tin catalog, nguồn giá và metadata.",
  },
};

export function MaterialDetailLayoutClient({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams<{ id: string }>();
  const pathname = usePathname();
  const materialId = params.id;

  const viewKey = pathname.endsWith("/prices")
    ? "prices"
    : pathname.endsWith("/documents")
      ? "documents"
      : pathname.endsWith("/edit")
        ? "edit"
        : "overview";

  const meta = VIEW_META[viewKey] ?? VIEW_META.overview!;

  const sectionNavItems = useMemo((): PageSectionNavItem[] => {
    return materialDetailSectionNavItems.map((item) => ({
      ...item,
      href: item.href.replace("{id}", materialId),
    }));
  }, [materialId]);

  return (
    <DashboardShell
      title={meta.title}
      description={meta.description}
      sectionNavItems={sectionNavItems}
      sectionNavTitle="Chi tiết vật tư"
    >
      <div className="space-y-4">{children}</div>
    </DashboardShell>
  );
}
