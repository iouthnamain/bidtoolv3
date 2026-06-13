"use client";

import { usePathname } from "next/navigation";

import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { settingsSectionNavItems } from "~/app/_components/dashboard/page-nav-presets";

const PAGE_META: Record<string, { title: string; description: string }> = {
  "/settings": {
    title: "Cài đặt",
    description: "Phiên bản, môi trường và trạng thái cập nhật.",
  },
  "/settings/desktop": {
    title: "Desktop client",
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
  const meta = PAGE_META[pathname] ?? DEFAULT_META;

  return (
    <DashboardShell
      title={meta.title}
      description={meta.description}
      sectionNavItems={settingsSectionNavItems}
      sectionNavTitle="Cài đặt"
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
        {children}
      </div>
    </DashboardShell>
  );
}
