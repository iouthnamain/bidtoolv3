interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={`relative overflow-hidden rounded bg-slate-100 after:absolute after:inset-0 after:-translate-x-full after:animate-[shimmer_1.6s_infinite] after:bg-gradient-to-r after:from-transparent after:via-white/60 after:to-transparent ${className ?? ""}`}
    />
  );
}

export function SkeletonText({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={`space-y-2 ${className ?? ""}`} aria-hidden>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={`h-3.5 ${i === lines - 1 ? "w-2/3" : "w-full"}`}
        />
      ))}
    </div>
  );
}

export function SkeletonCard({ className }: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={`rounded border border-slate-400 bg-white p-4 ${className ?? ""}`}
    >
      <div className="flex items-center gap-1">
        <Skeleton className="h-10 w-10 rounded" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-3.5 w-1/3" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      </div>
      <div className="mt-4 space-y-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
      </div>
    </div>
  );
}

export function SkeletonKpi() {
  return (
    <div
      aria-hidden
      className="rounded border border-slate-400 bg-white p-4"
    >
      <Skeleton className="mb-3 h-3 w-20" />
      <Skeleton className="h-8 w-20" />
      <Skeleton className="mt-2.5 h-3 w-24" />
    </div>
  );
}

export function SkeletonTable({
  rows = 5,
  cols = 4,
  className,
}: {
  rows?: number;
  cols?: number;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={`overflow-hidden rounded border border-slate-400 bg-white ${className ?? ""}`}
    >
      <div className="border-b border-slate-400 bg-slate-50/80 px-4 py-3">
        <div className="flex gap-2">
          {Array.from({ length: cols }).map((_, i) => (
            <Skeleton key={i} className="h-3 flex-1" />
          ))}
        </div>
      </div>
      <div className="divide-y divide-slate-50">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex gap-2 px-4 py-3.5">
            {Array.from({ length: cols }).map((_, j) => (
              <Skeleton
                key={j}
                className={`h-3 flex-1 ${j === 0 ? "w-2/5" : ""}`}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="space-y-4" aria-label="Đang tải…" role="status">
      <div className="flex items-center gap-1">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-8 w-24 rounded" />
      </div>
      <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-4">
        <SkeletonKpi />
        <SkeletonKpi />
        <SkeletonKpi />
        <SkeletonKpi />
      </div>
      <SkeletonTable rows={6} cols={5} />
    </div>
  );
}
