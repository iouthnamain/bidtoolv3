import type { Metadata } from "next";

import { UserManagementSection } from "~/app/_components/dashboard/user-management-section";

export const metadata: Metadata = {
  title: "Quản lý người dùng",
  description: "Tạo tài khoản, gán quyền và khóa/mở khóa truy cập.",
  robots: { index: false, follow: false },
};

export default function SettingsUsersPage() {
  return (
    <div className="space-y-6">
      <UserManagementSection />
    </div>
  );
}
