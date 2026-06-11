import { normalizeMaterialMetadata } from "~/lib/material-price-sources";

export function materialImageUrlFromScrape(
  imageUrl: string | null | undefined,
): string | null {
  const trimmed = imageUrl?.trim();
  return trimmed || null;
}

export function resolveMaterialImageUrl(material: {
  imageUrl?: string | null;
  metadataJson?: unknown;
}): string | null {
  const direct = material.imageUrl?.trim();
  if (direct) {
    return direct;
  }

  const metadata = normalizeMaterialMetadata(material.metadataJson);
  return metadata.shopScrape?.imageUrl?.trim() || null;
}
