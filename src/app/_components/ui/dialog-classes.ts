/** Native `<dialog>` surfaces — sized to content, not full-viewport overlays. */

export const modalDialogClass =
  "w-[min(100vw-2rem,28rem)] max-h-[min(90dvh,100%)] overflow-hidden rounded border border-slate-500 bg-white p-0 shadow-[var(--shadow-overlay)] backdrop:bg-slate-900/45";

export const wideModalDialogClass =
  "m-0 flex max-h-[min(92dvh,920px)] w-[min(960px,calc(100vw-2rem))] flex-col overflow-hidden rounded border border-slate-500 bg-white p-0 shadow-[var(--shadow-overlay)] backdrop:bg-slate-950/50";
