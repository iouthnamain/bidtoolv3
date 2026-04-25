import type { ReactNode } from "react";

type BadgeTone = "neutral" | "success" | "warning" | "critical" | "info";

interface BadgeProps {
  tone?: BadgeTone;
  count?: number;
  children?: ReactNode;
  className?: string;
}

const toneClass: Record<BadgeTone, string> = {
  neutral: "border-slate-300 bg-slate-100 text-slate-700",
  success: "border-emerald-300 bg-emerald-50 text-emerald-700",
  warning: "border-amber-300 bg-amber-50 text-amber-800",
  critical: "border-rose-300 bg-rose-50 text-rose-700",
  info: "border-sky-300 bg-sky-50 text-sky-700",
};

export function Badge({
  tone = "neutral",
  count,
  children,
  className,
}: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${toneClass[tone]} ${className ?? ""}`}
    >
      {children}
      {typeof count === "number" ? (
        <span className="rounded-full bg-white/70 px-1 text-[11px] leading-tight tabular-nums">
          {count}
        </span>
      ) : null}
    </span>
  );
}
