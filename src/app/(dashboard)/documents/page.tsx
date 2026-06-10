import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { createPageMetadata } from "~/app/_lib/seo";
import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";

export const metadata = createPageMetadata({
  title: "Documents",
  description:
    "Mở nhanh hồ sơ thầu, file import vật tư và các tài liệu liên quan trong BidTool v3.",
  path: "/documents",
  keywords: ["hồ sơ thầu", "tài liệu đấu thầu", "file vật tư"],
});

const documentLinks = [
  {
    href: "/search",
    label: "Tìm nguồn thầu",
    description: "Mở kết quả BidWinner và chi tiết hồ sơ mời thầu.",
  },
  {
    href: "/materials/import",
    label: "Nhập file vật tư",
    description: "Upload Excel/CSV và kiểm tra preview trước khi nhập catalog.",
  },
  {
    href: "/materials/scrape",
    label: "Scrape shop vật tư",
    description: "Preview URL shop rồi nhập sản phẩm, giá và link nguồn.",
  },
  {
    href: "/saved-items",
    label: "Bộ lọc & Watchlist",
    description: "Quay lại Smart View hoặc nguồn đã lưu để theo dõi tiếp.",
  },
];

export default function DocumentsPage() {
  return (
    <DashboardShell
      title="Documents"
      description="Tài liệu và file liên quan đến nguồn thầu"
    >
      <section className="panel max-w-3xl p-4 sm:p-5">
        <p className="section-title">Documents</p>
        <h2 className="mt-1 text-base font-bold text-slate-950">
          Lối tắt tài liệu chính
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Trang này giữ tối thiểu các điểm cần mở khi kiểm tra hồ sơ thầu hoặc
          file vật tư.
        </p>

        <div className="mt-4 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {documentLinks.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="group flex items-center justify-between gap-4 px-3 py-3 transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              <span className="min-w-0">
                <span className="block text-sm font-bold text-slate-950">
                  {item.label}
                </span>
                <span className="mt-0.5 block text-xs leading-5 text-slate-600">
                  {item.description}
                </span>
              </span>
              <ChevronRight
                className="h-4 w-4 shrink-0 text-slate-400 group-hover:text-sky-700"
                aria-hidden="true"
              />
            </Link>
          ))}
        </div>
      </section>
    </DashboardShell>
  );
}
