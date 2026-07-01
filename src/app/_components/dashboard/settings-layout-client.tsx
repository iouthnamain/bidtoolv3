"use client";

import { usePathname } from "next/navigation";

import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { getSettingsSectionNavItems } from "~/app/_components/dashboard/page-nav-presets";
import { usePermissions } from "~/lib/use-permissions";

const PAGE_META: Record<string, { title: string; description: string }> = {
  "/settings": {
    title: "Cài đặt",
    description: "Phiên bản, môi trường và trạng thái cập nhật.",
  },
  "/settings/ai": {
    title: "OpenRouter",
    description: "Cấu hình API key và model mặc định cho chat sandbox.",
  },
  "/settings/search": {
    title: "Tìm kiếm web",
    description:
      "Cấu hình SearXNG, domain ưu tiên và kiểm tra chất lượng tìm kiếm.",
  },
  "/settings/desktop": {
    title: "Ứng dụng desktop",
    description: "Cấu hình server URL cho Electron.",
  },
  "/settings/updates": {
    title: "Cập nhật",
    description: "Áp dụng bản mới và xem ghi chú phát hành.",
  },
};

const DEFAULT_META = {
  title: "Cài đặt",
  description: "Phiên bản, desktop client và cập nhật hệ thống",
};

export function SettingsLayoutClient({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { role, can } = usePermissions();
  const meta = PAGE_META[pathname] ?? DEFAULT_META;
  const sectionNavItems = getSettingsSectionNavItems(role, can);

  return (
    <DashboardShell
      title={meta.title}
      description={meta.description}
      sectionNavItems={sectionNavItems}
      sectionNavTitle="Cài đặt"
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
        {children}
      </div>
    </DashboardShell>
  );
}
