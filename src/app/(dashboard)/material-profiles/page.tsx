import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { MaterialProfilesClient } from "~/app/_components/material-profiles/material-profiles-client";
import { createPageMetadata } from "~/app/_lib/seo";

export const metadata = createPageMetadata({
  title: "Xử lý hồ sơ vật tư",
  description:
    "Nhập sheet vật tư, tự tìm dữ liệu sản phẩm, lưu danh mục và tải file chuẩn.",
  path: "/material-profiles",
  keywords: ["hồ sơ vật tư", "tìm vật tư", "catalog vật tư"],
});

export default function MaterialProfilesPage() {
  return (
    <DashboardShell
      title="Xử lý hồ sơ vật tư"
      description="Nhập sheet → kiểm tra dữ liệu → tự tìm & điền → lưu danh mục → tải file chuẩn."
    >
      <MaterialProfilesClient />
    </DashboardShell>
  );
}
