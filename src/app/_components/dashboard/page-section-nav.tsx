"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Archive,
  BarChart3,
  Bell,
  BookmarkCheck,
  Boxes,
  CircleAlert,
  ClipboardCheck,
  Database,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  Filter,
  History,
  Home,
  LinkIcon,
  ListChecks,
  MonitorCog,
  Package,
  Pencil,
  Plus,
  Search,
  Server,
  Settings,
  SlidersHorizontal,
  Table2,
  Tags,
  Upload,
  Workflow,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export type PageSectionNavIcon =
  | "activity"
  | "archive"
  | "bar-chart"
  | "bell"
  | "bookmark"
  | "boxes"
  | "clipboard"
  | "database"
  | "download"
  | "eye"
  | "file"
  | "filter"
  | "history"
  | "home"
  | "link"
  | "list"
  | "monitor"
  | "package"
  | "pencil"
  | "plus"
  | "search"
  | "server"
  | "settings"
  | "sheet"
  | "sliders"
  | "table"
  | "tags"
  | "upload"
  | "warning"
  | "workflow"
  | "wrench";

export type PageSectionNavItem = {
  href: string;
  label: string;
  description: string;
  icon: PageSectionNavIcon;
  match?: "exact" | "prefix";
};

const iconMap: Record<PageSectionNavIcon, LucideIcon> = {
  activity: Activity,
  archive: Archive,
  "bar-chart": BarChart3,
  bell: Bell,
  bookmark: BookmarkCheck,
  boxes: Boxes,
  clipboard: ClipboardCheck,
  database: Database,
  download: Download,
  eye: Eye,
  file: FileText,
  filter: Filter,
  history: History,
  home: Home,
  link: LinkIcon,
  list: ListChecks,
  monitor: MonitorCog,
  package: Package,
  pencil: Pencil,
  plus: Plus,
  search: Search,
  server: Server,
  settings: Settings,
  sheet: FileSpreadsheet,
  sliders: SlidersHorizontal,
  table: Table2,
  tags: Tags,
  upload: Upload,
  warning: CircleAlert,
  workflow: Workflow,
  wrench: Wrench,
};

function routePathFromHref(href: string) {
  if (href.startsWith("#") || href.includes("#")) {
    return null;
  }

  const [path] = href.split(/[?#]/);
  return path === "" ? "/" : path;
}

function isItemActive(pathname: string, item: PageSectionNavItem): boolean {
  const path = routePathFromHref(item.href);
  if (!path) {
    return false;
  }

  if (item.match === "prefix") {
    return pathname === path || pathname.startsWith(`${path}/`);
  }

  return pathname === path;
}

export function PageSectionNav({
  title = "Khu vực trong trang",
  items,
}: {
  title?: string;
  items: PageSectionNavItem[];
}) {
  const pathname = usePathname();

  if (items.length === 0) {
    return null;
  }

  return (
    <nav aria-label={title} className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="section-title">{title}</p>
        <span className="text-xs font-medium text-slate-500">
          {items.length} mục
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {items.map((item) => {
          const Icon = iconMap[item.icon];
          const active = isItemActive(pathname, item);

          return (
            <Link
              key={`${item.href}-${item.label}`}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`group flex min-w-0 items-start gap-3 rounded-lg border px-3 py-3 transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none ${
                active
                  ? "border-sky-300 bg-sky-50 text-sky-950"
                  : "border-slate-200 bg-white text-slate-900 hover:border-sky-300 hover:bg-sky-50/70"
              }`}
            >
              <span
                className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
                  active
                    ? "bg-sky-100 text-sky-700"
                    : "bg-slate-100 text-slate-600 group-hover:bg-sky-100 group-hover:text-sky-700"
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-bold">
                  {item.label}
                </span>
                <span className="mt-0.5 line-clamp-2 block text-xs leading-5 text-slate-600">
                  {item.description}
                </span>
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
