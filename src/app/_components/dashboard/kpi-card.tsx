interface KpiCardProps {
  label: string;
  value: string | number;
  hint?: string;
  trend?: "up" | "down";
}

export function KpiCard({ label, value, hint, trend }: KpiCardProps) {
  return (
    <article className="rounded-xl border border-slate-200 bg-gradient-to-br from-white via-slate-50/50 to-slate-50 p-3 shadow-xs backdrop-blur hover:border-slate-300 transition-colors">
      <div className="flex items-start justify-between">
        <p className="text-[10px] uppercase tracking-[0.16em] font-semibold text-slate-500">{label}</p>
        {trend ? (
          <span className={`text-xs font-bold ${trend === "up" ? "text-emerald-600" : "text-rose-600"}`}>
            {trend === "up" ? "↑" : "↓"}
          </span>
        ) : null}
      </div>
      <p className="mt-1.5 text-4xl font-bold tracking-tight text-slate-900 leading-none">{value}</p>
      {hint ? <p className="mt-1 text-[11px] text-slate-500">{hint}</p> : null}
    </article>
  );
}
