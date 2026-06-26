"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";

import { getHelpSection } from "~/app/_lib/help-content";
import { buildBreadcrumbs, type Breadcrumb } from "~/lib/breadcrumbs";

/**
 * Enriches registry labels with content-specific names where we can derive them
 * on the client without an extra request. Today that is just the Help topic
 * title (looked up from the static help content by its `:slug`).
 */
function enrichLabel(crumb: Breadcrumb): string {
  if (crumb.pattern === "/help/:slug" && crumb.param) {
    const section = getHelpSection(crumb.param);
    if (section) {
      return section.title;
    }
  }
  return crumb.label;
}

export function Breadcrumbs() {
  const pathname = usePathname();
  const crumbs = buildBreadcrumbs(pathname);

  if (crumbs.length === 0) {
    return null;
  }

  return (
    <nav aria-label="Đường dẫn" className="min-w-0">
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-xs font-medium text-slate-700">
        {crumbs.map((crumb, index) => {
          const label = enrichLabel(crumb);
          const isFirst = index === 0;

          return (
            <li key={crumb.href} className="flex min-w-0 items-center gap-x-1">
              {!isFirst ? (
                <ChevronRight
                  className="h-3.5 w-3.5 shrink-0 text-slate-300"
                  aria-hidden="true"
                />
              ) : null}
              {crumb.isCurrent ? (
                <span
                  aria-current="page"
                  className="max-w-[16rem] truncate font-semibold text-slate-700"
                >
                  {label}
                </span>
              ) : (
                <Link
                  href={crumb.href}
                  className="max-w-[12rem] truncate rounded transition-colors duration-0 hover:text-slate-900 hover:underline focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:outline-none"
                >
                  {label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
