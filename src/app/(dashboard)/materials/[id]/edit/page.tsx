import { type Metadata } from "next";
import { notFound } from "next/navigation";

import { createPageMetadata } from "~/app/_lib/seo";
import { MaterialDetailClient } from "~/app/_components/materials/detail-client";
import { HydrateClient, api } from "~/trpc/server";

type MaterialEditPageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({
  params,
}: MaterialEditPageProps): Promise<Metadata> {
  const { id } = await params;

  return createPageMetadata({
    title: `Chỉnh sửa vật tư #${id}`,
    description: "Cập nhật thông tin catalog, metadata và đơn giá vật tư.",
    path: `/materials/${id}/edit`,
  });
}

export default async function MaterialEditPage({
  params,
}: MaterialEditPageProps) {
  const { id: rawId } = await params;
  const id = Number.parseInt(rawId, 10);

  if (!Number.isInteger(id) || id <= 0) {
    notFound();
  }

  void api.material.getById.prefetch({ id });

  return (
    <HydrateClient>
      <MaterialDetailClient id={id} view="edit" />
    </HydrateClient>
  );
}
