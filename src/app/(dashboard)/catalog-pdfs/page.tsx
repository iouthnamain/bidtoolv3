import { Suspense } from "react";

import { createPageMetadata } from "~/app/_lib/seo";
import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { catalogPdfSectionNavItems } from "~/app/_components/dashboard/page-nav-presets";
import { CatalogPdfLibraryClient } from "~/app/_components/materials/catalog-pdf-library-client";
import { SkeletonTable } from "~/app/_components/ui";

export const dynamic = "force-dynamic";

export const metadata = createPageMetadata({
  title: "Catalog PDFs",
  description:
    "Thư viện tài liệu catalog PDF: upload, lưu URL nguồn và gắn với vật tư.",
});

export default function CatalogPdfsPage() {
  return (
    <DashboardShell
      title="Catalog PDFs"
      description="Quản lý tài liệu catalog của sản phẩm và liên kết nhiều vật tư với một tài liệu"
      sectionNavItems={catalogPdfSectionNavItems}
      sectionNavTitle="Thư viện catalog"
    >
      <Suspense fallback={<SkeletonTable rows={8} cols={4} />}>
        <CatalogPdfLibraryClient />
      </Suspense>
    </DashboardShell>
  );
}
