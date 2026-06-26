"use client";

import Link from "next/link";
import { Bell } from "lucide-react";

import { EmptyState } from "~/app/_components/ui";
import { api } from "~/trpc/react";

export function WorkflowAlertsClient() {
  const [notifications] = api.notification.list.useSuspenseQuery({ limit: 5 });

  return (
    <section className="panel p-4">
      <div className="flex items-center justify-between gap-2 border-b border-slate-400 pb-2">
        <h2 className="text-sm font-bold">Thông báo từ workflow</h2>
        <Link
          href="/notifications"
          className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline"
        >
          <Bell className="h-3.5 w-3.5" aria-hidden />
          Mở trung tâm thông báo
        </Link>
      </div>

      <p className="mt-3 text-xs text-slate-700">
        Cảnh báo gần đây được tạo ra từ các lần chạy workflow.
      </p>

      <ul className="mt-4 space-y-2 text-xs text-slate-700">
        {notifications.length === 0 ? (
          <li>
            <EmptyState
              title="Không có thông báo"
              description="Thông báo chạy workflow sẽ xuất hiện tại đây sau các lần chạy thành công."
            />
          </li>
        ) : (
          notifications.map((item) => (
            <li
              key={item.id}
              className="rounded border border-slate-400 bg-slate-50/90 px-3 py-2"
            >
              <p className="leading-tight font-semibold text-slate-900">
                {item.title}
              </p>
              <p className="mt-1 text-xs text-slate-600">{item.body}</p>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
