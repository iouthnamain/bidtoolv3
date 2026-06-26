import { Suspense } from "react";
import { type Metadata } from "next";

import { createPageMetadata } from "~/app/_lib/seo";
import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { PackageDetailsPageClient } from "~/app/_components/dashboard/package-details-page-client";
import { sourceDetailSectionNavItems } from "~/app/_components/dashboard/page-nav-presets";
import { HydrateClient, api } from "~/trpc/server";

type PackageDetailsPageProps = {
  params: Promise<{
    externalId: string;
  }>;
  searchParams: Promise<{
    sourceUrl?: string;
  }>;
};

export async function generateMetadata({
  params,
}: PackageDetailsPageProps): Promise<Metadata> {
  const { externalId } = await params;

  return createPageMetadata({
    title: `Chi tiết gói thầu ${externalId}`,
    description:
      "Xem chi tiết gói thầu từ trang nguồn BidWinner, link tài liệu, sản phẩm trích xuất và thông tin liên quan.",
    path: `/package-details/${externalId}`,
    keywords: ["chi tiết gói thầu", "BidWinner", "hồ sơ mời thầu"],
  });
}

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
      sectionNavItems={sourceDetailSectionNavItems}
      sectionNavTitle="Khu vực chi tiết"
    >
      <HydrateClient>
        <Suspense
          fallback={
            <div className="rounded border border-slate-400/80 bg-white/95 px-4 py-6 text-sm text-slate-600 shadow-sm">
              Đang tải chi tiết gói thầu…
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
