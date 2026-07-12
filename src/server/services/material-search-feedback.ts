import "server-only";

import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";

import { createMaterialSearchIdentity } from "~/lib/materials/material-search-identity";
import type { EnrichWebRowInput } from "~/server/services/enrich-web-row";
import type {
  AiSearchStoredResult,
  WebLinkResult,
} from "~/lib/materials/enrich-gap-fill";
import { db } from "~/server/db";
import {
  excelWorkspaceItems,
  materialSearchFeedback,
} from "~/server/db/schema";
import { hasDatabaseUrl } from "~/server/runtime";

export function normalizeMaterialSearchUrl(value: string) {
  const url = new URL(value.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("URL phải bắt đầu bằng http:// hoặc https://.");
  }
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(?:utm_.+|fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
  }
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
  url.searchParams.sort();
  return url.toString();
}

function itemInput(
  item: typeof excelWorkspaceItems.$inferSelect,
): EnrichWebRowInput {
  const original = item.originalDataJson;
  const text = (key: string) =>
    typeof original[key] === "string" ? original[key].trim() : "";
  const firstText = (...values: Array<string | null | undefined>) =>
    values.map((value) => value?.trim() ?? "").find(Boolean) ?? "";
  return {
    name: item.productName,
    code: text("code"),
    manufacturer: firstText(text("manufacturer"), item.vendorHint),
    specText: firstText(text("specText"), item.specText),
    unit: firstText(text("unit"), item.unit),
    category: text("category"),
    originCountry: firstText(text("originCountry"), item.originHint),
  };
}

export async function resolveMaterialProfileItemIdentity(itemId: number) {
  const [item] = await db
    .select()
    .from(excelWorkspaceItems)
    .where(eq(excelWorkspaceItems.id, itemId))
    .limit(1);
  if (!item) throw new Error("Không tìm thấy dòng vật tư.");
  return { item, identity: createMaterialSearchIdentity(itemInput(item)) };
}

export async function rejectMaterialSearchResult(input: {
  itemId: number;
  url: string;
  title?: string;
}) {
  const { item, identity } = await resolveMaterialProfileItemIdentity(
    input.itemId,
  );
  const normalizedUrl = normalizeMaterialSearchUrl(input.url);
  const now = new Date().toISOString();
  const [record] = await db
    .insert(materialSearchFeedback)
    .values({
      materialSignature: identity.signature,
      normalizedUrl,
      domain: new URL(normalizedUrl).hostname,
      title: input.title?.trim() ?? "",
      workspaceId: item.workspaceId,
      itemId: item.id,
      rejectedAt: now,
      restoredAt: null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        materialSearchFeedback.materialSignature,
        materialSearchFeedback.normalizedUrl,
      ],
      set: {
        title: input.title?.trim() ?? "",
        workspaceId: item.workspaceId,
        itemId: item.id,
        rejectedAt: now,
        restoredAt: null,
        updatedAt: now,
      },
    })
    .returning();
  return record!;
}

export async function restoreMaterialSearchResult(feedbackId: number) {
  const [record] = await db
    .update(materialSearchFeedback)
    .set({
      restoredAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(materialSearchFeedback.id, feedbackId))
    .returning();
  if (!record) throw new Error("Không tìm thấy phản hồi tìm kiếm.");
  return record;
}

export async function listMaterialSearchFeedback(input: {
  active?: boolean;
  limit: number;
}) {
  return db
    .select()
    .from(materialSearchFeedback)
    .where(
      input.active === true
        ? isNull(materialSearchFeedback.restoredAt)
        : input.active === false
          ? isNotNull(materialSearchFeedback.restoredAt)
          : undefined,
    )
    .orderBy(
      desc(materialSearchFeedback.rejectedAt),
      desc(materialSearchFeedback.id),
    )
    .limit(input.limit);
}

export async function activeRejectedUrls(materialSignature: string) {
  if (!hasDatabaseUrl()) return new Set<string>();
  const rows = await db
    .select({ normalizedUrl: materialSearchFeedback.normalizedUrl })
    .from(materialSearchFeedback)
    .where(
      and(
        eq(materialSearchFeedback.materialSignature, materialSignature),
        isNull(materialSearchFeedback.restoredAt),
      ),
    );
  return new Set(rows.map((row) => row.normalizedUrl));
}

export async function filterActiveRejectedWebLinks(
  input: EnrichWebRowInput,
  links: WebLinkResult[],
) {
  const identity = createMaterialSearchIdentity(input);
  const rejected = await activeRejectedUrls(identity.signature);
  return links.filter((link) => {
    try {
      return !rejected.has(normalizeMaterialSearchUrl(link.url));
    } catch {
      return false;
    }
  });
}

export async function filterActiveRejectedAiCandidates(
  input: EnrichWebRowInput,
  candidates: AiSearchStoredResult[],
) {
  const identity = createMaterialSearchIdentity(input);
  const rejected = await activeRejectedUrls(identity.signature);
  return candidates.filter((candidate) => {
    const urls = [candidate.url, ...(candidate.sourceUrls ?? [])].filter(
      (url): url is string => Boolean(url),
    );
    return !urls.some((url) => {
      try {
        return rejected.has(normalizeMaterialSearchUrl(url));
      } catch {
        return true;
      }
    });
  });
}
