"use client";

import { Check } from "lucide-react";

export type ResearchEnrichStep = 1 | 2 | 3;

const STEPS: Array<{ id: ResearchEnrichStep; label: string }> = [
  { id: 1, label: "Tải lên & chạy job" },
  { id: 2, label: "Xét duyệt kết quả" },
  { id: 3, label: "Xuất file" },
];

export function ResearchEnrichStepHeader({
  current,
  maxReached,
  onJump,
}: {
  current: ResearchEnrichStep;
  maxReached: ResearchEnrichStep;
  onJump: (step: ResearchEnrichStep) => void;
}) {
  return (
    <nav
      aria-label="Các bước nghiên cứu Excel"
      className="panel flex flex-wrap items-center gap-2 p-2 sm:gap-1 sm:p-3"
    >
      {STEPS.map((step, index) => {
        const isCurrent = step.id === current;
        const isDone = step.id < current;
        const isReachable = step.id <= maxReached;

        return (
          <div key={step.id} className="flex items-center gap-1 sm:gap-2">
            <button
              type="button"
              disabled={!isReachable}
              onClick={() => isReachable && onJump(step.id)}
              aria-current={isCurrent ? "step" : undefined}
              className={`inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-bold transition-colors disabled:cursor-not-allowed sm:text-sm ${
                isCurrent
                  ? "bg-violet-700 text-white"
                  : isReachable
                    ? "text-slate-700 hover:bg-slate-100"
                    : "text-slate-400"
              }`}
            >
              <span
                className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] tabular-nums ${
                  isCurrent
                    ? "bg-white/20 text-white"
                    : isDone
                      ? "bg-emerald-600 text-white"
                      : "bg-slate-200 text-slate-600"
                }`}
              >
                {isDone ? <Check className="h-3 w-3" aria-hidden /> : step.id}
              </span>
              <span className="hidden sm:inline">{step.label}</span>
            </button>
            {index < STEPS.length - 1 ? (
              <span className="h-px w-3 bg-slate-300 sm:w-6" aria-hidden />
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}
