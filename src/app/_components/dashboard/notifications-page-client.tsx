"use client";

import { useMemo, useState } from "react";
import { Check, CheckCheck, Filter, MailOpen, Trash2 } from "lucide-react";

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
    onError: () => {
      toast.error("Không thể đánh dấu đã đọc.");
    },
  });

  const markAllAsRead = api.notification.markAllAsRead.useMutation({
    onSuccess: async () => {
      toast.success("Đã đánh dấu tất cả đã đọc.");
      await invalidateAll();
    },
    onError: () => {
      toast.error("Không thể đánh dấu tất cả đã đọc.");
    },
  });

  const markSelectedAsRead = api.notification.markSelectedAsRead.useMutation({
    onSuccess: async (result) => {
      toast.success(`Đã đánh dấu ${result.count} mục đã đọc.`);
      sel.clear();
      await invalidateAll();
    },
    onError: () => {
      toast.error("Không thể đánh dấu đã đọc.");
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
    <div className="">
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

      <div className="flex flex-wrap items-start justify-between gap-1 border-b border-slate-400 pb-3">
        <div>
          <h2 className="text-sm font-bold">Thông báo trong ứng dụng</h2>
          <p className="mt-1 text-xs text-slate-700">
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
              className={`rounded border border-l-2 px-4 py-3 transition-colors duration-0 ${
                sel.selected.has(item.id)
                  ? "border-blue-300 border-l-blue-400 bg-blue-50 ring-1 ring-blue-200"
                  : item.isRead
                    ? "border-slate-400 border-l-slate-300 bg-slate-50 hover:bg-slate-100/60"
                    : "border-blue-200 border-l-blue-400 bg-blue-50/30 hover:bg-blue-50/60"
              }`}
            >
              <div className="flex items-start gap-2">
                <label
                  className="relative -ml-2 flex h-10 w-10 shrink-0 cursor-pointer items-start justify-center rounded pt-1.5 transition-colors focus-within:ring-2 focus-within:ring-blue-500 focus-within:ring-offset-2 hover:bg-white/70"
                  data-testid="notification-select-target"
                >
                  <input
                    type="checkbox"
                    checked={sel.selected.has(item.id)}
                    onChange={() => sel.toggle(item.id)}
                    className="peer absolute h-10 w-10 cursor-pointer opacity-0"
                    aria-label={`Chọn "${item.title}"`}
                  />
                  <span
                    aria-hidden="true"
                    className="pointer-events-none flex h-5 w-5 items-center justify-center rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] text-white transition-colors peer-checked:border-blue-700 peer-checked:bg-blue-700"
                  >
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                </label>
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
                  <p className="mt-1 line-clamp-1 text-sm text-slate-700">{item.body}</p>
                  <p className="mt-2 text-xs text-slate-700">
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
    </div>
  );
}
