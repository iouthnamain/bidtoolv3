"use client";

import Link from "next/link";
import {
  Bot,
  Building2,
  ChevronRight,
  Download,
  Laptop,
  Users,
} from "lucide-react";

import { Badge } from "~/app/_components/ui";
import { ROLE_CAPABILITIES } from "~/lib/role-surfaces";
import { usePermissions } from "~/lib/use-permissions";

const adminCards = [
  {
    href: "/settings/users",
    title: "Người dùng",
    description: "Tạo tài khoản, phân quyền, khóa hoặc thu hồi truy cập.",
    icon: Users,
  },
  {
    href: "/settings/tenants",
    title: "Tổ chức",
    description: "Quản lý khách hàng multi-tenant và liên kết người dùng.",
    icon: Building2,
  },
  {
    href: "/settings/ai",
    title: "AI Providers",
    description: "API key, provider đang dùng và model mặc định.",
    icon: Bot,
  },
  {
    href: "/settings/updates",
    title: "Cập nhật",
    description: "Áp dụng bản mới và kiểm tra trạng thái on-prem.",
    icon: Download,
  },
  {
    href: "/settings/desktop",
    title: "Ứng dụng desktop",
    description: "Cấu hình client Electron kết nối server.",
    icon: Laptop,
  },
];

export function AdminHubClient() {
  const { role, isPreview } = usePermissions();
  const admin = ROLE_CAPABILITIES.admin;

  return (
    <div className="space-y-5">
      <section className="brand-surface overflow-hidden rounded">
        <div className="px-4 py-2 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-1">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="info">Quản trị</Badge>
                {isPreview ? <Badge tone="warning">Xem trước</Badge> : null}
              </div>
              <h2 className="mt-3 text-xl font-extrabold tracking-tight text-white">
                Trung tâm quản trị BidTool
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-white/75">
                {admin.summary} Khu vực này gom các tác vụ cấu hình hệ thống,
                người dùng, tổ chức, cập nhật và tham chiếu quyền vào một nơi rõ ràng.
              </p>
            </div>
            <div className="rounded bg-white/10 px-3 py-2 text-xs font-semibold text-white/80">
              Vai trò hiện tại: {role ? ROLE_CAPABILITIES[role].label : "Chưa có"}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-1 sm:grid-cols-2 xl:grid-cols-3">
        {adminCards.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.href}
              href={card.href}
              className="group rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] p-4 shadow-sm transition-colors duration-0 hover:border-blue-300 hover:bg-blue-50/60 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              <div className="flex items-start justify-between gap-1">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-blue-50 text-blue-700 group-hover:bg-blue-100">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <ChevronRight
                  className="mt-1 h-4 w-4 text-slate-600  group-hover:translate-x-0.5 group-hover:text-blue-600"
                  aria-hidden="true"
                />
              </div>
              <h3 className="mt-4 text-sm font-bold text-slate-950">
                {card.title}
              </h3>
              <p className="mt-1 text-xs leading-5 text-slate-600">
                {card.description}
              </p>
            </Link>
          );
        })}
      </section>
    </div>
  );
}
