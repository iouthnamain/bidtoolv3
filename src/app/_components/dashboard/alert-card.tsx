import { AlertTriangle, Info, XCircle } from "lucide-react";

interface AlertCardProps {
  title: string;
  body: string;
  severity: "high" | "medium" | "low";
}

const severityConfig: Record<
  AlertCardProps["severity"],
  {
    bar: string;
    bg: string;
    border: string;
    title: string;
    body: string;
    label: string;
    labelBg: string;
    icon: typeof XCircle;
  }
> = {
  high: {
    bar: "bg-rose-600",
    bg: "bg-rose-50",
    border: "border-rose-200",
    title: "text-rose-950",
    body: "text-rose-800",
    label: "text-rose-700",
    labelBg: "bg-rose-100 border-rose-200",
    icon: XCircle,
  },
  medium: {
    bar: "bg-amber-500",
    bg: "bg-amber-50",
    border: "border-amber-200",
    title: "text-amber-950",
    body: "text-amber-800",
    label: "text-amber-700",
    labelBg: "bg-amber-100 border-amber-200",
    icon: AlertTriangle,
  },
  low: {
    bar: "bg-blue-500",
    bg: "bg-blue-50",
    border: "border-blue-200",
    title: "text-blue-950",
    body: "text-blue-800",
    label: "text-blue-700",
    labelBg: "bg-blue-100 border-blue-200",
    icon: Info,
  },
};

const severityLabel: Record<AlertCardProps["severity"], string> = {
  high: "Cao",
  medium: "Trung bình",
  low: "Thấp",
};

export function AlertCard({ title, body, severity }: AlertCardProps) {
  const cfg = severityConfig[severity];
  const Icon = cfg.icon;

  return (
    <article
      className={`relative overflow-hidden rounded border ${cfg.bg} ${cfg.border} p-3.5`}
    >
      {/* Left severity bar */}
      <div className={`absolute inset-y-0 left-0 w-1 ${cfg.bar}`} />

      <div className="ml-3 flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <Icon
            className={`mt-0.5 h-4 w-4 shrink-0 ${cfg.label}`}
            aria-hidden
          />
          <p className={`min-w-0 text-sm font-semibold [overflow-wrap:anywhere] ${cfg.title}`}>
            {title}
          </p>
        </div>
        <span
          className={`shrink-0 rounded border px-1.5 py-0.5 text-xs font-bold ${cfg.labelBg} ${cfg.label}`}
        >
          {severityLabel[severity]}
        </span>
      </div>
      <p className={`ml-3 mt-1.5 pl-6 text-xs leading-relaxed ${cfg.body}`}>
        {body}
      </p>
    </article>
  );
}
