import "server-only";

import { EventEmitter } from "node:events";

import { asc, eq, sql } from "drizzle-orm";

import type { MaterialEnrichmentResult } from "~/lib/materials/material-enrichment-types";
import { db } from "~/server/db";
import {
  materialEnrichmentItems,
  materialEnrichmentJobEvents,
} from "~/server/db/schema";
import { createLogger, traceFn } from "~/server/lib/logger";

const log = createLogger("services-material-enrichment-events");

const emitter = new EventEmitter();
emitter.setMaxListeners(500);

export type MaterialEnrichmentStreamEvent = {
  eventId: number;
  eventType: string;
  jobId: string;
  itemId: number | null;
  itemStatus: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};

function eventName(jobId: string) {
  return `material-enrichment:${jobId}`;
}

function trimResultForEvent(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return {};
  }
  const result = value as MaterialEnrichmentResult;
  const fields: Record<string, unknown> = {};
  for (const [field, cell] of Object.entries(result.fields ?? {})) {
    if (!cell || typeof cell !== "object") continue;
    const record = cell as Record<string, unknown>;
    fields[field] = {
      value: record.value ?? null,
      confidence: record.confidence ?? 0,
      matchedOption: record.matchedOption ?? null,
      evidence: [],
    };
  }
  return {
    status: result.status,
    overallConfidence: result.overallConfidence ?? 0,
    error: result.error ?? null,
    selectedCandidateId: result.selectedCandidateId ?? null,
    fields,
    catalogPdfUrls: [],
  };
}

function itemPayload(row: typeof materialEnrichmentItems.$inferSelect) {
  return {
    item: {
      id: row.id,
      jobId: row.jobId,
      materialId: row.materialId,
      status: row.status,
      originalSnapshot: row.originalSnapshotJson ?? {},
      materialImageUrl: null,
      result: trimResultForEvent(row.resultJson),
      committedAt: row.committedAt,
      sortOrder: row.sortOrder,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
  };
}

function toStreamEvent(
  row: typeof materialEnrichmentJobEvents.$inferSelect,
): MaterialEnrichmentStreamEvent {
  return {
    eventId: row.id,
    eventType: row.eventType,
    jobId: row.jobId,
    itemId: row.itemId,
    itemStatus: row.itemStatus,
    payload: row.payloadJson,
    createdAt: row.createdAt,
  };
}

async function _publishMaterialEnrichmentItemEvent(
  itemId: number,
  eventType = "item.updated",
) {
  const [item] = await db
    .select()
    .from(materialEnrichmentItems)
    .where(eq(materialEnrichmentItems.id, itemId))
    .limit(1);

  if (!item) {
    return null;
  }

  const [event] = await db
    .insert(materialEnrichmentJobEvents)
    .values({
      jobId: item.jobId,
      itemId: item.id,
      eventType,
      itemStatus: item.status,
      payloadJson: itemPayload(item),
      createdAt: new Date().toISOString(),
    })
    .returning();

  if (!event) {
    return null;
  }

  const streamEvent = toStreamEvent(event);
  emitter.emit(eventName(item.jobId), streamEvent);
  return streamEvent;
}

async function _listMaterialEnrichmentJobEvents(input: {
  jobId: string;
  afterEventId?: number;
  limit?: number;
}) {
  const afterEventId = Math.max(0, input.afterEventId ?? 0);
  const limit = Math.min(500, Math.max(1, input.limit ?? 100));
  const rows = await db
    .select()
    .from(materialEnrichmentJobEvents)
    .where(
      sql`${materialEnrichmentJobEvents.jobId} = ${input.jobId}
        and ${materialEnrichmentJobEvents.id} > ${afterEventId}`,
    )
    .orderBy(asc(materialEnrichmentJobEvents.id))
    .limit(limit);

  return rows.map(toStreamEvent);
}

function _subscribeMaterialEnrichmentJob(
  jobId: string,
  listener: (event: MaterialEnrichmentStreamEvent) => void,
) {
  const name = eventName(jobId);
  emitter.on(name, listener);
  return () => emitter.off(name, listener);
}

export const publishMaterialEnrichmentItemEvent = traceFn(
  log,
  "publishMaterialEnrichmentItemEvent",
  _publishMaterialEnrichmentItemEvent,
);
export const listMaterialEnrichmentJobEvents = traceFn(
  log,
  "listMaterialEnrichmentJobEvents",
  _listMaterialEnrichmentJobEvents,
);
export const subscribeMaterialEnrichmentJob = traceFn(
  log,
  "subscribeMaterialEnrichmentJob",
  _subscribeMaterialEnrichmentJob,
);
