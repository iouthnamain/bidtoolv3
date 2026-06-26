import { Breadcrumbs } from "~/app/_components/dashboard/breadcrumbs";
import {
  PageSectionNav,
  type PageSectionNavItem,
} from "~/app/_components/dashboard/page-section-nav";

export function DashboardShell({
  title,
  description,
  sectionNavItems,
  sectionNavTitle,
  sectionNavVariant,
  children,
}: {
  title: string;
  description: string;
  sectionNavItems?: PageSectionNavItem[];
  sectionNavTitle?: string;
  sectionNavVariant?: "detailed" | "compact";
  children: React.ReactNode;
}) {
  return (
    <section className="flex min-h-full flex-col space-y-2">
      <header className="border-b border-slate-400 pb-2">
        <Breadcrumbs />
        <div className="mt-2 flex flex-wrap items-end justify-between gap-1">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="h-7 w-1 rounded bg-brand" aria-hidden />
              <h1 className="text-2xl leading-tight font-extrabold tracking-tight text-balance text-slate-950">
                {title}
              </h1>
            </div>
            <p className="mt-1 max-w-4xl pl-3 text-base leading-snug text-pretty text-slate-800">
              {description}
            </p>
          </div>
          <div className="rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] px-2 py-1 text-xs font-bold tracking-wide text-slate-700">
            BidTool v3
          </div>
        </div>
      </header>

      {sectionNavItems && sectionNavItems.length > 0 ? (
        <PageSectionNav
          title={sectionNavTitle}
          items={sectionNavItems}
          variant={sectionNavVariant}
        />
      ) : null}

      <div className="flex-1">{children}</div>
    </section>
  );
}
