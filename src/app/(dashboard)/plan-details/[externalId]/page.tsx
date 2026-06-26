import { Suspense } from "react";
import { type Metadata } from "next";

import { createPageMetadata } from "~/app/_lib/seo";
import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { BidWinnerSourceDetailsPageClient } from "~/app/_components/dashboard/package-details-page-client";
import { sourceDetailSectionNavItems } from "~/app/_components/dashboard/page-nav-presets";
import { HydrateClient, api } from "~/trpc/server";

type PlanDetailsPageProps = {
  params: Promise<{
    externalId: string;
  }>;
  searchParams: Promise<{
    sourceUrl?: string;
  }>;
};

export async function generateMetadata({
  params,
}: PlanDetailsPageProps): Promise<Metadata> {
  const { externalId } = await params;

  return createPageMetadata({
    title: `Chi tiết KHLCNT ${externalId}`,
    description:
      "Xem chi tiết kế hoạch lựa chọn nhà thầu từ BidWinner, link nguồn và dữ liệu trích xuất.",
    path: `/plan-details/${externalId}`,
    keywords: ["KHLCNT", "kế hoạch lựa chọn nhà thầu", "BidWinner"],
  });
}

function prefetchPlanDetailsPageData(input: {
  externalId: string;
  sourceUrl?: string;
}) {
  void api.search.getSourceDetails.prefetch({
    entityType: "plan",
    externalId: input.externalId,
    sourceUrl: input.sourceUrl?.trim() ? input.sourceUrl : undefined,
  });
}

export default async function PlanDetailsPage({
  params,
  searchParams,
}: PlanDetailsPageProps) {
  const { externalId } = await params;
  const { sourceUrl } = await searchParams;

  prefetchPlanDetailsPageData({ externalId, sourceUrl });

  return (
    <DashboardShell
      title="Chi tiết KHLCNT từ trang nguồn"
      description="Hiển thị source URL, heuristic extraction và toàn bộ link khả dụng từ BidWinner public"
      sectionNavItems={sourceDetailSectionNavItems}
      sectionNavTitle="Khu vực chi tiết"
    >
      <HydrateClient>
        <Suspense
          fallback={
            <div className="rounded border border-slate-400/80 bg-white/95 px-4 py-6 text-sm text-slate-600 shadow-sm">
              Đang tải chi tiết KHLCNT…
            </div>
          }
        >
          <BidWinnerSourceDetailsPageClient
            entityType="plan"
            externalId={externalId}
            sourceUrl={sourceUrl}
          />
        </Suspense>
      </HydrateClient>
    </DashboardShell>
  );
}
