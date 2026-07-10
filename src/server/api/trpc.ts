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
import { type Permission, type Role } from "~/lib/permissions";
import { createLogger } from "~/server/lib/logger";
import { resolveSlowProcedureLogMs } from "~/server/lib/trpc-request-log";

const log = createLogger("trpc");

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
/**
 * The shape of a Better Auth user as we consume it in tRPC context. We narrow
 * the role to our canonical {@link Role} union so downstream permission checks
 * are typed.
 */
type ContextUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  tenantId: string | null;
};

/** Kept as a stable context shape while the local product has no sessions. */
type ContextSession = { id: string };

export const createTRPCContext = async (opts: { headers: Headers }) => {
  return {
    db,
    ...opts,
    user: null as ContextUser | null,
    session: null as ContextSession | null,
    tenantId: null as string | null,
    // BidTool v3 is a local, single-user tool. Keep this flag for compatible
    // tenant-scope helpers, but never resolve or enforce a session.
    authEnabled: false,
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
const slowProcedureLogMs = resolveSlowProcedureLogMs();

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
const timingMiddleware = t.middleware(async ({ next, path, type }) => {
  const start = Date.now();

  if (t._config.isDev && trpcArtificialDelayEnabled) {
    const waitMs = Math.floor(Math.random() * 400) + 100;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  const result = await next();
  const elapsedMs = Date.now() - start;

  if (shouldLogProcedure(elapsedMs)) {
    const level = result.ok ? "debug" : "warn";
    log[level]("procedure_finished", {
      path,
      type,
      durationMs: elapsedMs,
      ok: result.ok,
      ...(elapsedMs >= slowProcedureLogMs ? { slow: true } : {}),
    });
  }

  return result;
});

/**
 * Rate-limit. A burst-friendly token bucket. Pre-auth this was a single global
 * bucket (BidTool was single-user with no auth). Now that a request may carry a
 * resolved user, we key the bucket per user id so one user's runaway client
 * loop can't starve another. Unauthenticated requests (auth off, or no session)
 * share a single "anon" bucket, which preserves the old global behavior exactly
 * when auth is disabled.
 *
 * The buckets live in a plain Map. At this app's scale (small number of
 * internal users) the key space is naturally bounded, so we don't bother with
 * eviction — a Map is fine.
 */
const RATE_LIMIT_CAPACITY = 200;
const RATE_LIMIT_REFILL_PER_SEC = 50;

type RateBucket = { tokens: number; lastRefill: number };

const rateBuckets = new Map<string, RateBucket>();

function takeRateLimitToken(key: string): boolean {
  const now = Date.now();
  let bucket = rateBuckets.get(key);
  if (!bucket) {
    bucket = { tokens: RATE_LIMIT_CAPACITY, lastRefill: now };
    rateBuckets.set(key, bucket);
  }

  const elapsedSec = (now - bucket.lastRefill) / 1000;
  if (elapsedSec > 0) {
    bucket.tokens = Math.min(
      RATE_LIMIT_CAPACITY,
      bucket.tokens + elapsedSec * RATE_LIMIT_REFILL_PER_SEC,
    );
    bucket.lastRefill = now;
  }

  if (bucket.tokens < 1) {
    return false;
  }

  bucket.tokens -= 1;
  return true;
}

const rateLimitMiddleware = t.middleware(async ({ next, path, ctx }) => {
  // Key per resolved user id; fall back to a shared "anon" bucket when there is
  // no user (auth off, or unauthenticated request). ctx.user is populated by
  // createTRPCContext, so the middleware can read it even though it runs first
  // in the chain.
  const key = ctx.user?.id ?? "anon";
  if (!takeRateLimitToken(key)) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Quá nhiều yêu cầu (${path}). Vui lòng thử lại sau.`,
    });
  }

  return next();
});

const baseProcedure = t.procedure
  .use(rateLimitMiddleware)
  .use(timingMiddleware);

/** All procedures are local single-user procedures. */
export const publicProcedure = baseProcedure;
export const protectedProcedure = publicProcedure;

/** Compatibility builder for existing routers; permissions are not applicable. */
export const requirePermission = (_permission: Permission) =>
  protectedProcedure;
