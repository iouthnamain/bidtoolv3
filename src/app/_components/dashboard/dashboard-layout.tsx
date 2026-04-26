"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { MobileBanner } from "~/app/_components/dashboard/mobile-banner";

const SIDEBAR_COLLAPSE_KEY = "bidtool.sidebar.collapsed";

type IconName =
  | "dashboard"
  | "search"
  | "excel"
  | "materials"
  | "saved"
  | "workflow"
  | "insight"
  | "notification"
  | "help"
  | "tools";

type SubNavItem = {
  href: string;
  label: string;
};

type NavItem = {
  href: string;
  label: string;
  icon: IconName;
  badgeCount?: number;
  subItems?: SubNavItem[];
};

type NavSection = {
  id: string;
  title: string;
  items: NavItem[];
};

const isDevEnvironment = process.env.NODE_ENV === "development";

const navSections: NavSection[] = [
  {
    id: "home",
    title: "Tổng quan",
    items: [{ href: "/dashboard", label: "Tổng quan", icon: "dashboard" }],
  },
  {
    id: "work",
    title: "Tác vụ",
    items: [
      { href: "/search", label: "Tìm kiếm", icon: "search" },
      {
        href: "/excel-workspace",
        label: "Không gian Excel",
        icon: "excel",
      },
      { href: "/materials", label: "Sản phẩm / vật tư", icon: "materials" },
      {
        href: "/saved-items",
        label: "Bộ lọc & Watchlist",
        icon: "saved",
        subItems: [
          { href: "/saved-items#smart-views", label: "Smart Views" },
          { href: "/saved-items#watchlist", label: "Watchlist" },
        ],
      },
      { href: "/workflows", label: "Quy trình", icon: "workflow" },
    ],
  },
  {
    id: "activity",
    title: "Hoạt động",
    items: [
      { href: "/notifications", label: "Thông báo", icon: "notification" },
      { href: "/insights", label: "Phân tích", icon: "insight" },
    ],
  },
  {
    id: "support",
    title: "Hỗ trợ",
    items: [
      {
        href: "/help",
        label: "Trợ giúp",
        icon: "help",
        subItems: [
          { href: "/help#bat-dau", label: "Bắt đầu" },
          { href: "/help#windows-launch", label: "Windows" },
          { href: "/help#tim-kiem", label: "Tìm kiếm" },
          { href: "/help#smart-view", label: "Smart Views" },
          { href: "/help#excel-workspace", label: "Excel Workspace" },
          { href: "/help#khac-phuc-loi", label: "Khắc phục lỗi" },
        ],
      },
    ],
  },
  ...(isDevEnvironment
    ? [
        {
          id: "system",
          title: "Hệ thống",
          items: [
            {
              href: "/maintenance",
              label: "Bảo trì cục bộ",
              icon: "tools" as const,
            },
          ],
        } satisfies NavSection,
      ]
    : []),
];

function NavItemIcon({
  icon,
  className,
}: {
  icon: IconName;
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
    case "excel":
      return (
        <svg {...common}>
          <path d="M5 4.5h9l5 5v10A1.5 1.5 0 0 1 17.5 21h-12A1.5 1.5 0 0 1 4 19.5V6a1.5 1.5 0 0 1 1-1.5Z" />
          <path d="M14 4.5V10h5" />
          <path d="M8 13h7" />
          <path d="M8 16h7" />
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
    case "notification":
      return (
        <svg {...common}>
          <path d="M7.5 9a4.5 4.5 0 1 1 9 0v4l1.5 2.5h-12L7.5 13Z" />
          <path d="M10 18a2 2 0 0 0 4 0" />
        </svg>
      );
    case "help":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.6V14" />
          <path d="M12 17.25h.01" />
        </svg>
      );
    case "materials":
      return (
        <svg {...common}>
          <path d="M4.5 8.5 12 4l7.5 4.5-7.5 4.5-7.5-4.5Z" />
          <path d="m4.5 12 7.5 4.5 7.5-4.5" />
          <path d="m4.5 15.5 7.5 4.5 7.5-4.5" />
        </svg>
      );
    case "tools":
      return (
        <svg {...common}>
          <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2-2 2.5-2.5Z" />
        </svg>
      );
  }
}

