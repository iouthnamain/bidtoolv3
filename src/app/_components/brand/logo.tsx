import Link from "next/link";
import type { CSSProperties, HTMLAttributes } from "react";

export const BRAND_GRADIENT_FROM = "#0e7490";
export const BRAND_GRADIENT_VIA = "#075985";
export const BRAND_GRADIENT_TO = "#115e59";
export const BRAND_ACCENT = "#5eead4";

const sizeClasses = {
  sm: "h-8 w-8",
  md: "h-9 w-9",
  lg: "h-12 w-12",
} as const;

type LogoMarkProps = HTMLAttributes<HTMLSpanElement> & {
  size?: keyof typeof sizeClasses;
};

export function LogoMark({
  size = "md",
  className,
  style,
  ...rest
}: LogoMarkProps) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded bg-gradient-to-br from-cyan-700 via-blue-800 to-teal-800 text-white shadow-sm ${sizeClasses[size]} ${className ?? ""}`}
      style={style}
      aria-hidden
      {...rest}
    >
      <LogoGlyph className="h-[60%] w-[60%]" />
    </span>
  );
}

export function LogoGlyph({
  className,
  style,
  title,
}: {
  className?: string;
  style?: CSSProperties;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      style={style}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      fill="none"
    >
      <path
        d="M5.5 4h6.8a4.2 4.2 0 0 1 4.2 4.2 3.8 3.8 0 0 1-1.6 3.1 4.2 4.2 0 0 1 2.1 3.7A4.2 4.2 0 0 1 12.8 19H5.5V4Zm3 2.6v3.6h3.7a1.8 1.8 0 0 0 0-3.6H8.5Zm0 6.1V16.4h4.2a1.85 1.85 0 0 0 0-3.7H8.5Z"
        fill="currentColor"
      />
      <path
        d="m18.4 8.6 1.6 1.6 3.2-3.2"
        stroke={BRAND_ACCENT}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type LogoProps = {
  collapsed?: boolean;
  href?: string;
  ariaLabel?: string;
  size?: keyof typeof sizeClasses;
  tagline?: string;
  className?: string;
};

export function Logo({
  collapsed = false,
  href = "/dashboard",
  ariaLabel = "BidTool v3 — về trang tổng quan",
  size = "md",
  tagline = "v3 • Procurement",
  className,
}: LogoProps) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2.5 rounded px-1 py-1 transition-colors duration-0 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:outline-none ${className ?? ""}`}
      aria-label={ariaLabel}
    >
      <LogoMark size={size} />
      {!collapsed ? (
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="text-sm font-bold tracking-tight text-slate-900">
            BidTool
          </span>
          <span className="text-xs font-medium tracking-[0.14em] text-slate-700 uppercase">
            {tagline}
          </span>
        </span>
      ) : null}
    </Link>
  );
}
