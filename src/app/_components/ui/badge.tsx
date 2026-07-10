import type { ReactNode } from "react";

type BadgeTone =
  | "neutral"
  | "success"
  | "warning"
  | "critical"
  | "info"
  | "brand";

interface BadgeProps {
  tone?: BadgeTone;
  count?: number;
  children?: ReactNode;
  className?: string;
}

const toneClass: Record<BadgeTone, string> = {
  neutral: "border-line bg-surface-2 text-ink-2",
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warning: "border-amber-300 bg-amber-50 text-amber-900",
  critical: "border-rose-300 bg-rose-50 text-rose-800",
  info: "border-sky-200 bg-sky-50 text-sky-800",
  brand: "border-teal-200 bg-teal-50 text-teal-800",
};

export function Badge({
  tone = "neutral",
  count,
  children,
  className,
}: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs leading-none font-semibold ${toneClass[tone]} ${className ?? ""}`}
    >
      {children}
      {typeof count === "number" ? (
        <span className="rounded-full bg-white/80 px-1.5 py-0.5 text-xs leading-none font-bold tabular-nums">
          {count}
        </span>
      ) : null}
    </span>
  );
}
