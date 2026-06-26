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
      className={`relative overflow-hidden rounded border p-2 ${
        accent
          ? "border-blue-300 bg-blue-50"
          : "border-slate-500 bg-white shadow-sm"
      }`}
    >
      <div
        className={`absolute inset-x-0 top-0 h-[3px] ${
          accent ? "bg-brand" : "bg-slate-400"
        }`}
      />

      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-bold tracking-[0.12em] text-slate-700 uppercase">
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
        <p className="mt-2 text-xs font-medium text-slate-700">{hint}</p>
      ) : null}
    </article>
  );
}
