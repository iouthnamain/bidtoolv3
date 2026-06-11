import { normalizeMaterialMetadata } from "~/lib/material-price-sources";

export function materialImageUrlFromScrape(
  imageUrl: string | null | undefined,
): string | null {
  const trimmed = imageUrl?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed;
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
  const fromMetadata = metadata.shopScrape?.imageUrl?.trim();
  if (!fromMetadata) {
    return null;
  }
  return fromMetadata;
}
