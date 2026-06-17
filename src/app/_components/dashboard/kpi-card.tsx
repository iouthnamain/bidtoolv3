import { Badge } from "~/app/_components/ui";

interface KpiCardProps {
  label: string;
  value: string | number;
  hint?: string;
  trend?: "up" | "down";
  accent?: boolean;
}

export function KpiCard({ label, value, hint, trend, accent }: KpiCardProps) {
  return (
    <article
      className={`relative overflow-hidden rounded-xl border p-4 transition-all duration-200 hover:shadow-[var(--shadow-raised)] ${
        accent
          ? "border-sky-200 bg-gradient-to-br from-sky-50 to-white"
          : "border-slate-200/80 bg-white"
      }`}
    >
      {/* Top accent bar */}
      <div
        className={`absolute inset-x-0 top-0 h-[3px] ${
          accent
            ? "bg-gradient-to-r from-[var(--brand-from)] via-[var(--brand-via)] to-[var(--brand-to)]"
            : "bg-slate-200/60"
        }`}
      />

      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-bold tracking-[0.12em] text-slate-500 uppercase">
          {label}
        </p>
        {trend ? (
          <Badge tone={trend === "up" ? "warning" : "critical"}>
            {trend === "up" ? "↑" : "↓"}
          </Badge>
        ) : null}
      </div>
      <p className="stat-value mt-2.5 text-3xl leading-none font-extrabold text-slate-900">
        {value}
      </p>
      {hint ? (
        <p className="mt-2 text-[11px] font-medium text-slate-500">{hint}</p>
      ) : null}
    </article>
  );
}
