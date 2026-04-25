import { Badge } from "~/app/_components/ui";

interface KpiCardProps {
  label: string;
  value: string | number;
  hint?: string;
  trend?: "up" | "down";
}

export function KpiCard({ label, value, hint, trend }: KpiCardProps) {
  return (
    <article className="panel rounded-xl p-4 transition-colors hover:border-slate-300">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold tracking-[0.14em] text-slate-500 uppercase">
          {label}
        </p>
        {trend ? (
          <Badge tone={trend === "up" ? "success" : "critical"}>
            {trend === "up" ? "Tăng" : "Giảm"}
          </Badge>
        ) : null}
      </div>
      <p className="mt-2 text-3xl leading-none font-bold tracking-tight text-slate-900">
        {value}
      </p>
      {hint ? <p className="mt-1.5 text-xs text-slate-500">{hint}</p> : null}
    </article>
  );
}
