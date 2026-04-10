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
    <article className="rounded-lg border border-slate-300 hover:border-slate-400 bg-white hover:shadow-md p-2.5 shadow-xs transition-all">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-sm text-slate-900 leading-tight [overflow-wrap:anywhere]">{name}</p>
          <p className="mt-0.5 text-[10px] text-slate-500">🔄 {triggerLabel}</p>
        </div>
        <span
          className={`shrink-0 inline-block rounded-full text-[10px] font-bold px-2 py-1 ${
            isActive
              ? "bg-emerald-200 text-emerald-700 border border-emerald-400"
              : "bg-slate-200 text-slate-600 border border-slate-300"
          }`}
        >
          {isActive ? "ON" : "OFF"}
        </span>
      </div>

      <button
        type="button"
        className="mt-2 w-full rounded bg-sky-600 hover:bg-sky-700 text-white px-2 py-1.5 text-xs font-bold transition-colors"
        onClick={onRunNow}
      >
        Run
      </button>
    </article>
  );
}
}
