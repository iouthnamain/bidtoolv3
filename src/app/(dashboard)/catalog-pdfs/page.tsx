import { Suspense } from "react";

import { createPageMetadata } from "~/app/_lib/seo";
import { CatalogPdfLibraryClient } from "~/app/_components/materials/catalog-pdf-library-client";
import { SkeletonTable } from "~/app/_components/ui";

export const dynamic = "force-dynamic";

export const metadata = createPageMetadata({
  title: "Thư viện catalog PDF",
  description:
    "Thư viện tài liệu catalog PDF: upload, lưu URL nguồn và gắn với vật tư.",
  path: "/catalog-pdfs",
});

export default function CatalogPdfsPage() {
  return (
    <Suspense fallback={<SkeletonTable rows={8} cols={4} />}>
      <CatalogPdfLibraryClient view="library" />
    </Suspense>
  );
}
