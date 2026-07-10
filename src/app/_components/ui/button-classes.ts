/** Shared button surfaces for the dashboard's cool canvas and white panels. */

export const buttonBaseClass =
  "inline-flex max-w-full items-center justify-center gap-1.5 whitespace-nowrap font-semibold transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1 disabled:cursor-not-allowed disabled:opacity-50";

export const buttonVariantClass = {
  primary:
    "border border-brand bg-brand text-white shadow-[var(--shadow-flat)] hover:border-teal-800 hover:bg-teal-800 active:border-teal-900 active:bg-teal-900",
  secondary:
    "border border-line bg-surface-1 text-ink-1 shadow-[var(--shadow-flat)] hover:border-line-strong hover:bg-surface-2 active:bg-surface-3",
  ghost:
    "border border-transparent bg-transparent text-ink-2 hover:bg-surface-2 hover:text-ink-1 active:bg-surface-3",
  warning:
    "border border-amber-300 bg-amber-50 text-amber-950 shadow-[var(--shadow-flat)] hover:border-amber-400 hover:bg-amber-100 active:bg-amber-200",
  danger:
    "border border-rose-700 bg-rose-700 text-white shadow-[var(--shadow-flat)] hover:bg-rose-800 active:bg-rose-900",
} as const;

export const buttonSizeClass = {
  sm: "min-h-10 rounded-[var(--radius-panel)] px-3 py-1.5 text-sm",
  md: "min-h-11 rounded-[var(--radius-panel)] px-3.5 py-2 text-sm",
} as const;

/** Raw `<button>` / link actions that mirror `Button variant="secondary"`. */
export const inlineSecondaryButtonClass = `${buttonBaseClass} min-h-10 rounded-[var(--radius-panel)] border border-line bg-surface-1 px-3 py-2 text-sm text-ink-1 shadow-[var(--shadow-flat)] hover:border-line-strong hover:bg-surface-2 active:bg-surface-3`;

/** Icon-only actions on tables and toolbars. */
export const inlineIconButtonClass =
  "inline-flex max-w-full items-center justify-center rounded-[var(--radius-panel)] border border-line bg-surface-1 text-ink-2 shadow-[var(--shadow-flat)] transition-colors duration-150 hover:border-line-strong hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50";

/** Segmented tab / filter toggle when inactive. */
export const tabButtonInactiveClass =
  "border-line bg-surface-1 text-ink-1 shadow-[var(--shadow-flat)] hover:border-line-strong hover:bg-surface-2";

/** Step wizard nav — reachable but not current. */
export const stepNavReachableClass =
  "border border-line bg-surface-1 text-ink-1 shadow-[var(--shadow-flat)] hover:border-line-strong hover:bg-surface-2";
