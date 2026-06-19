import type { Metadata } from "next";

import { TenantManagementSection } from "~/app/_components/dashboard/tenant-management-section";
import { requirePagePermission } from "../require-page-permission";

export const metadata: Metadata = {
  title: "Quản lý tổ chức",
  description: "Tạo và quản lý các tổ chức khách hàng (tenant).",
  robots: { index: false, follow: false },
};

export default async function SettingsTenantsPage() {
  await requirePagePermission("users:manage");
  return (
    <div className="space-y-6">
      <TenantManagementSection />
    </div>
  );
}
