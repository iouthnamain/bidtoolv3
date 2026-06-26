"use client";

import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "warning" | "danger";
type ButtonSize = "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

const variantClass: Record<ButtonVariant, string> = {
  primary:
    "border border-blue-800 bg-blue-700 text-white hover:bg-blue-800 active:bg-blue-900",
  secondary:
    "border border-slate-400 bg-white text-slate-800 shadow-[var(--shadow-flat)] hover:border-slate-500 hover:bg-slate-50 active:bg-slate-100",
  ghost: "text-slate-700 hover:bg-slate-100 hover:text-slate-900 active:bg-slate-200",
  warning:
    "border border-amber-400 bg-amber-50 text-amber-900 shadow-[var(--shadow-flat)] hover:border-amber-500 hover:bg-amber-100 active:bg-amber-200",
  danger:
    "border border-rose-700 bg-rose-600 text-white hover:bg-rose-700 active:bg-rose-800",
};

const sizeClass: Record<ButtonSize, string> = {
  sm: "min-h-10 rounded px-2 py-1 text-sm",
  md: "min-h-10 rounded px-3 py-1.5 text-base",
};

const baseClass =
  "inline-flex items-center justify-center gap-1 whitespace-nowrap font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "primary",
      size = "md",
      isLoading = false,
      disabled,
      className,
      children,
      type,
      leftIcon,
      rightIcon,
      ...rest
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type ?? "button"}
        disabled={isLoading ? true : disabled}
        aria-busy={isLoading ? true : undefined}
        className={`${baseClass} ${variantClass[variant]} ${sizeClass[size]} ${className ?? ""}`}
        {...rest}
      >
        {isLoading ? (
          <span
            className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
            aria-hidden="true"
          />
        ) : leftIcon ? (
          <span className="shrink-0" aria-hidden="true">
            {leftIcon}
          </span>
        ) : null}
        {children}
        {!isLoading && rightIcon ? (
          <span className="shrink-0" aria-hidden="true">
            {rightIcon}
          </span>
        ) : null}
      </button>
    );
  },
);
