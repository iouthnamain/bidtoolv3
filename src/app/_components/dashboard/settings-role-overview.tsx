"use client";

import Link from "next/link";
import { Bot, Building2, ShieldCheck, Users } from "lucide-react";

import { Badge } from "~/app/_components/ui";
import { ROLE_CAPABILITIES, ROLE_LABELS } from "~/lib/role-surfaces";
import { usePermissions } from "~/lib/use-permissions";

const governanceLinks = [
  {
    href: "/settings/users",
    label: "Người dùng",
    description: "Tạo tài khoản, gán role và khóa truy cập.",
    icon: Users,
  },
  {
    href: "/settings/tenants",
    label: "Tổ chức",
    description: "Quản lý tenant khách hàng và thành viên.",
    icon: Building2,
  },
  {
    href: "/settings/ai",
    label: "AI Providers",
    description: "Cấu hình API key và provider đang dùng.",
    icon: Bot,
  },
  {
    href: "/help/vai-tro",
    label: "Vai trò & quyền",
    description: "Xem lại ranh giới admin, manager, staff và customer.",
    icon: ShieldCheck,
  },
];

export function SettingsRoleOverview() {
  const { role, isPreview } = usePermissions();

  if (role !== "manager") {
    return null;
  }

  const manager = ROLE_CAPABILITIES.manager;

  return (
    <section className="rounded border border-violet-200 bg-violet-50/80 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-1">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="info">{ROLE_LABELS.manager}</Badge>
            {isPreview ? <Badge tone="warning">Xem trước</Badge> : null}
          </div>
          <h2 className="mt-3 text-base font-bold text-slate-950">
            Không gian governance
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-700">
            {manager.summary} Các tác vụ nghiệp vụ như vật tư, scrape, enrich và
            workflow được ẩn khỏi nav để vai trò quản lý tập trung vào kiểm soát
            truy cập và cấu hình.
          </p>
        </div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {governanceLinks.map((link) => {
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              className="rounded border border-violet-200 bg-white px-3 py-3 transition-colors duration-0 hover:border-violet-300 hover:bg-violet-50 focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:outline-none"
            >
              <Icon className="h-4 w-4 text-violet-700" aria-hidden="true" />
              <p className="mt-2 text-sm font-bold text-slate-950">
                {link.label}
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-600">
                {link.description}
              </p>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
