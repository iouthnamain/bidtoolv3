"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2, Eye, XCircle } from "lucide-react";

import { Badge } from "~/app/_components/ui";
import {
  getRoleLandingPath,
  ROLE_CAPABILITIES,
  ROLE_LABELS,
} from "~/lib/role-surfaces";
import { usePermissions } from "~/lib/use-permissions";

function ListColumn({
  title,
  items,
  icon,
}: {
  title: string;
  items: readonly string[];
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-3">
      <div className="flex items-center gap-2 text-xs font-bold tracking-wide text-slate-500 uppercase">
        {icon}
        {title}
      </div>
      <ul className="mt-2 space-y-1.5 text-xs leading-5 text-slate-600">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-300" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RoleHomeClient() {
  const { role, isPreview } = usePermissions();

  if (!role || role === "customer") {
    return null;
  }

  const capability = ROLE_CAPABILITIES[role];

  return (
    <section className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="info">{ROLE_LABELS[role]}</Badge>
            {isPreview ? <Badge tone="warning">Preview</Badge> : null}
          </div>
          <h2 className="mt-3 text-lg font-extrabold tracking-tight text-slate-950">
            Không gian làm việc theo vai trò
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
            {capability.summary}
          </p>
        </div>
        <Link
          href={getRoleLandingPath(role)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition-colors duration-150 hover:border-sky-300 hover:bg-sky-50 hover:text-sky-800 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none"
        >
          Mở landing
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <ListColumn
          title="Được xem"
          items={capability.see}
          icon={<Eye className="h-3.5 w-3.5" aria-hidden="true" />}
        />
        <ListColumn
          title="Được làm"
          items={capability.do}
          icon={<CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}
        />
        <ListColumn
          title="Không làm"
          items={capability.cannot}
          icon={<XCircle className="h-3.5 w-3.5" aria-hidden="true" />}
        />
      </div>
    </section>
  );
}
