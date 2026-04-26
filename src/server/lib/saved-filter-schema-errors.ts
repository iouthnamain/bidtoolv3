import { TRPCError } from "@trpc/server";

export const SAVED_FILTER_SCHEMA_DRIFT_MESSAGE =
  "Smart View đang dùng schema mới hơn database hiện tại. Hãy chạy `bun run db:migrate` rồi tải lại trang.";

function readErrorCause(error: unknown): unknown {
  if (!error || typeof error !== "object" || !("cause" in error)) {
    return null;
  }

  return (error as { cause?: unknown }).cause ?? null;
}

function readErrorCode(error: unknown): string {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return "";
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
}

function readErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object" || !("message" in error)) {
    return "";
  }

  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : "";
}

function readErrorQuery(error: unknown): string {
  if (!error || typeof error !== "object" || !("query" in error)) {
    return "";
  }

  const query = (error as { query?: unknown }).query;
  return typeof query === "string" ? query : "";
}

function collectErrorChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  const seen = new Set<object>();

  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    chain.push(current);
    seen.add(current);
    current = readErrorCause(current);
  }

  return chain;
}

export function isSavedFilterSchemaDriftError(error: unknown): boolean {
  const chain = collectErrorChain(error);

  return (
    chain.some((candidate) => readErrorCode(candidate) === "42703") &&
    chain.some((candidate) =>
      /(min_match_score|updated_at)/i.test(
        `${readErrorMessage(candidate)} ${readErrorQuery(candidate)}`,
      ),
    )
  );
}

export function throwSavedFilterSchemaDriftError(error: unknown): never {
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message: SAVED_FILTER_SCHEMA_DRIFT_MESSAGE,
    cause: error,
  });
}
