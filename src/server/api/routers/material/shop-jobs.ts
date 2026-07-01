import { TRPCError } from "@trpc/server";
import Papa from "papaparse";
import { z } from "zod";

import { creatorTenantId, tenantScopeValue } from "~/server/api/tenant-scope";
import { requirePermission, publicProcedure } from "~/server/api/trpc";
import { findFuzzyCandidates } from "~/server/services/ai-product-matcher";
import { ShopJobServiceError } from "~/server/services/shop-job-errors";
import {
  cancelShopImportJob,
  getShopImportJob,
  getShopImportJobProgress,
  listShopImportJobs,
  startShopImportJob,
} from "~/server/services/shop-import-jobs";
import { previewShopImportJob } from "~/server/services/shop-import-preview";
import {
  SHOP_DETAIL_ENRICHMENT_MODES,
  SHOP_SCRAPE_METHODS,
} from "~/server/services/shop-material-scraper";
import {
  addShopScrapeJobProduct,
  cancelShopScrapeJob,
  deleteShopScrapeJob,
  deleteShopScrapeJobProduct,
  deleteShopScrapeJobProducts,
  getShopScrapeJob,
  getShopScrapeJobProgress,
  listShopScrapeJobs,
  startShopScrapeJob,
  updateShopScrapeJobProduct,
} from "~/server/services/shop-scrape-jobs";

const SHOP_SCRAPE_EXPORT_LIMIT = 10_000;
const SHOP_SCRAPE_ALL_MAX_PAGES = 100;
const SHOP_SCRAPE_ALL_MAX_PRODUCTS = 2_000;

const shopScrapeInput = z
  .object({
    url: z.string().trim().min(1),
    scrapeMode: z.enum(["limited", "all"]).default("limited"),
    maxPages: z.number().int().min(1).max(100).nullable().optional(),
    maxProducts: z.number().int().min(1).max(2000).nullable().optional(),
    method: z.enum(SHOP_SCRAPE_METHODS).default("auto"),
    detailEnrichment: z
      .enum(SHOP_DETAIL_ENRICHMENT_MODES)
      .default("missing_fields"),
  })
  .transform((input) => ({
    ...input,
    maxPages:
      input.scrapeMode === "all"
        ? SHOP_SCRAPE_ALL_MAX_PAGES
        : (input.maxPages ?? 25),
    maxProducts:
      input.scrapeMode === "all"
        ? SHOP_SCRAPE_ALL_MAX_PRODUCTS
        : (input.maxProducts ?? 500),
  }));

const shopScrapeJobInput = z.object({
  jobId: z.string().uuid(),
});

const scrapedShopProductInput = z
  .object({
    name: z.string().trim().min(1),
    unit: z.string().trim().nullish(),
    category: z.string().trim().nullish(),
    specText: z.string().default(""),
    manufacturer: z.string().trim().nullish(),
    originCountry: z.string().trim().nullish(),
    price: z.number().nullable().optional(),
    priceText: z.string().trim().nullish(),
    currency: z.string().trim().default("VND"),
    sourceUrl: z.string().trim().min(1),
    imageUrl: z.string().trim().nullish(),
    sku: z.string().trim().nullish(),
    model: z.string().trim().nullish(),
    availability: z.string().trim().nullish(),
    shopCategory: z.string().trim().nullish(),
    catalogPdfUrls: z.array(z.string().trim().min(1)).default([]),
  })
  .transform((product) => ({
    ...product,
    unit: product.unit ?? null,
    category: product.category ?? null,
    manufacturer: product.manufacturer ?? null,
    originCountry: product.originCountry ?? null,
    priceText: product.priceText ?? null,
    imageUrl: product.imageUrl ?? null,
    sku: product.sku ?? null,
    model: product.model ?? null,
    availability: product.availability ?? null,
    shopCategory: product.shopCategory ?? null,
    price: product.price ?? null,
  }));

const updateShopScrapeJobProductInput = z.object({
  jobId: z.string().uuid(),
  sourceUrl: z.string().trim().min(1),
  product: scrapedShopProductInput,
});

const deleteShopScrapeJobProductInput = z.object({
  jobId: z.string().uuid(),
  sourceUrl: z.string().trim().min(1),
});

