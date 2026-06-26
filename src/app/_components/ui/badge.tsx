import type { ReactNode } from "react";

type BadgeTone = "neutral" | "success" | "warning" | "critical" | "info";

interface BadgeProps {
  tone?: BadgeTone;
  count?: number;
  children?: ReactNode;
  className?: string;
}

const toneClass: Record<BadgeTone, string> = {
  neutral: "border-slate-400 bg-slate-100 text-slate-600",
  success: "border-emerald-200 bg-emerald-50 text-emerald-700 font-bold",
  warning: "border-amber-300 bg-amber-100 text-amber-800 font-bold",
  critical: "border-rose-300 bg-rose-100 text-rose-700 font-bold",
  info: "border-blue-200 bg-blue-100 text-blue-700 font-bold",
};

export function Badge({
  tone = "neutral",
  count,
  children,
  className,
}: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold leading-tight ${toneClass[tone]} ${className ?? ""}`}
    >
      {children}
      {typeof count === "number" ? (
        <span className="rounded-full bg-white/70 px-1.5 text-xs font-bold leading-tight tabular-nums">
          {count}
        </span>
      ) : null}
    </span>
  );
}
