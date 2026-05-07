import { Suspense } from "react";

import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { BidWinnerSourceDetailsPageClient } from "~/app/_components/dashboard/package-details-page-client";
import { HydrateClient, api } from "~/trpc/server";

type ProjectDetailsPageProps = {
  params: Promise<{
    externalId: string;
  }>;
  searchParams: Promise<{
    sourceUrl?: string;
  }>;
};

function prefetchProjectDetailsPageData(input: {
  externalId: string;
  sourceUrl?: string;
}) {
  void api.search.getSourceDetails.prefetch({
    entityType: "project",
    externalId: input.externalId,
    sourceUrl: input.sourceUrl?.trim() ? input.sourceUrl : undefined,
  });
}

export default async function ProjectDetailsPage({
  params,
  searchParams,
}: ProjectDetailsPageProps) {
  const { externalId } = await params;
  const { sourceUrl } = await searchParams;

  prefetchProjectDetailsPageData({ externalId, sourceUrl });

  return (
    <DashboardShell
      title="Chi tiết dự án từ trang nguồn"
      description="Hiển thị source URL, heuristic extraction và toàn bộ link khả dụng từ BidWinner public"
    >
      <HydrateClient>
        <Suspense
          fallback={
            <div className="rounded-2xl border border-slate-200/80 bg-white/95 px-4 py-6 text-sm text-slate-600 shadow-sm">
              Đang tải chi tiết dự án...
            </div>
          }
        >
          <BidWinnerSourceDetailsPageClient
            entityType="project"
            externalId={externalId}
            sourceUrl={sourceUrl}
          />
        </Suspense>
      </HydrateClient>
    </DashboardShell>
  );
}
