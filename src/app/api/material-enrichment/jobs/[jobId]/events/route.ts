import { type NextRequest } from "next/server";

import { tenantScopeValue } from "~/server/api/tenant-scope";
import { createTRPCContext } from "~/server/api/trpc";
import {
  getMaterialEnrichmentJob,
  listMaterialEnrichmentEvents,
} from "~/server/services/material-enrichment-jobs";
import {
  subscribeMaterialEnrichmentJob,
  type MaterialEnrichmentStreamEvent,
} from "~/server/services/material-enrichment-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function encodeEvent(event: MaterialEnrichmentStreamEvent) {
  return `id: ${event.eventId}\nevent: update\ndata: ${JSON.stringify(event)}\n\n`;
}

function lastEventId(request: NextRequest) {
  const headerValue = request.headers.get("last-event-id");
  const queryValue = request.nextUrl.searchParams.get("after");
  const parsed = Number.parseInt(headerValue ?? queryValue ?? "0", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await context.params;
  const ctx = await createTRPCContext({ headers: request.headers });
  const scope = tenantScopeValue(ctx);
  const job = await getMaterialEnrichmentJob(jobId, scope);
  if (!job) {
    return new Response("Không tìm thấy job enrichment vật liệu.", {
      status: 404,
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: string) => {
        controller.enqueue(encoder.encode(chunk));
      };
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(keepAlive);
        unsubscribe();
        controller.close();
      };

      const unsubscribe = subscribeMaterialEnrichmentJob(jobId, (event) => {
        if (!closed) {
          send(encodeEvent(event));
        }
      });
      const keepAlive = setInterval(() => {
        if (!closed) {
          send(": ping\n\n");
        }
      }, 15000);

      request.signal.addEventListener("abort", close, { once: true });

      const missed = await listMaterialEnrichmentEvents(
        { jobId, afterEventId: lastEventId(request), limit: 500 },
        scope,
      );
      for (const event of missed) {
        if (closed) break;
        send(encodeEvent(event));
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
