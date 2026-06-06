import { useId, type ReactNode } from "react";

interface FilterFieldProps {
  label: string;
  helper?: string;
  error?: string;
  required?: boolean;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}

export function FilterField({
  label,
  helper,
  error,
  required,
  htmlFor,
  children,
  className,
}: FilterFieldProps) {
  const autoId = useId();
  const messageId = `${autoId}-msg`;
  const hasMessage = !!(error ?? helper);

  const labelEl = (
    <span
      className={`text-xs font-semibold tracking-[0.12em] uppercase ${error ? "text-rose-600" : "text-slate-600"}`}
    >
      {label}
      {required ? (
        <span className="ml-0.5 text-rose-500" aria-hidden>
          *
        </span>
      ) : null}
    </span>
  );

  const messageEl = error ? (
    <span id={messageId} role="alert" className="text-xs text-rose-600">
      {error}
    </span>
  ) : helper ? (
    <span id={messageId} className="text-xs text-slate-500">
      {helper}
    </span>
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
    <label
      className={`flex flex-col gap-1 ${className ?? ""}`}
      aria-describedby={hasMessage ? messageId : undefined}
    >
      {labelEl}
      {children}
      {messageEl}
    </label>
  );
}