const deleteShopScrapeJobProductsInput = z.object({
  jobId: z.string().uuid(),
  sourceUrls: z.array(z.string().trim().min(1)).min(1).max(25_000),
});

const addShopScrapeJobProductInput = z.object({
  jobId: z.string().uuid(),
  product: scrapedShopProductInput,
});

const listShopJobsBaseInput = z.object({
  limit: z.number().int().min(1).max(100).default(25),
  offset: z.number().int().min(0).default(0),
});

const listShopJobsInput = listShopJobsBaseInput.optional();

const startShopImportJobInput = z.object({
  scrapeJobId: z.string().uuid(),
  productSourceUrls: z.array(z.string().min(1)).max(25_000).optional(),
});

const shopImportJobInput = z.object({
  jobId: z.string().uuid(),
});

const listShopImportJobsInput = listShopJobsBaseInput
  .extend({
    scrapeJobId: z.string().uuid().optional(),
  })
  .optional();

async function withShopJobErrors<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ShopJobServiceError) {
      throw new TRPCError({
        code: error.code,
        message: error.message,
      });
    }
    throw error;
  }
}

function scrapeProductExportCsvRow(product: {
  name: string;
  unit: string | null;
  category: string | null;
  specText: string;
  manufacturer: string | null;
  originCountry: string | null;
  price: number | null;
  priceText: string | null;
  currency: string;
  sourceUrl: string;
  sku: string | null;
  model: string | null;
  shopCategory: string | null;
  catalogPdfUrls: string[];
}) {
  return {
    name: product.name,
    unit: product.unit ?? "",
    category: product.category ?? "",
    spec_text: product.specText,
    manufacturer: product.manufacturer ?? "",
    origin_country: product.originCountry ?? "",
    price: product.price == null ? "" : String(product.price),
    price_text: product.priceText ?? "",
    currency: product.currency,
    source_url: product.sourceUrl,
    sku: product.sku ?? "",
    model: product.model ?? "",
    shop_category: product.shopCategory ?? "",
    catalog_pdf_urls: product.catalogPdfUrls.join(" | "),
  };
}

