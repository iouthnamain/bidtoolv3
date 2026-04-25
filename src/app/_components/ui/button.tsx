"use client";

import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
}

const variantClass: Record<ButtonVariant, string> = {
  primary: "bg-sky-700 text-white hover:bg-sky-800",
  secondary:
    "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
  ghost: "text-slate-700 hover:bg-slate-100",
  danger: "bg-rose-600 text-white hover:bg-rose-700",
};

const sizeClass: Record<ButtonSize, string> = {
  sm: "rounded-md px-2.5 py-1 text-xs",
  md: "rounded-lg px-3 py-2 text-sm",
};

const baseClass =
  "inline-flex items-center justify-center gap-1.5 font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60";

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
      ...rest
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type ?? "button"}
        disabled={isLoading ? true : disabled}
        className={`${baseClass} ${variantClass[variant]} ${sizeClass[size]} ${className ?? ""}`}
        {...rest}
      >
        {isLoading ? (
          <span
            className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
            aria-hidden="true"
          />
        ) : null}
        {children}
      </button>
    );
  },
);
