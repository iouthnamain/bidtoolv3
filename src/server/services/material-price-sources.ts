import { extractPriceFromText } from "~/lib/material-price-sources";
import { createLogger, traceFn } from "~/server/lib/logger";
import { fetchPublicContent } from "~/server/services/public-content-client";
const log = createLogger("services-material-price-sources");

export {
  buildMaterialMetadata,
  mergeMaterialMetadata,
  MATERIAL_FIELD_LOCK_KEYS,
  normalizeMaterialMetadata,
} from "~/lib/material-price-sources";
export type {
  MaterialFieldLockKey,
  MaterialMetadata,
  MaterialPriceSource,
  MaterialPriceSourceMode,
} from "~/lib/material-price-sources";

async function _fetchPriceFromUrl(url: string): Promise<{
  priceText: string | null;
  price: number | null;
}> {
  const response = await fetchPublicContent({
    url,
    kind: "text",
    timeoutMs: 12_000,
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; BidTool/1.0; +https://localhost)",
      accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
    },
  });
  const html = response.body.toString("utf8");
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&");

  return extractPriceFromText(text);
}

export const fetchPriceFromUrl = traceFn(
  log,
  "fetchPriceFromUrl",
  _fetchPriceFromUrl,
);