function ChevronIcon({
  expanded,
  className = "h-3.5 w-3.5",
}: {
  expanded: boolean;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`${className} transition-transform duration-150 ${
        expanded ? "rotate-90" : ""
      }`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function NavLink({
  item,
  collapsed,
  onNavigate,
  isActive,
  expanded,
  onToggleExpand,
}: {
  item: NavItem;
  collapsed: boolean;
  onNavigate?: () => void;
  isActive: boolean;
  expanded: boolean;
  onToggleExpand?: () => void;
}) {
  const hasSubItems = !!item.subItems && item.subItems.length > 0;
  const showChevron = hasSubItems && !collapsed;

  return (
    <div className="flex flex-col">
      <div
        className={`group relative flex items-center rounded-lg text-sm font-medium transition-colors duration-150 ${
          isActive
            ? "bg-sky-700 text-white"
            : "text-slate-700 hover:bg-slate-100"
        } ${collapsed ? "justify-center" : ""}`}
      >
        <Link
          href={item.href}
          onClick={onNavigate}
          title={collapsed ? item.label : undefined}
          aria-current={isActive ? "page" : undefined}
          aria-label={collapsed ? item.label : undefined}
          className={`flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2.5 py-2 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none ${
            collapsed ? "justify-center" : ""
          }`}
        >
          <span
            className={`relative flex h-7 w-7 shrink-0 items-center justify-center ${
              isActive
                ? "text-white"
                : "text-slate-500 group-hover:text-slate-700"
            }`}
          >
            <NavItemIcon icon={item.icon} className="h-5 w-5" />
            {item.badgeCount && item.badgeCount > 0 ? (
              <span
                className={`absolute -top-1 -right-1 inline-flex min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] leading-none font-bold ${
                  isActive ? "bg-white text-sky-700" : "bg-rose-600 text-white"
                }`}
                aria-label={`${item.badgeCount} mục mới`}
              >
                {item.badgeCount > 99 ? "99+" : item.badgeCount}
              </span>
            ) : null}
          </span>
          {collapsed ? null : <span className="truncate">{item.label}</span>}
        </Link>
        {showChevron ? (
          <button
            type="button"
            onClick={onToggleExpand}
            aria-label={expanded ? "Thu gọn mục con" : "Mở rộng mục con"}
            aria-expanded={expanded}
            className={`mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 focus-visible:outline-none ${
              isActive
                ? "text-white/80 hover:bg-white/15"
                : "text-slate-500 hover:bg-slate-200"
            }`}
          >
            <ChevronIcon expanded={expanded} />
          </button>
        ) : null}
      </div>

      {hasSubItems && !collapsed && expanded ? (
        <ul className="mt-0.5 ml-7 flex flex-col gap-0.5 border-l border-slate-200 pl-2">
          {item.subItems!.map((sub) => (
            <li key={sub.href}>
              <Link
                href={sub.href}
                onClick={onNavigate}
                className="block rounded-md px-2 py-1.5 text-xs font-medium text-slate-600 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 focus-visible:outline-none"
              >
                {sub.label}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function SidebarNav({
  onNavigate,
  collapsed = false,
}: {
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  const pathname = usePathname();
  const [expandedHrefs, setExpandedHrefs] = useState<Record<string, boolean>>(
    {},
  );

  const isItemActive = (item: NavItem) =>
    pathname === item.href ||
    (item.href !== "/dashboard" && pathname.startsWith(item.href));

  const toggleExpand = (href: string) => {
    setExpandedHrefs((prev) => ({ ...prev, [href]: !prev[href] }));
  };

  return (
    <nav
      className="flex flex-1 flex-col gap-4 overflow-y-auto pr-1"
      aria-label="Điều hướng bảng điều khiển"
    >
      {navSections.map((section) => (
        <div key={section.id} className="flex flex-col gap-1">
          {!collapsed ? (
            <p className="px-2.5 pt-1 pb-1 text-[11px] font-semibold tracking-[0.14em] text-slate-400 uppercase">
              {section.title}
            </p>
          ) : (
            <div
              className="mx-auto h-px w-6 bg-slate-200 first:hidden"
              aria-hidden
            />
          )}
          {section.items.map((item) => {
            const active = isItemActive(item);
            // Auto-expand when item is active; otherwise honor manual toggle.
            const expanded = expandedHrefs[item.href] ?? active;
            return (
              <NavLink
                key={item.href}
                item={item}
                collapsed={collapsed}
                onNavigate={onNavigate}
                isActive={active}
                expanded={expanded}
                onToggleExpand={() => toggleExpand(item.href)}
              />
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function CollapseToggle({
  collapsed,
  onToggle,
  className = "",
}: {
  collapsed: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={collapsed ? "Mở rộng thanh bên" : "Thu gọn thanh bên"}
      title={`${collapsed ? "Mở rộng" : "Thu gọn"} (Ctrl/Cmd + B)`}
      className={`flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition-colors duration-150 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none ${className}`}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {collapsed ? <path d="m9 6 6 6-6 6" /> : <path d="m15 6-6 6 6 6" />}
      </svg>
    </button>
  );
}

function BrandHeader({ collapsed }: { collapsed: boolean }) {
  return (
    <Link
      href="/dashboard"
      className="flex items-center gap-2.5 rounded-lg px-1 py-1 transition-colors duration-150 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
      aria-label="BidTool v3 — về trang tổng quan"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-700 via-sky-800 to-teal-800 text-white shadow-sm">
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M4 7h16" />
          <path d="M4 12h10" />
          <path d="M4 17h7" />
          <circle cx="18" cy="16" r="3" />
          <path d="m20.5 18.5-1-1" />
        </svg>
      </span>
      {!collapsed ? (
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="text-sm font-bold tracking-tight text-slate-900">
            BidTool
          </span>
          <span className="text-[11px] font-medium tracking-[0.14em] text-slate-500 uppercase">
            v3 • Procurement
          </span>
        </span>
      ) : null}
    </Link>
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
        className={`hidden shrink-0 flex-col border-slate-200/80 bg-white/95 backdrop-blur transition-[width] duration-200 ease-out sm:flex sm:h-screen sm:border-r ${
          sidebarCollapsed ? "sm:w-16" : "sm:w-64"
        }`}
        aria-label="Thanh điều hướng chính"
      >
        <div
          className={`flex shrink-0 border-b border-slate-200/70 px-3 py-3 ${
            sidebarCollapsed
              ? "flex-col items-center gap-2"
              : "items-center justify-between gap-2"
          }`}
        >
          <BrandHeader collapsed={sidebarCollapsed} />
          <CollapseToggle
            collapsed={sidebarCollapsed}
            onToggle={() => setSidebarCollapsed((prev) => !prev)}
          />
        </div>

        <div className="flex flex-1 flex-col gap-3 overflow-hidden px-2 py-3">
          <SidebarNav collapsed={sidebarCollapsed} />
        </div>

        {!sidebarCollapsed ? (
          <div className="shrink-0 border-t border-slate-200/70 px-3 py-2">
            <span className="text-[11px] text-slate-400">
              Ctrl/Cmd + B để thu gọn
            </span>
          </div>
        ) : null}
      </aside>

      <div className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200/80 bg-white/90 px-4 py-2.5 backdrop-blur sm:hidden">
          <BrandHeader collapsed={false} />
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Mở menu điều hướng"
            className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 text-slate-700 transition-colors duration-150 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M4 6h16" />
              <path d="M4 12h16" />
              <path d="M4 18h16" />
            </svg>
          </button>
        </header>

        <MobileBanner />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1440px] px-4 py-5">
            {children}
          </div>
        </main>
      </div>

      {mobileOpen ? (
        <>
          <button
            type="button"
            aria-label="Đóng menu"
            className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-[1px] sm:hidden"
            onClick={() => setMobileOpen(false)}
          />
          <aside
            className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-slate-200 bg-white shadow-xl sm:hidden"
            aria-label="Thanh điều hướng chính"
          >
            <div className="flex items-center justify-between border-b border-slate-200/70 px-3 py-3">
              <BrandHeader collapsed={false} />
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Đóng menu"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-600 transition-colors duration-150 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="m6 6 12 12" />
                  <path d="m18 6-12 12" />
                </svg>
              </button>
            </div>
            <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-2 py-3">
              <SidebarNav onNavigate={() => setMobileOpen(false)} />
            </div>
          </aside>
        </>
      ) : null}
    </div>
  );
}