export const shopJobProcedures = {
  startShopScrapeJob: requirePermission("scrape:run")
    .input(shopScrapeInput)
    .mutation(({ ctx, input }) =>
      withShopJobErrors(() =>
        startShopScrapeJob({ ...input, tenantId: creatorTenantId(ctx) }),
      ),
    ),

  listShopScrapeJobs: requirePermission("scrape:run")
    .input(listShopJobsInput)
    .query(({ ctx, input }) =>
      listShopScrapeJobs(input, tenantScopeValue(ctx)),
    ),

  getShopScrapeJob: requirePermission("scrape:run")
    .input(shopScrapeJobInput)
    .query(async ({ ctx, input }) => {
      const job = await getShopScrapeJob(input.jobId, tenantScopeValue(ctx));
      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Không tìm thấy job scrape shop.",
        });
      }
      return job;
    }),

  getShopScrapeJobProgress: requirePermission("scrape:run")
    .input(z.object({ jobId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const job = await getShopScrapeJobProgress(
        input.jobId,
        tenantScopeValue(ctx),
      );
      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Không tìm thấy job scrape shop.",
        });
      }
      return job;
    }),

  cancelShopScrapeJob: requirePermission("scrape:run")
    .input(shopScrapeJobInput)
    .mutation(async ({ ctx, input }) => {
      const job = await withShopJobErrors(() =>
        cancelShopScrapeJob(input.jobId, tenantScopeValue(ctx)),
      );
      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Không tìm thấy job scrape shop.",
        });
      }
      return job;
    }),

  deleteShopScrapeJob: requirePermission("scrape:run")
    .input(shopScrapeJobInput)
    .mutation(async ({ ctx, input }) => {
      const job = await withShopJobErrors(() =>
        deleteShopScrapeJob(input.jobId, tenantScopeValue(ctx)),
      );
      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Không tìm thấy job scrape shop.",
        });
      }
      return job;
    }),

  updateShopScrapeJobProduct: requirePermission("scrape:run")
    .input(updateShopScrapeJobProductInput)
    .mutation(({ ctx, input }) =>
      withShopJobErrors(() =>
        updateShopScrapeJobProduct(input, tenantScopeValue(ctx)),
      ),
    ),

  deleteShopScrapeJobProduct: requirePermission("scrape:run")
    .input(deleteShopScrapeJobProductInput)
    .mutation(({ ctx, input }) =>
      withShopJobErrors(() =>
        deleteShopScrapeJobProduct(input, tenantScopeValue(ctx)),
      ),
    ),

  deleteShopScrapeJobProducts: requirePermission("scrape:run")
    .input(deleteShopScrapeJobProductsInput)
    .mutation(({ ctx, input }) =>
      withShopJobErrors(() =>
        deleteShopScrapeJobProducts(input, tenantScopeValue(ctx)),
      ),
    ),

  addShopScrapeJobProduct: requirePermission("scrape:run")
    .input(addShopScrapeJobProductInput)
    .mutation(({ ctx, input }) =>
      withShopJobErrors(() =>
        addShopScrapeJobProduct(input, tenantScopeValue(ctx)),
      ),
    ),

  startShopImportJob: requirePermission("scrape:run")
    .input(startShopImportJobInput)
    .mutation(({ ctx, input }) =>
      withShopJobErrors(() =>
        startShopImportJob(
          {
            scrapeJobId: input.scrapeJobId,
            productSourceUrls: input.productSourceUrls,
          },
          tenantScopeValue(ctx),
        ),
      ),
    ),

  previewShopImportJob: requirePermission("scrape:run")
    .input(startShopImportJobInput)
    .query(({ ctx, input }) =>
      withShopJobErrors(() =>
        previewShopImportJob(
          {
            scrapeJobId: input.scrapeJobId,
            productSourceUrls: input.productSourceUrls,
          },
          tenantScopeValue(ctx),
        ),
      ),
    ),

  listShopImportJobs: requirePermission("scrape:run")
    .input(listShopImportJobsInput)
    .query(({ ctx, input }) =>
      listShopImportJobs(input, tenantScopeValue(ctx)),
    ),

  getShopImportJob: requirePermission("scrape:run")
    .input(shopImportJobInput)
    .query(async ({ ctx, input }) => {
      const job = await getShopImportJob(input.jobId, tenantScopeValue(ctx));
      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Không tìm thấy job nhập catalog.",
        });
      }
      return job;
    }),

  getShopImportJobProgress: requirePermission("scrape:run")
    .input(shopImportJobInput)
    .query(async ({ ctx, input }) => {
      const job = await getShopImportJobProgress(
        input.jobId,
        tenantScopeValue(ctx),
      );
      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Không tìm thấy job nhập catalog.",
        });
      }
      return job;
    }),

  exportShopScrapeJobCsv: requirePermission("scrape:run")
    .input(z.object({ jobId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const job = await getShopScrapeJob(input.jobId, tenantScopeValue(ctx));
      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Không tìm thấy job scrape shop.",
        });
      }
      const rows = job.products.slice(0, SHOP_SCRAPE_EXPORT_LIMIT);
      const csv = Papa.unparse(rows.map(scrapeProductExportCsvRow));
      return {
        csv,
        count: rows.length,
        truncated: job.products.length > rows.length,
      };
    }),

  cancelShopImportJob: requirePermission("scrape:run")
    .input(shopImportJobInput)
    .mutation(async ({ ctx, input }) => {
      const job = await withShopJobErrors(() =>
        cancelShopImportJob(input.jobId, tenantScopeValue(ctx)),
      );
      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Không tìm thấy job nhập catalog.",
        });
      }
      return job;
    }),

  matchScrapedProduct: publicProcedure
    .input(
      z.object({
        product: scrapedShopProductInput,
        limit: z.number().int().min(1).max(20).default(8),
        minSimilarity: z.number().min(0).max(1).default(0.1),
      }),
    )
    .query(async ({ ctx, input }) => {
      const product = {
        ...input.product,
        specText: input.product.specText ?? "",
        currency: input.product.currency ?? "VND",
        catalogPdfUrls: input.product.catalogPdfUrls ?? [],
        shopCategory: input.product.shopCategory ?? null,
      };
      const candidates = await findFuzzyCandidates(
        ctx.db,
        product,
        input.minSimilarity,
        input.limit,
      );
      return { candidates };
    }),
};
