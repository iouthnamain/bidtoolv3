"use client";

import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

import {
  buttonBaseClass,
  buttonSizeClass,
  buttonVariantClass,
} from "~/app/_components/ui/button-classes";

type ButtonVariant = keyof typeof buttonVariantClass;
type ButtonSize = keyof typeof buttonSizeClass;

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

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
        className={`${buttonBaseClass} ${buttonVariantClass[variant]} ${buttonSizeClass[size]} ${className ?? ""}`}
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
