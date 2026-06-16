"use client";

import Link from "next/link";

import { Button } from "~/app/_components/ui";
import { ExcelResearchJobDetail } from "~/app/_components/enrich/excel-research-job-detail";
import { EnrichJobsList } from "~/app/_components/enrich/enrich-jobs-list";

export function EnrichJobsClient({ jobId }: { jobId?: string }) {
  const isJobPage = jobId != null;

  if (isJobPage) {
    return (
      <div className="space-y-4">
        <section className="panel p-4 sm:p-5">
          <Link
            href="/enrich/jobs"
            className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900"
          >
            ← Danh sách job nghiên cứu
          </Link>
        </section>
        <ExcelResearchJobDetail jobId={jobId} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="panel p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="section-title">Nghiên cứu web</p>
            <h2 className="mt-1 text-base font-bold text-slate-950">
              Job nghiên cứu Excel
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Xem và tiếp tục các job nghiên cứu sản phẩm đã tạo từ bước 3 của
              đối chiếu Excel.
            </p>
          </div>
          <Link href="/enrich">
            <Button variant="secondary" size="sm">
              Mở đối chiếu Excel
            </Button>
          </Link>
        </div>
      </section>

      <section className="panel p-4 sm:p-5">
        <EnrichJobsList
          emptyAction={
            <Link href="/enrich">
              <Button variant="primary" size="sm">
                Đi tới đối chiếu Excel
              </Button>
            </Link>
          }
        />
      </section>
    </div>
  );
}
