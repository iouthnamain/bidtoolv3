import { Suspense } from "react";

import { createPageMetadata } from "~/app/_lib/seo";
import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { notificationsSectionNavItems } from "~/app/_components/dashboard/page-nav-presets";
import { NotificationsPageClient } from "~/app/_components/dashboard/notifications-page-client";
import { HydrateClient, api } from "~/trpc/server";

export const metadata = createPageMetadata({
  title: "Trung tâm thông báo",
  description:
    "Quản lý cảnh báo in-app từ workflow, xem trạng thái đã đọc và theo dõi tín hiệu thầu mới.",
  path: "/notifications",
  keywords: ["thông báo đấu thầu", "workflow alert", "cảnh báo gói thầu"],
});

function prefetchNotificationsPageData() {
  void api.notification.list.prefetch({
    limit: 50,
    unreadOnly: false,
  });
}

export default function NotificationsPage() {
  prefetchNotificationsPageData();

  return (
    <DashboardShell
      title="Trung tâm thông báo"
      description="Quản lý cảnh báo in-app được tạo từ workflow và theo dõi các mục chưa đọc."
      sectionNavItems={notificationsSectionNavItems}
      sectionNavTitle="Luồng xử lý"
    >
      <HydrateClient>
        <Suspense
          fallback={
            <div className="panel p-2 text-sm text-slate-600">
              Đang tải thông báo…
            </div>
          }
        >
          <NotificationsPageClient />
        </Suspense>
      </HydrateClient>
    </DashboardShell>
  );
}
