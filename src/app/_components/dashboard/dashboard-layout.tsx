"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Bell,
  BookmarkCheck,
  Boxes,
  ChevronRight,
  CircleHelp,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  LayoutDashboard,
  Menu,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import { AdminUpdateBanner } from "~/app/_components/dashboard/admin-update-banner";
import { Logo } from "~/app/_components/brand/logo";
import { MobileBanner } from "~/app/_components/dashboard/mobile-banner";
import { SidebarUpdatePill } from "~/app/_components/dashboard/sidebar-update-pill";
import { STORAGE_KEYS } from "~/lib/storage-keys";
import { api } from "~/trpc/react";

const SIDEBAR_COLLAPSE_KEY = STORAGE_KEYS.sidebarCollapsed;
const UNREAD_COUNT_POLL_MS = 30_000;

type IconName =
  | "dashboard"
  | "search"
  | "excel"
  | "enrich"
  | "documents"
  | "materials"
  | "saved"
  | "workflow"
  | "notification"
  | "help"
  | "chat"
  | "settings";

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

function readLocalStorageValue(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorageValue(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
}

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
      {
        href: "/search/packages",
        label: "Tìm kiếm",
        icon: "search",
        subItems: [
          { href: "/search/packages", label: "Gói thầu" },
          { href: "/search/packages/location", label: "Theo địa phương" },
          { href: "/search/packages/area", label: "Ngành & địa phương" },
          { href: "/search/plans", label: "KHLCNT" },
          { href: "/search/projects", label: "Dự án" },
        ],
      },
      {
        href: "/documents",
        label: "Documents",
        icon: "documents",
      },
      {
        href: "/materials",
        label: "Sản phẩm / vật tư",
        icon: "materials",
        subItems: [
          { href: "/materials", label: "Danh mục" },
          { href: "/materials/new", label: "Thêm thủ công" },
          { href: "/materials/scrape", label: "Scrape shop" },
          { href: "/materials/match-review", label: "Match review" },
        ],
      },
      {
        href: "/enrich",
        label: "Đối chiếu Excel",
        icon: "enrich",
      },
      {
        href: "/catalog-pdfs",
        label: "Catalog PDFs",
        icon: "documents",
        subItems: [
          { href: "/catalog-pdfs", label: "Thư viện" },
          { href: "/catalog-pdfs/new", label: "Thêm tài liệu" },
        ],
      },
      {
        href: "/saved-items",
        label: "Bộ lọc & Watchlist",
        icon: "saved",
        subItems: [
          { href: "/saved-items/smart-views", label: "Smart Views" },
          { href: "/saved-items/watchlist", label: "Watchlist" },
        ],
      },
      {
        href: "/workflows",
        label: "Quy trình",
        icon: "workflow",
        subItems: [
          { href: "/workflows", label: "Danh sách" },
          { href: "/workflows/health", label: "Trạng thái" },
          { href: "/workflows/alerts", label: "Thông báo" },
        ],
      },
    ],
  },
  {
    id: "activity",
    title: "Hoạt động",
    items: [
      { href: "/notifications", label: "Thông báo", icon: "notification" },
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
          { href: "/help/bat-dau", label: "Bắt đầu" },
          { href: "/help/cap-nhat-hang-ngay", label: "Vận hành" },
          { href: "/help/tim-kiem", label: "Tìm kiếm" },
          { href: "/help/smart-view", label: "Smart Views" },
          { href: "/help/quy-trinh", label: "Quy trình" },
          { href: "/help/thong-bao", label: "Thông báo" },
          { href: "/help/import-mapping", label: "Import & Mapping" },
          { href: "/help/vat-tu", label: "Vật tư" },
          { href: "/help/khac-phuc-loi", label: "Khắc phục lỗi" },
        ],
      },
      {
        href: "/chat",
        label: "Chat sandbox",
        icon: "chat",
      },
      {
        href: "/settings",
        label: "Cài đặt",
        icon: "settings",
        subItems: [
          { href: "/settings/ai", label: "OpenRouter" },
          { href: "/settings/desktop", label: "Desktop client" },
          { href: "/settings/updates", label: "Cập nhật" },
        ],
      },
    ],
  },
];

const navIconMap: Record<IconName, LucideIcon> = {
  dashboard: LayoutDashboard,
  search: Search,
  excel: FileSpreadsheet,
  enrich: FileCheck2,
  documents: FileText,
  materials: Boxes,
  saved: BookmarkCheck,
  workflow: Workflow,
  notification: Bell,
  help: CircleHelp,
  chat: MessageSquare,
  settings: Settings,
};

function NavItemIcon({
  icon,
  className,
}: {
  icon: IconName;
  className?: string;
}) {
  const Icon = navIconMap[icon];
  return <Icon className={className} aria-hidden="true" />;
}

