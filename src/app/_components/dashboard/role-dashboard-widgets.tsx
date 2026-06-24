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
import type { DashboardMetric, DashboardQueueItem } from "~/app/_lib/role-dashboard-data";
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
  { border: string; badge: "neutral" | "success" | "warning" | "critical" | "info" }
> = {
  neutral: { border: "border-slate-200", badge: "neutral" },
  success: { border: "border-emerald-200", badge: "success" },
  warning: { border: "border-amber-200", badge: "warning" },
  critical: { border: "border-rose-200", badge: "critical" },
  info: { border: "border-sky-200", badge: "info" },
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
    <section className="animate-rise flex min-h-full flex-col gap-3">
      <header className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="info">{ROLE_LABELS[role]}</Badge>
              <span className="text-xs font-bold tracking-[0.16em] text-slate-400 uppercase">
                {eyebrow}
              </span>
            </div>
            <h1 className="mt-2 text-2xl leading-tight font-extrabold tracking-tight text-slate-950">
              {title}
            </h1>
            <p className="mt-1 max-w-4xl text-sm leading-6 text-slate-600">
              {description}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            {primaryAction}
            <span className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-500">
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
    <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-6">
      {metrics.map((metric) => {
        const tone = toneClass[metric.tone ?? "neutral"];
        return (
          <article
            key={metric.label}
            className={`rounded-lg border ${tone.border} bg-white px-3 py-2.5 shadow-sm`}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-[11px] font-bold tracking-[0.14em] text-slate-500 uppercase">
                {metric.label}
              </p>
              {metric.tone ? <Badge tone={tone.badge}>{metric.tone}</Badge> : null}
            </div>
            <p className="mt-1 text-xl font-extrabold tracking-tight text-slate-950 tabular-nums">
              {metric.value}
            </p>
            {metric.hint ? (
              <p className="mt-0.5 truncate text-xs text-slate-500">
                {metric.hint}
              </p>
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
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
        <div>
          <p className="section-title">{title}</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
        </div>
        <Badge tone={items.length > 0 ? "warning" : "success"}>
          {items.length}
        </Badge>
      </div>
      {items.length === 0 ? (
        <div className="mt-3 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">
          {emptyText}
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100">
          {items.map((item) => {
            const content = (
              <div className="flex items-start gap-2 py-2.5">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="min-w-0 flex-1 truncate text-sm font-bold text-slate-950">
                      {item.title}
                    </p>
                    <Badge tone={item.tone ?? "neutral"}>{item.tone ?? "info"}</Badge>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-slate-500">
                    {item.meta}
                  </p>
                </div>
                {item.href ? (
                  <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-400" />
                ) : null}
              </div>
            );
            return (
              <li key={item.id}>
                {item.href ? (
                  <Link href={item.href} className="block hover:bg-slate-50">
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
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <p className="section-title">Lối tắt</p>
          <h2 className="mt-1 text-sm font-bold text-slate-950">
            Mở tác vụ thường dùng
          </h2>
        </div>
        <CheckCircle2 className="h-4 w-4 text-slate-400" aria-hidden="true" />
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="group rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-3 transition-colors duration-150 hover:border-sky-300 hover:bg-sky-50 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none"
            >
              <Icon className="h-4 w-4 text-sky-700" aria-hidden="true" />
              <p className="mt-2 text-sm font-bold text-slate-950">
                {item.label}
              </p>
              <p className="mt-0.5 text-xs leading-5 text-slate-500">
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
    <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center gap-2">
        <EyeOff className="h-4 w-4 text-slate-400" aria-hidden="true" />
        <h2 className="text-sm font-bold text-slate-900">{title}</h2>
      </div>
      <ul className="mt-2 grid gap-1.5 text-xs leading-5 text-slate-600 sm:grid-cols-2">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-300" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
