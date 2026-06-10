"use client";

import { useMemo, useState } from "react";
import { CheckCheck, Filter, MailOpen, Trash2 } from "lucide-react";

import {
  Badge,
  BulkActionBar,
  Button,
  ConfirmDialog,
  EmptyState,
} from "~/app/_components/ui";
import { useToast } from "~/app/_components/ui/toast";
import { formatDateTime } from "~/lib/datetime";
import { useRowSelection } from "~/lib/use-row-selection";
import { api } from "~/trpc/react";

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
  const toast = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const allIds = useMemo(() => notifications.map((n) => n.id), [notifications]);
  const sel = useRowSelection(allIds);

  const invalidateAll = async () => {
    await Promise.all([
      utils.notification.unreadCount.invalidate(),
      utils.notification.list.invalidate(),
    ]);
  };

  const markAsRead = api.notification.markAsRead.useMutation({
    onSuccess: invalidateAll,
  });

  const markAllAsRead = api.notification.markAllAsRead.useMutation({
    onSuccess: async () => {
      toast.success("Đã đánh dấu tất cả đã đọc.");
      await invalidateAll();
    },
  });

  const markSelectedAsRead = api.notification.markSelectedAsRead.useMutation({
    onSuccess: async (result) => {
      toast.success(`Đã đánh dấu ${result.count} mục đã đọc.`);
      sel.clear();
      await invalidateAll();
    },
  });

  const deleteMany = api.notification.deleteMany.useMutation({
    onSuccess: async (result) => {
      toast.success(`Đã xóa ${result.count} thông báo.`);
      sel.clear();
      setConfirmDelete(false);
      await invalidateAll();
    },
    onError: () => {
      toast.error("Không thể xóa thông báo.");
      setConfirmDelete(false);
    },
  });

  return (
    <section id="notification-list" className="panel scroll-mt-6 p-4">
      <ConfirmDialog
        open={confirmDelete}
        title={`Xóa ${sel.selectedCount} thông báo?`}
        description="Thông báo đã xóa không thể khôi phục."
        confirmLabel="Xóa"
        variant="danger"
        isLoading={deleteMany.isPending}
        onConfirm={() => deleteMany.mutate({ ids: sel.selectedIds })}
        onCancel={() => setConfirmDelete(false)}
      />

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
            leftIcon={<Filter className="h-3.5 w-3.5" />}
            onClick={() => setUnreadOnly((prev) => !prev)}
          >
            {unreadOnly ? "Đang lọc chưa đọc" : "Lọc chưa đọc"}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            isLoading={markAllAsRead.isPending}
            disabled={notifications.length === 0}
            leftIcon={<CheckCheck className="h-3.5 w-3.5" />}
            onClick={() => markAllAsRead.mutate()}
          >
            Đánh dấu tất cả đã đọc
          </Button>
        </div>
      </div>

      {sel.someSelected ? (
        <div className="mt-3">
          <BulkActionBar count={sel.selectedCount} onClear={sel.clear}>
            <Button
              variant="secondary"
              size="sm"
              isLoading={markSelectedAsRead.isPending}
              leftIcon={<MailOpen className="h-3.5 w-3.5" />}
              onClick={() =>
                markSelectedAsRead.mutate({ ids: sel.selectedIds })
              }
            >
              Đánh dấu đã đọc
            </Button>
            <Button
              variant="danger"
              size="sm"
              leftIcon={<Trash2 className="h-3.5 w-3.5" />}
              onClick={() => setConfirmDelete(true)}
            >
              Xóa
            </Button>
          </BulkActionBar>
        </div>
      ) : null}

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
              className={`rounded-xl border px-4 py-3 transition-colors ${
                sel.selected.has(item.id)
                  ? "border-sky-300 bg-sky-50 ring-1 ring-sky-200"
                  : item.isRead
                    ? "border-slate-200 bg-slate-50"
                    : "border-sky-200 bg-sky-50/70"
              }`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={sel.selected.has(item.id)}
                  onChange={() => sel.toggle(item.id)}
                  className="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded border-slate-300 accent-sky-600"
                  aria-label={`Chọn "${item.title}"`}
                />
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
                    {!item.isRead ? <Badge tone="info">Mới</Badge> : null}
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
                      markAsRead.isPending &&
                      markAsRead.variables?.id === item.id
                    }
                    leftIcon={<MailOpen className="h-3.5 w-3.5" />}
                    onClick={() => markAsRead.mutate({ id: item.id })}
                  >
                    Đã đọc
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
