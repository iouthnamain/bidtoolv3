/**
 * YOU PROBABLY DON'T NEED TO EDIT THIS FILE, UNLESS:
 * 1. You want to modify request context (see Part 1).
 * 2. You want to create a new middleware or type of procedure (see Part 3).
 *
 * TL;DR - This is where all the tRPC server stuff is created and plugged in. The pieces you will
 * need to use are documented accordingly near the end.
 */
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";
import { db } from "~/server/db";

/**
 * 1. CONTEXT
 *
 * This section defines the "contexts" that are available in the backend API.
 *
 * These allow you to access things when processing a request, like the database, the session, etc.
 *
 * This helper generates the "internals" for a tRPC context. The API handler and RSC clients each
 * wrap this and provides the required context.
 *
 * @see https://trpc.io/docs/server/context
 */
export const createTRPCContext = async (opts: { headers: Headers }) => {
  return {
    db,
    ...opts,
  };
};

/**
 * 2. INITIALIZATION
 *
 * This is where the tRPC API is initialized, connecting the context and transformer. We also parse
 * ZodErrors so that you get typesafety on the frontend if your procedure fails due to validation
 * errors on the backend.
 */
const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

/**
 * Create a server-side caller.
 *
 * @see https://trpc.io/docs/server/server-side-calls
 */
export const createCallerFactory = t.createCallerFactory;

/**
 * 3. ROUTER & PROCEDURE (THE IMPORTANT BIT)
 *
 * These are the pieces you use to build your tRPC API. You should import these a lot in the
 * "/src/server/api/routers" directory.
 */

/**
 * This is how you create new routers and sub-routers in your tRPC API.
 *
 * @see https://trpc.io/docs/router
 */
export const createTRPCRouter = t.router;

const trpcDebugEnabled = process.env.BIDTOOL_TRPC_DEBUG === "true";
const trpcArtificialDelayEnabled = process.env.BIDTOOL_TRPC_DELAY === "true";
const configuredSlowProcedureLogMs = Number(
  process.env.BIDTOOL_TRPC_SLOW_MS ?? 750,
);
const slowProcedureLogMs =
  Number.isFinite(configuredSlowProcedureLogMs) &&
  configuredSlowProcedureLogMs >= 0
    ? configuredSlowProcedureLogMs
    : 750;

function shouldLogProcedure(elapsedMs: number) {
  return trpcDebugEnabled || elapsedMs >= slowProcedureLogMs;
}

/**
 * Middleware for timing procedure execution.
 *
 * Set BIDTOOL_TRPC_DELAY=true to simulate local network latency when hunting
 * waterfalls. Set BIDTOOL_TRPC_DEBUG=true to log every procedure; otherwise
 * only slow procedures are logged.
 */
const timingMiddleware = t.middleware(async ({ next, path }) => {
  const start = Date.now();

  if (t._config.isDev && trpcArtificialDelayEnabled) {
    const waitMs = Math.floor(Math.random() * 400) + 100;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  const result = await next();
  const elapsedMs = Date.now() - start;

  if (shouldLogProcedure(elapsedMs)) {
    console.log(`[TRPC] ${path} took ${elapsedMs}ms to execute`);
  }

  return result;
});

/**
 * Global rate-limit. BidTool is single-user with no auth, so this is a coarse safety net
 * against runaway client loops, not a per-user quota. Burst-friendly token bucket shared
 * across all paths.
 */
const RATE_LIMIT_CAPACITY = 200;
const RATE_LIMIT_REFILL_PER_SEC = 50;

let rateBucketTokens = RATE_LIMIT_CAPACITY;
let rateBucketLastRefill = Date.now();

function takeRateLimitToken(): boolean {
  const now = Date.now();
  const elapsedSec = (now - rateBucketLastRefill) / 1000;
  if (elapsedSec > 0) {
    rateBucketTokens = Math.min(
      RATE_LIMIT_CAPACITY,
      rateBucketTokens + elapsedSec * RATE_LIMIT_REFILL_PER_SEC,
    );
    rateBucketLastRefill = now;
  }

  if (rateBucketTokens < 1) {
    return false;
  }

  rateBucketTokens -= 1;
  return true;
}

const rateLimitMiddleware = t.middleware(async ({ next, path }) => {
  if (!takeRateLimitToken()) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Quá nhiều yêu cầu (${path}). Vui lòng thử lại sau.`,
    });
  }

  return next();
});

/**
 * Public procedure. BidTool intentionally has no authentication; this is the only procedure
 * type and is used everywhere.
 */
export const publicProcedure = t.procedure
  .use(rateLimitMiddleware)
  .use(timingMiddleware);
