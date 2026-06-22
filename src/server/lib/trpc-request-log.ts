import "server-only";

import type { FetchHandlerRequestOptions } from "@trpc/server/adapters/fetch";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { AnyRouter } from "@trpc/server";

import { createLogger, type LogLevel } from "~/server/lib/logger";

const log = createLogger("http");

const DEFAULT_QUIET_PROCEDURES = [
  "notification.unreadCount",
  "version.getStatus",
] as const;

function trimSlashes(path: string) {
  let value = path;
  if (value.startsWith("/")) {
    value = value.slice(1);
  }
  if (value.endsWith("/")) {
    value = value.slice(0, -1);
  }
  return value;
}

export function parseTrpcProcedures(url: URL, endpoint = "/api/trpc") {
  const pathname = trimSlashes(url.pathname);
  const endpointPath = trimSlashes(endpoint);
  const path = trimSlashes(pathname.slice(endpointPath.length));

  if (!path) {
    return [];
  }

  return path.split(",").map((procedure) => procedure.trim()).filter(Boolean);
}

function resolveQuietProcedures() {
  const configured = process.env.BIDTOOL_LOG_QUIET_PROCEDURES?.trim();
  if (!configured) {
    return new Set<string>(DEFAULT_QUIET_PROCEDURES);
  }

  return new Set(
    configured
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

export function resolveSlowProcedureLogMs() {
  const configured = Number(process.env.BIDTOOL_TRPC_SLOW_MS ?? 750);
  return Number.isFinite(configured) && configured >= 0 ? configured : 750;
}

export function resolveTrpcRequestLogLevel(input: {
  procedures: string[];
  status: number;
  durationMs: number;
  hadError: boolean;
}): LogLevel {
  if (input.hadError || input.status >= 400) {
    return input.status >= 500 ? "error" : "warn";
  }

  const quietProcedures = resolveQuietProcedures();
  const allQuiet =
    input.procedures.length > 0 &&
    input.procedures.every((procedure) => quietProcedures.has(procedure));
  const slow = input.durationMs >= resolveSlowProcedureLogMs();

  if (allQuiet && !slow) {
    return "debug";
  }

  if (slow) {
    return "info";
  }

  return "info";
}

function logTrpcRequest(input: {
  method: string;
  procedures: string[];
  status: number;
  durationMs: number;
  batch: number;
  hadError: boolean;
}) {
  const level = resolveTrpcRequestLogLevel(input);
  const proceduresLabel = input.procedures.join(",");
  const context = {
    method: input.method,
    procedures: input.procedures,
    status: input.status,
    durationMs: input.durationMs,
    batch: input.batch,
    ...(input.durationMs >= resolveSlowProcedureLogMs() ? { slow: true } : {}),
  };

  if (level === "debug") {
    log.debug(`trpc ${proceduresLabel} ${input.status} ${input.durationMs}ms`, context);
    return;
  }

  if (level === "warn") {
    log.warn(`trpc ${proceduresLabel} ${input.status} ${input.durationMs}ms`, context);
    return;
  }

  if (level === "error") {
    log.error(`trpc ${proceduresLabel} ${input.status} ${input.durationMs}ms`, context);
    return;
  }

  log.info(`trpc ${proceduresLabel} ${input.status} ${input.durationMs}ms`, context);
}

type TrpcHandlerOptions<TRouter extends AnyRouter> = FetchHandlerRequestOptions<TRouter>;

export async function fetchRequestHandlerWithLogging<TRouter extends AnyRouter>(
  opts: TrpcHandlerOptions<TRouter>,
) {
  const start = Date.now();
  const url = new URL(opts.req.url);
  const procedures = parseTrpcProcedures(url, opts.endpoint);
  const batchParam = url.searchParams.get("batch");
  const batch = Number(batchParam ?? (procedures.length > 0 ? procedures.length : 1));
  let hadError = false;

  const response = await fetchRequestHandler({
    ...opts,
    onError: (errorOpts: Parameters<NonNullable<typeof opts.onError>>[0]) => {
      hadError = true;
      opts.onError?.(errorOpts);
    },
  } as unknown as FetchHandlerRequestOptions<TRouter>);

  logTrpcRequest({
    method: opts.req.method,
    procedures,
    status: response.status,
    durationMs: Date.now() - start,
    batch: Number.isFinite(batch) && batch > 0 ? batch : procedures.length || 1,
    hadError,
  });

  return response;
}

export async function logApiRoute<TReturn>(
  input: {
    route: string;
    method: string;
    handler: () => Promise<TReturn>;
  },
) {
  const start = Date.now();

  try {
    const result = await input.handler();
    const durationMs = Date.now() - start;
    const status = result instanceof Response ? result.status : 200;
    const level: LogLevel =
      status >= 500 ? "error" : status >= 400 ? "warn" : "info";
    log[level](`api ${input.route} ${status} ${durationMs}ms`, {
      route: input.route,
      method: input.method,
      status,
      durationMs,
    });
    return result;
  } catch (error) {
    const durationMs = Date.now() - start;
    log.error(`api ${input.route} 500 ${durationMs}ms`, {
      route: input.route,
      method: input.method,
      status: 500,
      durationMs,
      error,
    });
    throw error;
  }
}
