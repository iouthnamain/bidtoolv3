import { type Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { createPageMetadata } from "~/app/_lib/seo";
import { CatalogPdfLibraryClient } from "~/app/_components/materials/catalog-pdf-library-client";

type CatalogPdfDetailPageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({
  params,
}: CatalogPdfDetailPageProps): Promise<Metadata> {
  const { id } = await params;

  return createPageMetadata({
    title: `Catalog PDF #${id}`,
    description: "Chi tiết tài liệu catalog, metadata và liên kết vật tư.",
    path: `/catalog-pdfs/${id}`,
  });
}

export default async function CatalogPdfDetailPage({
  params,
}: CatalogPdfDetailPageProps) {
  const { id: rawId } = await params;
  const id = Number.parseInt(rawId, 10);

  if (!Number.isInteger(id) || id <= 0) {
    notFound();
  }

  return (
    <Suspense fallback={<div className="panel p-5 text-sm text-slate-600">Đang tải…</div>}>
      <CatalogPdfLibraryClient view="detail" initialDocumentId={id} />
    </Suspense>
  );
}
