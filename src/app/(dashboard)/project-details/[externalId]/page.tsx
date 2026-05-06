import { Suspense } from "react";

import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { BidWinnerSourceDetailsPageClient } from "~/app/_components/dashboard/package-details-page-client";

type ProjectDetailsPageProps = {
  params: Promise<{
    externalId: string;
  }>;
  searchParams: Promise<{
    sourceUrl?: string;
  }>;
};

export default async function ProjectDetailsPage({
  params,
  searchParams,
}: ProjectDetailsPageProps) {
  const { externalId } = await params;
  const { sourceUrl } = await searchParams;

  return (
    <DashboardShell
      title="Chi tiết dự án từ trang nguồn"
      description="Hiển thị source URL, heuristic extraction và toàn bộ link khả dụng từ BidWinner public"
    >
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
    </DashboardShell>
  );
}
