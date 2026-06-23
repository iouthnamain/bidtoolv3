import { FolderOutput } from "lucide-react";

import { createPageMetadata } from "~/app/_lib/seo";
import { OperationalSettingsSection } from "~/app/_components/dashboard/operational-settings-section";
import { SettingsStatusStrip } from "~/app/_components/dashboard/settings-status-strip";

export const metadata = createPageMetadata({
  title: "Cài đặt",
  description:
    "Theo dõi phiên bản, cấu hình desktop client và áp dụng cập nhật BidTool v3.",
  path: "/settings",
  noIndex: true,
});

export default function SettingsPage() {
  return (
    <div className="space-y-5">
      <SettingsStatusStrip />
      <OperationalSettingsSection
        id="material-profile-export"
        eyebrow="Hồ sơ vật tư"
        title="Thư mục xuất hồ sơ vật tư"
        description="Cấu hình nơi lưu Excel kết quả và folder Catalog khi export workflow Hồ sơ vật tư."
        icon={FolderOutput}
        iconClassName="bg-emerald-100 text-emerald-700"
        fields={[
          {
            key: "materialProfileExportDir",
            label: "Root folder export",
            helper:
              "Đường dẫn local để lưu output. Để trống/mặc định hệ thống sẽ dùng data/material-profiles.",
            placeholder: "/home/ina/bidtool-material-profiles",
          },
        ]}
      />
    </div>
  );
}
