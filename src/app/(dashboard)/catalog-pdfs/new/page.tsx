import { Suspense } from "react";

import { createPageMetadata } from "~/app/_lib/seo";
import { CatalogPdfLibraryClient } from "~/app/_components/materials/catalog-pdf-library-client";

export const dynamic = "force-dynamic";

export const metadata = createPageMetadata({
  title: "Thêm tài liệu catalog PDF",
  description: "Tạo tài liệu catalog từ URL PDF hoặc upload tệp.",
  path: "/catalog-pdfs/new",
});

export default function CatalogPdfsNewPage() {
  return (
    <Suspense fallback={<div className="panel p-2 text-sm text-slate-600">Đang tải…</div>}>
      <CatalogPdfLibraryClient view="new" />
    </Suspense>
  );
}