function ChevronIcon({
  expanded,
  className = "h-3.5 w-3.5",
}: {
  expanded: boolean;
  className?: string;
}) {
  return (
    <ChevronRight
      className={`${className} transition-transform duration-150 ${
        expanded ? "rotate-90" : ""
      }`}
      aria-hidden="true"
    />
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
        className={`group relative flex items-center rounded-md text-sm font-medium transition-colors duration-150 ${
          isActive
            ? "bg-gradient-to-r from-sky-50 to-transparent border-r-2 border-r-sky-600 text-sky-900 font-bold"
            : "text-slate-700 hover:bg-slate-100"
        } ${collapsed ? "justify-center" : ""}`}
      >
        <Link
          href={item.href}
          onClick={onNavigate}
          title={collapsed ? item.label : undefined}
          aria-current={isActive ? "page" : undefined}
          aria-label={collapsed ? item.label : undefined}
          className={`flex min-w-0 flex-1 items-center gap-3 rounded-md px-2.5 py-2 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none ${
            collapsed ? "justify-center" : ""
          }`}
        >
          <span
            className={`relative flex h-7 w-7 shrink-0 items-center justify-center ${
              isActive
                ? "text-sky-700"
                : "text-slate-500 group-hover:text-slate-700"
            }`}
          >
            <NavItemIcon icon={item.icon} className="h-5 w-5" />
            {item.badgeCount && item.badgeCount > 0 ? (
              <span
                className={`absolute -top-1.5 -right-1.5 inline-flex min-w-[18px] items-center justify-center rounded-full px-1 py-0.5 text-xs leading-none font-bold ${
                  isActive ? "bg-sky-700 text-white" : "bg-rose-500 text-white font-bold"
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
            className={`mr-1 flex h-10 w-10 shrink-0 touch-manipulation items-center justify-center rounded-md transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 focus-visible:outline-none sm:h-7 sm:w-7 ${
              isActive
                ? "text-sky-700 hover:bg-sky-100"
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
                className="flex min-h-10 touch-manipulation items-center rounded-md px-2 py-2 text-xs font-medium text-slate-600 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 focus-visible:outline-none sm:min-h-0 sm:py-1.5"
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
  const shouldReadUnreadCount = !pathname.startsWith("/help");
  const unreadCountQuery = api.notification.unreadCount.useQuery(undefined, {
    enabled: shouldReadUnreadCount,
    refetchInterval: UNREAD_COUNT_POLL_MS,
    refetchOnWindowFocus: false,
    staleTime: UNREAD_COUNT_POLL_MS,
  });
  const [expandedHrefs, setExpandedHrefs] = useState<Record<string, boolean>>(
    {},
  );
  const unreadCount = shouldReadUnreadCount ? (unreadCountQuery.data ?? 0) : 0;

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
            const itemWithBadge =
              item.href === "/notifications"
                ? { ...item, badgeCount: unreadCount }
                : item;
            const active = isItemActive(item);
            // Auto-expand when item is active; otherwise honor manual toggle.
            const expanded = expandedHrefs[item.href] ?? active;
            return (
              <NavLink
                key={item.href}
                item={itemWithBadge}
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
      {collapsed ? (
        <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
      ) : (
        <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
      )}
    </button>
  );
}

function BrandHeader({ collapsed }: { collapsed: boolean }) {
  return <Logo collapsed={collapsed} />;
}

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [hasLoadedSidebarPreference, setHasLoadedSidebarPreference] =
    useState(false);
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
    const stored = readLocalStorageValue(SIDEBAR_COLLAPSE_KEY);
    if (stored === "1") {
      setSidebarCollapsed(true);
    }
    setHasLoadedSidebarPreference(true);
  }, []);

  useEffect(() => {
    if (!hasLoadedSidebarPreference) {
      return;
    }

    writeLocalStorageValue(SIDEBAR_COLLAPSE_KEY, sidebarCollapsed ? "1" : "0");
  }, [hasLoadedSidebarPreference, sidebarCollapsed]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden text-slate-900 sm:flex-row">
      <a
        href="#main-content"
        className="pointer-events-none fixed top-3 left-3 z-[60] inline-flex min-h-10 -translate-y-20 items-center rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white opacity-0 transition-[opacity,transform] duration-150 focus:pointer-events-auto focus:translate-y-0 focus:opacity-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
      >
        Bỏ qua điều hướng
      </a>
      <aside
        className={`hidden shrink-0 flex-col border-slate-200/80 bg-white/95 backdrop-blur duration-200 ease-out sm:flex sm:h-screen sm:border-r ${
          hasLoadedSidebarPreference ? "transition-[width]" : "transition-none"
        } ${sidebarCollapsed ? "sm:w-16" : "sm:w-64"}`}
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

        <div className="shrink-0 space-y-2 border-t border-slate-200/70 px-2 py-2">
          <SidebarUpdatePill collapsed={sidebarCollapsed} />
          {!sidebarCollapsed ? (
            <span className="block px-1 text-[11px] text-slate-400">
              Ctrl/Cmd + B để thu gọn
            </span>
          ) : null}
        </div>
      </aside>

      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200/80 bg-white/90 px-4 pt-[calc(0.625rem+env(safe-area-inset-top))] pb-2.5 backdrop-blur sm:hidden">
          <BrandHeader collapsed={false} />
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Mở menu điều hướng"
            className="flex h-11 w-11 items-center justify-center rounded-md border border-slate-300 text-slate-700 transition-colors duration-150 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        <MobileBanner />
        <AdminUpdateBanner />
        <main id="main-content" className="min-h-0 flex-1 overflow-y-auto bg-slate-50">
          <div className="mx-auto w-full max-w-[1440px] px-4 pt-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
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
            role="dialog"
            aria-modal="true"
            className="fixed inset-y-0 left-0 z-50 flex w-[min(18rem,calc(100vw-2rem))] flex-col overscroll-contain border-r border-slate-200 bg-white pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] shadow-xl sm:hidden"
            aria-label="Thanh điều hướng chính"
          >
            <div className="flex items-center justify-between border-b border-slate-200/70 px-3 py-3">
              <BrandHeader collapsed={false} />
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Đóng menu"
                className="flex h-11 w-11 items-center justify-center rounded-md border border-slate-300 text-slate-600 transition-colors duration-150 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                <X className="h-4 w-4" aria-hidden="true" />
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
