import { Suspense } from "react";

import { ResearchEnrichLayoutClient } from "~/app/_components/dashboard/research-enrich-layout-client";

export const dynamic = "force-dynamic";

export default function ResearchEnrichLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ResearchEnrichLayoutClient>
      <Suspense
        fallback={
          <div className="panel p-2 text-sm text-slate-600">
            Đang tải công cụ nghiên cứu Excel…
          </div>
        }
      >
        {children}
      </Suspense>
    </ResearchEnrichLayoutClient>
  );
}
