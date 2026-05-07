import { extractPriceFromText } from "~/lib/material-price-sources";

export {
  buildMaterialMetadata,
  normalizeMaterialMetadata,
} from "~/lib/material-price-sources";
export type {
  MaterialMetadata,
  MaterialPriceSource,
  MaterialPriceSourceMode,
} from "~/lib/material-price-sources";

export async function fetchPriceFromUrl(url: string): Promise<{
  priceText: string | null;
  price: number | null;
}> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("URL nguồn không hợp lệ.");
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("Chỉ hỗ trợ URL http hoặc https.");
  }

  const response = await fetch(parsedUrl, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; BidTool/1.0; +https://localhost)",
      accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
    },
    signal: AbortSignal.timeout(12_000),
  });

  if (!response.ok) {
    throw new Error(`Không đọc được nguồn giá (${response.status}).`);
  }

  const html = await response.text();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&");

  return extractPriceFromText(text);
}
