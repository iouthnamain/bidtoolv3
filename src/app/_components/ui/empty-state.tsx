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
      className={`rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center ${className ?? ""}`}
    >
      {icon ? (
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-400 ring-1 ring-slate-200">
          {icon}
        </div>
      ) : null}
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      {description ? (
        <p className="mx-auto mt-1 max-w-md text-xs text-slate-600">
          {description}
        </p>
      ) : null}
      {cta ? <div className="mt-3 flex justify-center">{cta}</div> : null}
    </div>
  );
}
