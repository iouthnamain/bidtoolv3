"use client";

import { Check } from "lucide-react";

import { stepNavReachableClass } from "~/app/_components/ui/button-classes";

export type EnrichStep = 1 | 2 | 3 | 4;

const STEPS: Array<{ id: EnrichStep; label: string }> = [
  { id: 1, label: "Tải lên & map cột" },
  { id: 2, label: "Đối chiếu catalog" },
  { id: 3, label: "Nghiên cứu web" },
  { id: 4, label: "Xuất file" },
];

export function StepHeader({
  current,
  maxReached,
  onJump,
}: {
  current: EnrichStep;
  /** Highest step the user has unlocked; earlier steps are clickable. */
  maxReached: EnrichStep;
  onJump: (step: EnrichStep) => void;
}) {
  const progressPercent = ((current - 1) / (STEPS.length - 1)) * 100;

  return (
    <nav
      aria-label="Các bước đối chiếu và nghiên cứu Excel"
      className="panel overflow-hidden rounded shadow-[var(--shadow-flat)]"
    >
      {/* Brand gradient progress bar */}
      <div
        className="h-1.5 w-full bg-slate-100"
        role="progressbar"
        aria-label="Tiến độ làm giàu Excel"
        aria-valuemin={1}
        aria-valuemax={STEPS.length}
        aria-valuenow={current}
      >
        <div
          className="brand-rule h-full transition-all duration-500 ease-out"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 p-2 sm:gap-1 sm:p-3">
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
                aria-label={`Bước ${step.id}: ${step.label}${
                  isReachable ? "" : " (chưa mở)"
                }`}
                className={`inline-flex items-center gap-2 rounded px-2.5 py-1.5 text-xs font-extrabold transition-colors disabled:cursor-not-allowed ${
                  isCurrent
                    ? "bg-blue-700 text-white"
                    : isReachable
                      ? stepNavReachableClass
                      : "text-slate-600"
                }`}
              >
                <span
                  className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-extrabold tabular-nums ${
                    isCurrent
                      ? "bg-white/20 text-white"
                      : isDone
                        ? "bg-emerald-600 text-white"
                        : "bg-slate-200 text-slate-900"
                  }`}
                >
                  {isDone ? <Check className="h-3 w-3" aria-hidden /> : step.id}
                </span>
                <span className="hidden sm:inline text-balance">{step.label}</span>
                <span className="sr-only sm:hidden">{step.label}</span>
              </button>
              {index < STEPS.length - 1 ? (
                <span className="h-px w-3 bg-slate-300 sm:w-6" aria-hidden />
              ) : null}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
