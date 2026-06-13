import { Suspense } from "react";

import { WorkflowsLayoutClient } from "~/app/_components/dashboard/workflows-layout-client";

export default function WorkflowsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <WorkflowsLayoutClient>
      <Suspense
        fallback={
          <div className="rounded-2xl border border-slate-200/80 bg-white/95 px-4 py-6 text-sm text-slate-600 shadow-sm">
            Đang tải dữ liệu workflow…
          </div>
        }
      >
        {children}
      </Suspense>
    </WorkflowsLayoutClient>
  );
}
