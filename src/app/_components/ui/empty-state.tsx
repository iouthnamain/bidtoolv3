import type { ReactNode } from "react";

interface EmptyStateProps {
  title: string;
  description?: string;
  cta?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

export function EmptyState({
  title,
  description,
  cta,
  icon,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={`rounded-xl border border-dashed border-slate-200 bg-gradient-to-b from-slate-50 to-white px-6 py-8 text-center ${className ?? ""}`}
    >
      {icon ? (
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-white text-slate-400 shadow-[var(--shadow-raised)] ring-1 ring-slate-100">
          {icon}
        </div>
      ) : null}
      <p className="text-sm font-bold text-slate-800">{title}</p>
      {description ? (
        <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-slate-500">
          {description}
        </p>
      ) : null}
      {cta ? <div className="mt-4 flex justify-center">{cta}</div> : null}
    </div>
  );
}
