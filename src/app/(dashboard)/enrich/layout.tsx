import { Suspense } from "react";

import { EnrichLayoutClient } from "~/app/_components/dashboard/enrich-layout-client";

export const dynamic = "force-dynamic";

export default function EnrichLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <EnrichLayoutClient>
      <Suspense
        fallback={
          <div className="panel p-2 text-sm text-slate-600">
            Đang tải công cụ đối chiếu Excel…
          </div>
        }
      >
        {children}
      </Suspense>
    </EnrichLayoutClient>
  );
}
