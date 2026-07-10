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
    <section className="flex min-h-full flex-col space-y-3">
      <header className="border-line border-b pb-3">
        <Breadcrumbs />
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="bg-brand h-7 w-1 rounded" aria-hidden />
              <h1 className="text-ink-1 text-2xl leading-tight font-extrabold tracking-tight text-balance">
                {title}
              </h1>
            </div>
            <p className="text-ink-2 mt-1 max-w-4xl pl-3 text-base leading-snug text-pretty">
              {description}
            </p>
          </div>
          <div className="border-line bg-surface-1 text-ink-2 rounded-[var(--radius-panel)] border px-2.5 py-1 text-xs font-bold tracking-wide shadow-[var(--shadow-flat)]">
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
