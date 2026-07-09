"use client";

import { FolderOutput } from "lucide-react";

import { OperationalSettingsSection } from "~/app/_components/dashboard/operational-settings-section";

export function MaterialProfileExportSettingsSection() {
  return (
    <OperationalSettingsSection
      id="material-profile-export"
      eyebrow="Hồ sơ vật tư"
      title="Thư mục xuất hồ sơ vật tư"
      description="Thư mục lưu sheet sạch (mặc định) hoặc gói biểu mẫu cũ khi xuất từ Hồ sơ vật tư. Có thể kèm folder Catalog nếu có URL/file."
      icon={FolderOutput}
      iconClassName="bg-emerald-100 text-emerald-700"
      fields={[
        {
          key: "materialProfileExportDir",
          label: "Thư mục gốc xuất hồ sơ",
          helper:
            "Đường dẫn local để lưu sheet sạch / biểu mẫu. Để trống sẽ dùng data/material-profiles.",
          placeholder: "/home/ina/bidtool-material-profiles",
        },
      ]}
    />
  );
}
