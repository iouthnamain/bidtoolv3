import { type Metadata } from "next";
import { notFound } from "next/navigation";

import { createPageMetadata } from "~/app/_lib/seo";
import { MaterialDetailClient } from "~/app/_components/materials/detail-client";
import { HydrateClient, api } from "~/trpc/server";

type MaterialPricesPageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({
  params,
}: MaterialPricesPageProps): Promise<Metadata> {
  const { id } = await params;

  return createPageMetadata({
    title: `Nguồn giá vật tư #${id}`,
    description: "Quản lý link sản phẩm, giá cố định và nguồn giá cho vật tư.",
    path: `/materials/${id}/prices`,
  });
}

export default async function MaterialPricesPage({
  params,
}: MaterialPricesPageProps) {
  const { id: rawId } = await params;
  const id = Number.parseInt(rawId, 10);

  if (!Number.isInteger(id) || id <= 0) {
    notFound();
  }

  void api.material.getById.prefetch({ id });

  return (
    <HydrateClient>
      <MaterialDetailClient id={id} view="prices" />
    </HydrateClient>
  );
}
