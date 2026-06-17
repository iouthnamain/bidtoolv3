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
  children,
}: {
  title: string;
  description: string;
  sectionNavItems?: PageSectionNavItem[];
  sectionNavTitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="animate-rise flex min-h-full flex-col space-y-4">
      <header className="border-b border-slate-200 pb-3.5">
        <Breadcrumbs />
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <span
                className="h-7 w-1 rounded-full bg-gradient-to-b from-[var(--brand-from)] via-[var(--brand-via)] to-[var(--brand-to)]"
                aria-hidden
              />
              <h1 className="text-2xl leading-tight font-extrabold tracking-tight text-balance text-slate-950">
                {title}
              </h1>
            </div>
            <p className="mt-1.5 max-w-4xl pl-3.5 text-sm leading-6 text-pretty text-slate-600">
              {description}
            </p>
          </div>
          <div className="hidden rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold tracking-wide text-slate-500 shadow-[var(--shadow-flat)] sm:block">
            BidTool v3
          </div>
        </div>
      </header>

      {sectionNavItems && sectionNavItems.length > 0 ? (
        <PageSectionNav title={sectionNavTitle} items={sectionNavItems} />
      ) : null}

      <div className="flex-1">{children}</div>
    </section>
  );
}
