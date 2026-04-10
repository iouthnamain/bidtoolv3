interface AlertCardProps {
  title: string;
  body: string;
  severity: "high" | "medium" | "low";
}

const severityClass: Record<AlertCardProps["severity"], string> = {
  high: "bg-rose-500/10 text-rose-700 border-rose-300 border-l-4 border-l-rose-500",
  medium: "bg-amber-500/10 text-amber-700 border-amber-300 border-l-4 border-l-amber-500",
  low: "bg-sky-500/10 text-sky-700 border-sky-300 border-l-4 border-l-sky-500",
};

const severityLabel: Record<AlertCardProps["severity"], string> = {
  high: "Cao",
  medium: "Trung bình",
  low: "Thấp",
};

export function AlertCard({ title, body, severity }: AlertCardProps) {
  return (
    <article className={`rounded-lg border p-3 shadow-xs backdrop-blur ${severityClass[severity]}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 font-semibold [overflow-wrap:anywhere]">{title}</p>
        <span className="shrink-0 rounded text-xs font-semibold px-1.5 py-0.5 bg-white/40">
          {severityLabel[severity]}
        </span>
      </div>
      <p className="mt-1.5 text-sm leading-relaxed opacity-90">{body}</p>
    </article>
  );
}
