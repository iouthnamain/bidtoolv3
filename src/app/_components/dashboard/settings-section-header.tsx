import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "~/app/_components/ui/badge";

type SettingsSectionHeaderProps = {
  eyebrow: string;
  title: string;
  description: string;
  icon: LucideIcon;
  iconClassName?: string;
  badge?: {
    label: string;
    tone: "neutral" | "success" | "warning" | "critical" | "info";
  };
  action?: ReactNode;
};

export function SettingsSectionHeader({
  eyebrow,
  title,
  description,
  icon: Icon,
  iconClassName = "bg-blue-50 text-blue-700",
  badge,
  action,
}: SettingsSectionHeaderProps) {
  return (
    <div className="flex flex-col gap-2 border-b border-slate-400 px-2 py-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-start gap-1">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded ${iconClassName}`}
        >
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="section-title">{eyebrow}</p>
            {badge ? <Badge tone={badge.tone}>{badge.label}</Badge> : null}
          </div>
          <h2 className="mt-1 text-base font-bold text-slate-950">{title}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            {description}
          </p>
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
