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
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium text-slate-900">{name}</p>
          <p className="mt-1 text-sm text-slate-600">Trigger: {triggerLabel}</p>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            isActive
              ? "bg-emerald-100 text-emerald-700"
              : "bg-slate-100 text-slate-600"
          }`}
        >
          {isActive ? "Đang bật" : "Đang tắt"}
        </span>
      </div>

      <button
        type="button"
        className="mt-4 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
        onClick={onRunNow}
      >
        Chạy ngay
      </button>
    </article>
  );
}
