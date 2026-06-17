"use client";

import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
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
    "bg-sky-700 text-white shadow-[0_1px_2px_rgba(3,105,161,0.25)] hover:bg-sky-800 hover:shadow-[0_2px_6px_rgba(3,105,161,0.35)] active:bg-sky-900",
  secondary:
    "border border-slate-300 bg-white text-slate-700 shadow-[var(--shadow-flat)] hover:border-slate-400 hover:bg-slate-50 active:bg-slate-100",
  ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900 active:bg-slate-200",
  danger:
    "bg-rose-600 text-white shadow-[0_1px_2px_rgba(190,18,60,0.2)] hover:bg-rose-700 hover:shadow-[0_2px_6px_rgba(190,18,60,0.3)] active:bg-rose-800",
};

const sizeClass: Record<ButtonSize, string> = {
  sm: "min-h-10 rounded-lg px-3 py-1.5 text-xs sm:min-h-8 sm:px-2.5 sm:py-1",
  md: "min-h-11 rounded-lg px-4 py-2 text-sm sm:min-h-9 sm:px-3.5",
};

const baseClass =
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

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
            className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
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
