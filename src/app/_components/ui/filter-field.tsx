import type { ReactNode } from "react";

interface FilterFieldProps {
  label: string;
  helper?: string;
  error?: string;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}

export function FilterField({
  label,
  helper,
  error,
  htmlFor,
  children,
  className,
}: FilterFieldProps) {
  const labelEl = (
    <span className="text-xs font-semibold tracking-[0.12em] text-slate-600 uppercase">
      {label}
    </span>
  );

  const messageEl = error ? (
    <span className="text-xs text-rose-600">{error}</span>
  ) : helper ? (
    <span className="text-xs text-slate-500">{helper}</span>
  ) : null;

  if (htmlFor) {
    return (
      <div className={`flex flex-col gap-1 ${className ?? ""}`}>
        <label htmlFor={htmlFor}>{labelEl}</label>
        {children}
        {messageEl}
      </div>
    );
  }

  return (
    <label className={`flex flex-col gap-1 ${className ?? ""}`}>
      {labelEl}
      {children}
      {messageEl}
    </label>
  );
}
