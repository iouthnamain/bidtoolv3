interface AlertCardProps {
  title: string;
  body: string;
  severity: "high" | "medium" | "low";
}

const severityClass: Record<AlertCardProps["severity"], string> = {
  high: "bg-rose-50 text-rose-700 border-rose-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  low: "bg-sky-50 text-sky-700 border-sky-200",
};

const severityLabel: Record<AlertCardProps["severity"], string> = {
  high: "Cao",
  medium: "Trung bình",
  low: "Thấp",
};

export function AlertCard({ title, body, severity }: AlertCardProps) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium text-slate-900">{title}</p>
        <span
          className={`rounded-full border px-2 py-0.5 text-xs font-medium ${severityClass[severity]}`}
        >
          {severityLabel[severity]}
        </span>
      </div>
      <p className="mt-2 text-sm text-slate-600">{body}</p>
    </article>
  );
}
