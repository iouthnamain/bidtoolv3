"use client";

import { useState } from "react";

import { Badge, Button, EmptyState } from "~/app/_components/ui";
import { api } from "~/trpc/react";

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("vi-VN");
}

function severityTone(
  severity: "high" | "medium" | "low",
): "critical" | "warning" | "info" {
  if (severity === "high") {
    return "critical";
  }
  if (severity === "medium") {
    return "warning";
  }
  return "info";
}

export function NotificationsPageClient() {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [notifications] = api.notification.list.useSuspenseQuery({
    limit: 50,
    unreadOnly,
  });
  const utils = api.useUtils();

  const markAsRead = api.notification.markAsRead.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.notification.list.invalidate(),
        utils.insight.getDashboardSummary.invalidate(),
      ]);
    },
  });

  const markAllAsRead = api.notification.markAllAsRead.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.notification.list.invalidate(),
        utils.insight.getDashboardSummary.invalidate(),
      ]);
    },
  });

  return (
    <section className="panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-3">
        <div>
          <h2 className="text-sm font-bold">Thông báo trong ứng dụng</h2>
          <p className="mt-1 text-xs text-slate-500">
            Theo dõi cảnh báo được tạo từ workflow và dọn hộp thông báo sau khi
            xử lý.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant={unreadOnly ? "primary" : "secondary"}
            size="sm"
            onClick={() => setUnreadOnly((prev) => !prev)}
          >
            {unreadOnly ? "Đang lọc chưa đọc" : "Lọc chưa đọc"}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            isLoading={markAllAsRead.isPending}
            disabled={notifications.length === 0}
            onClick={() => markAllAsRead.mutate()}
          >
            Đánh dấu tất cả đã đọc
          </Button>
        </div>
      </div>

      {notifications.length === 0 ? (
        <EmptyState
          className="mt-4"
          title="Không có thông báo phù hợp"
          description="Khi workflow chạy và tạo cảnh báo mới, danh sách sẽ xuất hiện tại đây."
        />
      ) : (
        <ul className="mt-4 space-y-3">
          {notifications.map((item) => (
            <li
              key={item.id}
              className={`rounded-xl border px-4 py-3 ${
                item.isRead
                  ? "border-slate-200 bg-slate-50"
                  : "border-sky-200 bg-sky-50/70"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-slate-900">
                      {item.title}
                    </p>
                    <Badge tone={severityTone(item.severity)}>
                      {item.severity === "high"
                        ? "Cao"
                        : item.severity === "medium"
                          ? "Trung bình"
                          : "Thấp"}
                    </Badge>
                    {!item.isRead ? (
                      <Badge tone="info">Mới</Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-slate-700">{item.body}</p>
                  <p className="mt-2 text-xs text-slate-500">
                    {formatDateTime(item.createdAt)}
                  </p>
                </div>

                {!item.isRead ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    isLoading={
                      markAsRead.isPending && markAsRead.variables?.id === item.id
                    }
                    onClick={() => markAsRead.mutate({ id: item.id })}
                  >
                    Đánh dấu đã đọc
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
