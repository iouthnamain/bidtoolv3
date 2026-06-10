"use client";

import Link from "next/link";
import { MonitorCog, Settings, SlidersHorizontal } from "lucide-react";

import { DesktopSettingsSection } from "~/app/_components/dashboard/desktop-settings-page-client";
import { PageSectionNav } from "~/app/_components/dashboard/page-section-nav";
import { settingsSectionNavItems } from "~/app/_components/dashboard/page-nav-presets";

const settingsCards = [
  {
    href: "#desktop-client",
    title: "Desktop client",
    body: "Cấu hình server URL cho bản Electron và kiểm tra nguồn cấu hình đang dùng.",
    icon: MonitorCog,
  },
  {
    href: "#desktop-server",
    title: "Server URL",
    body: "Trỏ desktop app tới server on-prem hoặc quay về server local đi kèm.",
    icon: SlidersHorizontal,
  },
];

export function SettingsPageClient() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <PageSectionNav title="Khu vực cài đặt" items={settingsSectionNavItems} />

      <section
        id="settings-overview"
        className="panel scroll-mt-6 overflow-hidden"
      >
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-sky-50 text-sky-700">
              <Settings className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="section-title">Cài đặt</p>
              <h2 className="mt-1 text-base font-bold text-slate-950">
                Thiết lập ứng dụng và môi trường chạy
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                Gom các phần cấu hình vận hành vào một nơi để không lẫn với các
                luồng tác vụ hằng ngày.
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-3 p-4 sm:grid-cols-2">
          {settingsCards.map((card) => {
            const Icon = card.icon;
            return (
              <Link
                key={card.href}
                href={card.href}
                className="flex min-w-0 items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 transition-colors hover:border-sky-300 hover:bg-sky-50/70 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white text-slate-700">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-bold text-slate-950">
                    {card.title}
                  </span>
                  <span className="mt-0.5 block text-xs leading-5 text-slate-600">
                    {card.body}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      <DesktopSettingsSection />
    </div>
  );
}
