import { Suspense } from "react";

import { EnrichJobsClient } from "~/app/_components/enrich/enrich-jobs-client";
import { createPageMetadata } from "~/app/_lib/seo";

export const dynamic = "force-dynamic";

type EnrichJobPageProps = {
  params: Promise<{ jobId: string }>;
};

export async function generateMetadata({ params }: EnrichJobPageProps) {
  const { jobId } = await params;

  return createPageMetadata({
    title: `Job nghiên cứu ${jobId.slice(0, 8)}`,
    description:
      "Theo dõi tiến độ nghiên cứu web, duyệt kết quả và xuất file Excel.",
    path: `/enrich/jobs/${jobId}`,
  });
}

export default async function EnrichJobDetailPage({ params }: EnrichJobPageProps) {
  const { jobId } = await params;

  return (
    <Suspense
      fallback={
        <div className="panel p-2 text-sm text-slate-600">
          Đang tải job nghiên cứu…
        </div>
      }
    >
      <EnrichJobsClient jobId={jobId} />
    </Suspense>
  );
}
