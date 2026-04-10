interface KpiCardProps {
  label: string;
  value: string | number;
  hint?: string;
  trend?: "up" | "down";
}

export function KpiCard({ label, value, hint, trend }: KpiCardProps) {
  return (
    <article className="panel rounded-xl p-3 transition-colors hover:border-slate-300">
      <div className="flex items-start justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
        {trend ? (
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
              trend === "up"
                ? "bg-emerald-100 text-emerald-700"
                : "bg-rose-100 text-rose-700"
            }`}
          >
            {trend === "up" ? "Up" : "Down"}
          </span>
        ) : null}
      </div>
      <p className="mt-1.5 text-3xl leading-none font-bold tracking-tight text-slate-900">{value}</p>
      {hint ? <p className="mt-1 text-[11px] text-slate-500">{hint}</p> : null}
    </article>
  );
}
