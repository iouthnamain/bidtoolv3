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
      className={`rounded border border-dashed border-slate-400 bg-slate-50 px-2 py-4 text-center ${className ?? ""}`}
    >
      {icon ? (
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded bg-white text-slate-600 shadow-[var(--shadow-raised)] ring-1 ring-slate-100">
          {icon}
        </div>
      ) : null}
      <p className="text-sm font-bold text-slate-800">{title}</p>
      {description ? (
        <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-slate-700">
          {description}
        </p>
      ) : null}
      {cta ? <div className="mt-4 flex justify-center">{cta}</div> : null}
    </div>
  );
}
