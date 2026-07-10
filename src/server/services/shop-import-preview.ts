import { db } from "~/server/db";
import type { TenantScopeValue } from "~/server/api/tenant-scope";
import { loadShopImportSource } from "~/server/services/shop-import-source";
import { previewShopImportProducts } from "~/server/services/shop-product-importer";
import { createLogger, traceFn } from "~/server/lib/logger";

const log = createLogger("services-shop-import-preview");

async function _previewShopImportJob(
  input: {
    scrapeJobId: string;
    productSourceUrls?: string[];
  },
  scope?: TenantScopeValue,
) {
  const { products, mode } = await loadShopImportSource(
    input,
    "preview",
    scope,
  );

  return previewShopImportProducts(db, products, { mode });
}

export const previewShopImportJob = traceFn(
  log,
  "previewShopImportJob",
  _previewShopImportJob,
);
