interface WorkflowCardProps {
  name: string;
  triggerLabel: string;
  isActive: boolean;
  onRunNow: () => void;
}

export function WorkflowCard({
  name,
  triggerLabel,
  isActive,
  onRunNow,
}: WorkflowCardProps) {
  return (
    <article className="panel rounded-xl p-3 transition-all hover:border-slate-300">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-tight text-slate-900 [overflow-wrap:anywhere]">
            {name}
          </p>
          <p className="mt-0.5 text-[10px] text-slate-500">Trigger: {triggerLabel}</p>
        </div>
        <span
          className={`inline-block shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
            isActive
              ? "border border-emerald-400 bg-emerald-100 text-emerald-700"
              : "border border-slate-300 bg-slate-100 text-slate-600"
          }`}
        >
          {isActive ? "Active" : "Paused"}
        </span>
      </div>

      <button
        type="button"
        className="mt-2 w-full rounded-lg bg-sky-700 px-2 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-sky-800"
        onClick={onRunNow}
      >
        Run now
      </button>
    </article>
  );
}
