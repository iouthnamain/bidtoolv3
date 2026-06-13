"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { sections } from "~/app/_lib/help-content";
import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { helpSectionNavItems } from "~/app/_components/dashboard/page-nav-presets";

const PAGE_META: Record<string, { title: string; description: string }> = {
  "/help": {
    title: "Trợ giúp & Hướng dẫn",
    description:
      "Hướng dẫn vận hành BidTool v3 từ lúc mở app, tìm gói thầu, lưu bộ lọc, nhập catalog đến vận hành cục bộ.",
  },
};

export function HelpLayoutClient({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const section = sections.find((item) => pathname === `/help/${item.id}`);
  const meta = section
    ? { title: section.title, description: section.intro }
    : (PAGE_META[pathname] ?? PAGE_META["/help"]!);

  return (
    <DashboardShell
      title={meta.title}
      description={meta.description}
      sectionNavItems={helpSectionNavItems}
      sectionNavTitle="Mục trợ giúp chính"
    >
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <nav
            aria-label="Mục lục Trợ giúp"
            className="panel flex flex-col gap-1 p-3"
          >
            <p className="px-2 pt-1 pb-2 text-[11px] font-semibold tracking-[0.14em] text-slate-400 uppercase">
              Mục lục
            </p>
            <Link
              href="/help"
              className={`flex min-h-10 items-center rounded-md px-2 py-1.5 text-sm transition-colors duration-150 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none sm:min-h-8 ${
                pathname === "/help"
                  ? "bg-sky-50 font-semibold text-sky-800"
                  : "text-slate-700"
              }`}
            >
              Tổng quan
            </Link>
            {sections.map((item) => (
              <Link
                key={item.id}
                href={`/help/${item.id}`}
                className={`flex min-h-10 items-center rounded-md px-2 py-1.5 text-sm transition-colors duration-150 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none sm:min-h-8 ${
                  pathname === `/help/${item.id}`
                    ? "bg-sky-50 font-semibold text-sky-800"
                    : "text-slate-700"
                }`}
              >
                {item.title}
              </Link>
            ))}
          </nav>
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </DashboardShell>
  );
}
