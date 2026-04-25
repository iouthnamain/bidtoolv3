import { Badge, Button } from "~/app/_components/ui";

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
    <article className="panel rounded-xl p-3 transition-colors hover:border-slate-300">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-tight font-semibold [overflow-wrap:anywhere] text-slate-900">
            {name}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            Trigger: {triggerLabel}
          </p>
        </div>
        <Badge tone={isActive ? "success" : "neutral"}>
          {isActive ? "Hoạt động" : "Tạm dừng"}
        </Badge>
      </div>

      <Button
        variant="primary"
        size="sm"
        className="mt-2 w-full"
        onClick={onRunNow}
      >
        Chạy ngay
      </Button>
    </article>
  );
}
