import { Suspense } from "react";

import { MaterialEnrichClient } from "~/app/_components/materials/enrich-client";
import { createPageMetadata } from "~/app/_lib/seo";

export const dynamic = "force-dynamic";

type EnrichJobPageProps = {
  params: Promise<{ jobId: string }>;
};

export async function generateMetadata({ params }: EnrichJobPageProps) {
  const { jobId } = await params;

  return createPageMetadata({
    title: `Job làm giàu ${jobId.slice(0, 8)}`,
    description:
      "Theo dõi tiến độ enrichment, duyệt kết quả và commit vào catalog.",
    path: `/materials/enrich/jobs/${jobId}`,
  });
}

export default async function MaterialEnrichJobPage({ params }: EnrichJobPageProps) {
  const { jobId } = await params;

  return (
    <Suspense
      fallback={
        <div className="panel p-5 text-sm text-slate-600">
          Đang tải job làm giàu…
        </div>
      }
    >
      <MaterialEnrichClient jobId={jobId} />
    </Suspense>
  );
}
