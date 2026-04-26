import { Suspense } from "react";

import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { NotificationsPageClient } from "~/app/_components/dashboard/notifications-page-client";

export default function NotificationsPage() {
  return (
    <DashboardShell
      title="Trung tâm thông báo"
      description="Quản lý cảnh báo in-app được tạo từ workflow và theo dõi các mục chưa đọc."
    >
      <Suspense
        fallback={
          <div className="panel p-5 text-sm text-slate-600">
            Đang tải thông báo...
          </div>
        }
      >
        <NotificationsPageClient />
      </Suspense>
    </DashboardShell>
  );
}
