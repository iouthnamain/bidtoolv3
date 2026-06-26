/** Shared button surface classes — visible on white and slate-50 backgrounds. */

export const buttonBaseClass =
  "inline-flex max-w-full items-center justify-center gap-1 whitespace-nowrap font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50";

export const buttonVariantClass = {
  primary:
    "border border-blue-800 bg-blue-700 text-white hover:bg-blue-800 active:bg-blue-900",
  secondary:
    "border border-slate-500 bg-white text-slate-900 shadow-[var(--shadow-flat)] hover:border-slate-600 hover:bg-slate-100 active:bg-slate-200",
  ghost:
    "border border-slate-400 bg-white text-slate-800 shadow-[var(--shadow-flat)] hover:border-slate-500 hover:bg-slate-100 hover:text-slate-900 active:bg-slate-200",
  warning:
    "border border-amber-600 bg-white text-amber-950 shadow-[var(--shadow-flat)] hover:border-amber-700 hover:bg-amber-50 active:bg-amber-100",
  danger:
    "border border-rose-700 bg-rose-600 text-white hover:bg-rose-700 active:bg-rose-800",
} as const;

export const buttonSizeClass = {
  sm: "min-h-10 rounded px-2 py-1 text-sm",
  md: "min-h-10 rounded px-3 py-1.5 text-base",
} as const;

/** Raw `<button>` / link actions that mirror `Button variant="secondary"`. */
export const inlineSecondaryButtonClass = `${buttonBaseClass} min-h-10 rounded border border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900 shadow-[var(--shadow-flat)] transition-colors hover:border-slate-600 hover:bg-slate-100 active:bg-slate-200`;

/** Icon-only actions on tables and toolbars. */
export const inlineIconButtonClass =
  "inline-flex max-w-full items-center justify-center rounded border border-slate-500 bg-white text-slate-700 shadow-[var(--shadow-flat)] transition-colors hover:border-slate-600 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50";

/** Segmented tab / filter toggle when inactive. */
export const tabButtonInactiveClass =
  "border-slate-500 bg-white text-slate-900 shadow-sm hover:border-slate-600 hover:bg-slate-100";

/** Step wizard nav — reachable but not current. */
export const stepNavReachableClass =
  "border border-slate-400 bg-white text-slate-900 shadow-sm hover:border-slate-500 hover:bg-slate-100";
