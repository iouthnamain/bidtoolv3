import { Suspense } from "react";

import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { PackageDetailsPageClient } from "~/app/_components/dashboard/package-details-page-client";
import { HydrateClient, api } from "~/trpc/server";

type PackageDetailsPageProps = {
  params: Promise<{
    externalId: string;
  }>;
  searchParams: Promise<{
    sourceUrl?: string;
  }>;
};

function prefetchPackageDetailsPageData(input: {
  externalId: string;
  sourceUrl?: string;
}) {
  void api.search.getSourceDetails.prefetch({
    entityType: "package",
    externalId: input.externalId,
    sourceUrl: input.sourceUrl?.trim() ? input.sourceUrl : undefined,
  });
}

export default async function PackageDetailsPage({
  params,
  searchParams,
}: PackageDetailsPageProps) {
  const { externalId } = await params;
  const { sourceUrl } = await searchParams;

  prefetchPackageDetailsPageData({ externalId, sourceUrl });

  return (
    <DashboardShell
      title="Chi tiết từ trang nguồn"
      description="Hiển thị source URL, products parse theo heuristic và toàn bộ link khả dụng"
    >
      <HydrateClient>
        <Suspense
          fallback={
            <div className="rounded-2xl border border-slate-200/80 bg-white/95 px-4 py-6 text-sm text-slate-600 shadow-sm">
              Đang tải chi tiết gói thầu...
            </div>
          }
        >
          <PackageDetailsPageClient
            externalId={externalId}
            sourceUrl={sourceUrl}
          />
        </Suspense>
      </HydrateClient>
    </DashboardShell>
  );
}
