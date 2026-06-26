import { Suspense } from "react";

import { createPageMetadata } from "~/app/_lib/seo";
import { MaterialScrapeClient } from "~/app/_components/materials/scrape-client";

export const dynamic = "force-dynamic";

type ScrapeJobPageProps = {
  params: Promise<{ jobId: string }>;
};

export async function generateMetadata({ params }: ScrapeJobPageProps) {
  const { jobId } = await params;

  return createPageMetadata({
    title: `Scrape job ${jobId.slice(0, 8)}`,
    description: "Theo dõi tiến độ scrape, duyệt sản phẩm và nhập vào catalog.",
    path: `/materials/scrape/jobs/${jobId}`,
  });
}

export default async function ScrapeJobPage({ params }: ScrapeJobPageProps) {
  const { jobId } = await params;

  return (
    <Suspense
      fallback={
        <div className="panel p-2 text-sm text-slate-600">
          Đang tải job scrape…
        </div>
      }
    >
      <MaterialScrapeClient jobId={jobId} />
    </Suspense>
  );
}
