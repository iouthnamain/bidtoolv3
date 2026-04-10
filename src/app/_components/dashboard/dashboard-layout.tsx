"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const SIDEBAR_COLLAPSE_KEY = "bidtool.sidebar.collapsed";

type NavItem = {
  href: string;
  label: string;
  short: string;
  icon: "dashboard" | "search" | "saved" | "workflow" | "insight";
};

const navItems: NavItem[] = [
  { href: "/dashboard", label: "Tổng quan", short: "TQ", icon: "dashboard" },
  { href: "/search", label: "Tìm kiếm", short: "TK", icon: "search" },
  { href: "/saved-items", label: "Smart Views", short: "SV", icon: "saved" },
  { href: "/workflows", label: "Workflows", short: "WF", icon: "workflow" },
  { href: "/insights", label: "Insights", short: "IN", icon: "insight" },
];

function NavItemIcon({
  icon,
  className,
}: {
  icon: NavItem["icon"];
  className?: string;
}) {
  const common = {
    className,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  switch (icon) {
    case "dashboard":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="8" height="8" rx="1.5" />
          <rect x="13" y="3" width="8" height="5" rx="1.5" />
          <rect x="13" y="10" width="8" height="11" rx="1.5" />
          <rect x="3" y="13" width="8" height="8" rx="1.5" />
        </svg>
      );
    case "search":
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4.25 4.25" />
        </svg>
      );
    case "saved":
      return (
        <svg {...common}>
          <path d="M6 4.5h12A1.5 1.5 0 0 1 19.5 6v14.5L12 16l-7.5 4.5V6A1.5 1.5 0 0 1 6 4.5Z" />
        </svg>
      );
    case "workflow":
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="2.5" />
          <circle cx="18" cy="12" r="2.5" />
          <circle cx="6" cy="18" r="2.5" />
          <path d="M8.5 6h6" />
          <path d="M15.8 13.4 8.3 16.6" />
        </svg>
      );
    case "insight":
      return (
        <svg {...common}>
          <path d="M4.5 19.5h15" />
          <path d="M7.5 16v-5" />
          <path d="M12 16V9" />
          <path d="M16.5 16V6" />
        </svg>
      );
    default:
      return null;
  }
}

function SidebarNav({
  onNavigate,
  collapsed = false,
}: {
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
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
            title={collapsed ? item.label : undefined}
            aria-current={isActive ? "page" : undefined}
            className={`group rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200 ${
              isActive
                ? "bg-gradient-to-r from-cyan-900 to-sky-800 text-white shadow-sm"
                : "text-slate-700 hover:bg-slate-100"
            } ${collapsed ? "flex h-10 items-center justify-center px-0" : "flex items-center justify-between"}`}
          >
            {collapsed ? (
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full border text-[10px] font-semibold tracking-wide ${
                  isActive
                    ? "border-white/50 bg-white/20 text-white"
                    : "border-slate-200 bg-white/80 text-slate-700"
                }`}
              >
                <NavItemIcon icon={item.icon} className="h-4 w-4" />
              </span>
            ) : (
              <>
                <span>{item.label}</span>
                <span
                  className={`h-1.5 w-1.5 rounded-full transition-opacity ${
                    isActive ? "bg-white opacity-100" : "bg-slate-300 opacity-0 group-hover:opacity-100"
                  }`}
                />
              </>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileOpen(false);
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        setSidebarCollapsed((prev) => !prev);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem(SIDEBAR_COLLAPSE_KEY);
    if (stored === "1") {
      setSidebarCollapsed(true);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      SIDEBAR_COLLAPSE_KEY,
      sidebarCollapsed ? "1" : "0",
    );
  }, [sidebarCollapsed]);

  return (
    <div className="flex h-screen flex-col text-slate-900 sm:flex-row">
      <aside
        className={`hidden w-full shrink-0 border-b border-slate-200/80 bg-white/95 p-3 backdrop-blur transition-all duration-300 ease-out sm:flex sm:h-screen sm:flex-col sm:border-b-0 sm:border-r ${
          sidebarCollapsed ? "sm:w-24" : "sm:w-72"
        }`}
      >
        <button
          type="button"
          className="absolute -right-3 top-6 hidden h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-xs font-bold text-slate-600 shadow-sm transition hover:bg-slate-100 lg:flex"
          onClick={() => setSidebarCollapsed((prev) => !prev)}
          aria-label={sidebarCollapsed ? "Mở rộng sidebar" : "Thu gọn sidebar"}
          title={`${sidebarCollapsed ? "Mở rộng" : "Thu gọn"} (Ctrl/Cmd + B)`}
        >
          {sidebarCollapsed ? ">" : "<"}
        </button>

        <div
          className={`rounded-xl border border-cyan-100 bg-gradient-to-br from-cyan-900 via-sky-900 to-teal-900 text-white shadow-sm ${
            sidebarCollapsed ? "p-2.5" : "p-4"
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] uppercase tracking-[0.22em] text-cyan-100">
              {sidebarCollapsed ? "BT3" : "BidTool v3"}
            </p>
            <button
              type="button"
              className="rounded-md border border-white/30 px-2 py-1 text-[11px] font-medium text-white hover:bg-white/10"
              onClick={() => setSidebarCollapsed((prev) => !prev)}
              aria-label={sidebarCollapsed ? "Mở rộng sidebar" : "Thu gọn sidebar"}
              title={`${sidebarCollapsed ? "Mở rộng" : "Thu gọn"} (Ctrl/Cmd + B)`}
            >
              {sidebarCollapsed ? ">" : "<"}
            </button>
          </div>

          {!sidebarCollapsed ? (
            <>
              <p className="mt-1 text-lg font-semibold">Bảng điều hành</p>
              <p className="mt-1 text-xs text-cyan-100/90">
                Theo dõi realtime, lưu chọn lọc, tự động hóa tác vụ.
              </p>
              <p className="mt-2 text-[11px] text-cyan-100/80">
                Phím tắt: Ctrl/Cmd + B
              </p>
            </>
          ) : null}
        </div>

        {!sidebarCollapsed ? (
          <p className="mt-5 text-[11px] uppercase tracking-[0.18em] text-slate-400">
            Điều hướng
          </p>
        ) : null}

        <SidebarNav collapsed={sidebarCollapsed} />
      </aside>

      <div className="relative flex min-w-0 flex-1 flex-col">
        <header className="shrink-0 border-b border-slate-200/80 bg-white/90 px-4 py-3 backdrop-blur sm:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm font-medium text-slate-700"
          >
            Menu
          </button>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1440px] px-4 py-5">{children}</div>
        </main>
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
