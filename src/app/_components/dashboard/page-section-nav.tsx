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
  Sparkles,
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
  | "sparkles"
  | "table"
  | "tags"
  | "upload"
  | "warning"
  | "workflow"
  | "wrench";

export type PageSectionNavTone =
  | "sky"
  | "emerald"
  | "amber"
  | "violet"
  | "rose"
  | "slate";

export type PageSectionNavItem = {
  href: string;
  label: string;
  description: string;
  icon: PageSectionNavIcon;
  match?: "exact" | "prefix";
  tone?: PageSectionNavTone;
};

const defaultToneStyles = {
  linkActive: "border-sky-300 bg-sky-50 text-sky-950",
  linkInactive:
    "border-slate-200 bg-white text-slate-900 hover:border-sky-300 hover:bg-sky-50/70",
  iconActive: "bg-sky-100 text-sky-700",
  iconInactive: "bg-slate-100 text-slate-600",
  description: "text-slate-600",
};

const toneStyles: Record<
  PageSectionNavTone,
  {
    linkActive: string;
    linkInactive: string;
    iconActive: string;
    iconInactive: string;
    description: string;
  }
> = {
  sky: {
    linkActive: "border-sky-400 bg-sky-100 text-sky-950 shadow-sm",
    linkInactive:
      "border-sky-200 bg-sky-50/80 text-sky-950 hover:border-sky-300 hover:bg-sky-50",
    iconActive: "bg-sky-200 text-sky-800",
    iconInactive: "bg-sky-100 text-sky-700",
    description: "text-sky-700",
  },
  emerald: {
    linkActive: "border-emerald-400 bg-emerald-100 text-emerald-950 shadow-sm",
    linkInactive:
      "border-emerald-200 bg-emerald-50/80 text-emerald-950 hover:border-emerald-300 hover:bg-emerald-50",
    iconActive: "bg-emerald-200 text-emerald-800",
    iconInactive: "bg-emerald-100 text-emerald-700",
    description: "text-emerald-700",
  },
  amber: {
    linkActive: "border-amber-400 bg-amber-100 text-amber-950 shadow-sm",
    linkInactive:
      "border-amber-200 bg-amber-50/80 text-amber-950 hover:border-amber-300 hover:bg-amber-50",
    iconActive: "bg-amber-200 text-amber-800",
    iconInactive: "bg-amber-100 text-amber-700",
    description: "text-amber-700",
  },
  violet: {
    linkActive: "border-violet-400 bg-violet-100 text-violet-950 shadow-sm",
    linkInactive:
      "border-violet-200 bg-violet-50/80 text-violet-950 hover:border-violet-300 hover:bg-violet-50",
    iconActive: "bg-violet-200 text-violet-800",
    iconInactive: "bg-violet-100 text-violet-700",
    description: "text-violet-700",
  },
  rose: {
    linkActive: "border-rose-400 bg-rose-100 text-rose-950 shadow-sm",
    linkInactive:
      "border-rose-200 bg-rose-50/80 text-rose-950 hover:border-rose-300 hover:bg-rose-50",
    iconActive: "bg-rose-200 text-rose-800",
    iconInactive: "bg-rose-100 text-rose-700",
    description: "text-rose-700",
  },
  slate: {
    linkActive: "border-slate-400 bg-slate-100 text-slate-950 shadow-sm",
    linkInactive:
      "border-slate-200 bg-slate-50/80 text-slate-950 hover:border-slate-300 hover:bg-slate-50",
    iconActive: "bg-slate-200 text-slate-800",
    iconInactive: "bg-slate-100 text-slate-700",
    description: "text-slate-600",
  },
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
  sparkles: Sparkles,
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
    <nav aria-label={title} className="space-y-2.5">
      <p className="section-title">
        {title}
        <span className="ml-1.5 font-medium tracking-normal text-slate-400 normal-case">
          · {items.length} mục
        </span>
      </p>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0 xl:grid-cols-4">
        {items.map((item) => {
          const Icon = iconMap[item.icon];
          const active = isItemActive(pathname, item);
          const tone = item.tone
            ? toneStyles[item.tone]
            : defaultToneStyles;
          const inactive = toneStyles.slate;

          return (
            <Link
              key={`${item.href}-${item.label}`}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`group flex min-h-11 min-w-[9.25rem] shrink-0 items-center gap-2 rounded-lg border px-3 py-2.5 transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none sm:min-h-0 sm:min-w-0 sm:shrink sm:items-start sm:gap-3 sm:py-3 ${
                active ? tone.linkActive : inactive.linkInactive
              }`}
            >
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md sm:mt-0.5 ${
                  active ? tone.iconActive : inactive.iconInactive
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-xs font-bold sm:text-sm">
                  {item.label}
                </span>
                <span
                  className={`mt-0.5 hidden text-xs leading-5 sm:line-clamp-2 sm:block ${
                    active ? tone.description : inactive.description
                  }`}
                >
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
