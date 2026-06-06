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
    <section className="space-y-4">
      <header className="border-b border-slate-200 pb-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="section-title">BidTool workspace</p>
            <h1 className="mt-1 text-2xl leading-tight font-bold tracking-tight text-balance text-slate-950">
              {title}
            </h1>
            <p className="mt-1 max-w-4xl text-sm leading-6 text-pretty text-slate-600">
              {description}
            </p>
          </div>
          <div className="hidden rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-500 sm:block">
            BidTool v3
          </div>
        </div>
      </header>

      {sectionNavItems && sectionNavItems.length > 0 ? (
        <PageSectionNav title={sectionNavTitle} items={sectionNavItems} />
      ) : null}

      <div>{children}</div>
    </section>
  );
}
