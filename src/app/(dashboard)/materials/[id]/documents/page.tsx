import { type Metadata } from "next";
import { notFound } from "next/navigation";

import { createPageMetadata } from "~/app/_lib/seo";
import { MaterialDetailClient } from "~/app/_components/materials/detail-client";
import { HydrateClient, api } from "~/trpc/server";

type MaterialDocumentsPageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({
  params,
}: MaterialDocumentsPageProps): Promise<Metadata> {
  const { id } = await params;

  return createPageMetadata({
    title: `Catalog PDF vật tư #${id}`,
    description: "Tài liệu catalog PDF gắn với vật tư.",
    path: `/materials/${id}/documents`,
  });
}

export default async function MaterialDocumentsPage({
  params,
}: MaterialDocumentsPageProps) {
  const { id: rawId } = await params;
  const id = Number.parseInt(rawId, 10);

  if (!Number.isInteger(id) || id <= 0) {
    notFound();
  }

  void api.material.getById.prefetch({ id });

  return (
    <HydrateClient>
      <MaterialDetailClient id={id} view="documents" />
    </HydrateClient>
  );
}
