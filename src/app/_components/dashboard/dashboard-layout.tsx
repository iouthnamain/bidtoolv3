"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const navItems = [
  { href: "/dashboard", label: "Tổng quan" },
  { href: "/search", label: "Tìm kiếm" },
  { href: "/workflows", label: "Workflows" },
  { href: "/insights", label: "Insights" },
];

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="mt-6 flex flex-col gap-1" aria-label="Dashboard navigation">
      {navItems.map((item) => {
        const isActive =
          pathname === item.href ||
          (item.href !== "/dashboard" && pathname.startsWith(item.href));

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={isActive ? "page" : undefined}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
              isActive
                ? "bg-slate-900 text-white"
                : "text-slate-700 hover:bg-slate-100"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="flex min-h-screen">
        <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white p-4 md:block">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">BidTool v3</p>
          <SidebarNav />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:hidden">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm font-medium text-slate-700"
            >
              Menu
            </button>
            <span className="text-sm font-semibold">BidTool v3</span>
          </header>

          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
        </div>
      </div>

      {mobileOpen ? (
        <>
          <button
            type="button"
            aria-label="Dong menu"
            className="fixed inset-0 z-40 bg-black/30 md:hidden"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="fixed inset-y-0 left-0 z-50 w-64 border-r border-slate-200 bg-white p-4 md:hidden">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">BidTool v3</p>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium"
              >
                  Đóng
              </button>
            </div>
            <SidebarNav onNavigate={() => setMobileOpen(false)} />
          </aside>
        </>
      ) : null}
    </div>
  );
}
