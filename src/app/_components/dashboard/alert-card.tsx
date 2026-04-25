interface AlertCardProps {
  title: string;
  body: string;
  severity: "high" | "medium" | "low";
}

const severityClass: Record<AlertCardProps["severity"], string> = {
  high: "border-rose-300 bg-rose-50/90 text-rose-800 border-l-4 border-l-rose-600",
  medium:
    "border-amber-300 bg-amber-50/90 text-amber-800 border-l-4 border-l-amber-600",
  low: "border-sky-300 bg-sky-50/90 text-sky-800 border-l-4 border-l-sky-600",
};

const severityLabel: Record<AlertCardProps["severity"], string> = {
  high: "Cao",
  medium: "Trung bình",
  low: "Thấp",
};

export function AlertCard({ title, body, severity }: AlertCardProps) {
  return (
    <article
      className={`rounded-xl border p-3 shadow-sm backdrop-blur ${severityClass[severity]}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-sm font-semibold [overflow-wrap:anywhere]">
          {title}
        </p>
        <span className="shrink-0 rounded bg-white/60 px-1.5 py-0.5 text-xs font-semibold">
          {severityLabel[severity]}
        </span>
      </div>
      <p className="mt-1 text-xs leading-relaxed opacity-95">{body}</p>
    </article>
  );
}
