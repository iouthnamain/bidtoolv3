import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  EyeOff,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "~/app/_components/ui";
import type {
  DashboardMetric,
  DashboardQueueItem,
} from "~/app/_lib/role-dashboard-data";
import type { Role } from "~/lib/permissions";
import { ROLE_CAPABILITIES, ROLE_LABELS } from "~/lib/role-surfaces";

type QuickLaunchItem = {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
};

const toneClass: Record<
  NonNullable<DashboardMetric["tone"]>,
  {
    accent: string;
    badge: "neutral" | "success" | "warning" | "critical" | "info";
  }
> = {
  neutral: { accent: "border-t-slate-400", badge: "neutral" },
  success: { accent: "border-t-emerald-500", badge: "success" },
  warning: { accent: "border-t-amber-500", badge: "warning" },
  critical: { accent: "border-t-rose-600", badge: "critical" },
  info: { accent: "border-t-sky-600", badge: "info" },
};

export function RoleDashboardFrame({
  role,
  eyebrow,
  title,
  description,
  primaryAction,
  children,
}: {
  role: Role;
  eyebrow: string;
  title: string;
  description: string;
  primaryAction?: ReactNode;
  children: ReactNode;
}) {
  const capability = ROLE_CAPABILITIES[role];

  return (
    <section className="flex min-h-full flex-col gap-3">
      <header className="border-line bg-surface-1 rounded-[var(--radius-panel)] border p-4 shadow-[var(--shadow-flat)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="info">{ROLE_LABELS[role]}</Badge>
              <span className="text-ink-3 text-xs font-bold tracking-[0.16em] uppercase">
                {eyebrow}
              </span>
            </div>
            <h1 className="text-ink-1 mt-2 text-2xl leading-tight font-extrabold tracking-tight">
              {title}
            </h1>
            <p className="text-ink-2 mt-1 max-w-4xl text-sm leading-6">
              {description}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            {primaryAction}
            <span className="border-line bg-surface-2 text-ink-2 rounded-[var(--radius-panel)] border px-2.5 py-1.5 text-xs font-semibold">
              {capability.summary}
            </span>
          </div>
        </div>
      </header>
      {children}
    </section>
  );
}

export function MetricStrip({ metrics }: { metrics: DashboardMetric[] }) {
  return (
    <section className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {metrics.map((metric) => {
        const tone = toneClass[metric.tone ?? "neutral"];
        return (
          <article
            key={metric.label}
            className={`border-line min-w-0 rounded-[var(--radius-panel)] border border-t-[3px] ${tone.accent} bg-surface-1 px-4 py-3 shadow-[var(--shadow-flat)]`}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-ink-3 text-xs font-bold tracking-[0.14em] uppercase">
                {metric.label}
              </p>
              {metric.tone ? (
                <Badge tone={tone.badge}>{metric.tone}</Badge>
              ) : null}
            </div>
            <p className="text-ink-1 mt-1 text-2xl font-extrabold tracking-tight tabular-nums">
              {metric.value}
            </p>
            {metric.hint ? (
              <p className="text-ink-2 mt-1 truncate text-xs">{metric.hint}</p>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}

export function WorkQueuePanel({
  title,
  description,
  items,
  emptyText = "Không có mục nào cần xử lý.",
}: {
  title: string;
  description: string;
  items: DashboardQueueItem[];
  emptyText?: string;
}) {
  return (
    <section className="border-line bg-surface-1 rounded-[var(--radius-panel)] border p-4 shadow-[var(--shadow-flat)]">
      <div className="border-line flex items-start justify-between gap-3 border-b pb-3">
        <div>
          <p className="section-title">{title}</p>
          <p className="text-ink-2 mt-1 text-xs leading-5">{description}</p>
        </div>
        <Badge tone={items.length > 0 ? "warning" : "success"}>
          {items.length}
        </Badge>
      </div>
      {items.length === 0 ? (
        <div className="border-line-strong bg-surface-2 text-ink-2 mt-3 rounded-[var(--radius-panel)] border border-dashed px-3 py-4 text-center text-xs">
          {emptyText}
        </div>
      ) : (
        <ul className="divide-line mt-3 divide-y">
          {items.map((item) => {
            const content = (
              <div className="flex items-start gap-2 py-2.5">
                <CircleAlert className="text-ink-3 mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-ink-1 min-w-0 flex-1 truncate text-sm font-bold">
                      {item.title}
                    </p>
                    <Badge tone={item.tone ?? "neutral"}>
                      {item.tone ?? "info"}
                    </Badge>
                  </div>
                  <p className="text-ink-2 mt-0.5 line-clamp-2 text-xs leading-5">
                    {item.meta}
                  </p>
                </div>
                {item.href ? (
                  <ArrowRight className="text-ink-3 mt-1 h-3.5 w-3.5 shrink-0" />
                ) : null}
              </div>
            );
            return (
              <li key={item.id}>
                {item.href ? (
                  <Link
                    href={item.href}
                    className="hover:bg-surface-2 focus-visible:ring-ring focus-visible:ring-offset-surface-1 block rounded-[var(--radius-panel)] transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none motion-reduce:transition-none"
                  >
                    {content}
                  </Link>
                ) : (
                  content
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function QuickLaunchGrid({ items }: { items: QuickLaunchItem[] }) {
  return (
    <section className="border-line bg-surface-1 rounded-[var(--radius-panel)] border p-4 shadow-[var(--shadow-flat)]">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <p className="section-title">Lối tắt</p>
          <h2 className="text-ink-1 mt-1 text-sm font-bold">
            Mở tác vụ thường dùng
          </h2>
        </div>
        <CheckCircle2 className="text-brand h-4 w-4" aria-hidden="true" />
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="group border-line bg-surface-2 focus-visible:ring-ring focus-visible:ring-offset-surface-1 rounded-[var(--radius-panel)] border px-3 py-3 transition-colors duration-150 hover:border-teal-300 hover:bg-teal-50 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none motion-reduce:transition-none"
            >
              <Icon className="text-brand h-4 w-4" aria-hidden="true" />
              <p className="text-ink-1 mt-2 text-sm font-bold">{item.label}</p>
              <p className="text-ink-2 mt-0.5 text-xs leading-5">
                {item.description}
              </p>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

export function RoleBoundaryNotice({
  title,
  items,
}: {
  title: string;
  items: readonly string[];
}) {
  return (
    <section className="border-line bg-surface-2 rounded-[var(--radius-panel)] border p-4">
      <div className="flex items-center gap-2">
        <EyeOff className="text-ink-3 h-4 w-4" aria-hidden="true" />
        <h2 className="text-ink-1 text-sm font-bold">{title}</h2>
      </div>
      <ul className="text-ink-2 mt-2 grid gap-1.5 text-xs leading-5 sm:grid-cols-2">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="bg-brand mt-2 h-1 w-1 shrink-0 rounded-full" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
