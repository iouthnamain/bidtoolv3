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
import { env } from "~/env";
import { auth } from "~/server/auth";
import { can, type Permission, type Role } from "~/lib/permissions";
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

/** The session half of Better Auth's getSession result. */
type ContextSession = NonNullable<
  Awaited<ReturnType<typeof auth.api.getSession>>
>["session"];

export const createTRPCContext = async (opts: { headers: Headers }) => {
  const authEnabled = env.AUTH_ENABLED === "true";

  // When auth is disabled we skip session resolution entirely. This keeps the
  // pre-rollout behavior byte-for-byte identical: no DB session lookup, no
  // user, no tenant. The app runs exactly as it does today.
  if (!authEnabled) {
    return {
      db,
      ...opts,
      user: null as ContextUser | null,
      session: null as ContextSession | null,
      tenantId: null as string | null,
      authEnabled,
    };
  }

  // Auth is enabled: resolve the session. A session-lookup failure (DB hiccup,
  // malformed cookie, etc.) must never 500 the whole request — on error we
  // simply treat the request as unauthenticated.
  let user: ContextUser | null = null;
  let session: ContextSession | null = null;

  try {
    const result = await auth.api.getSession({ headers: opts.headers });
    if (result) {
      // `tenantId` is an additional field not present in Better Auth's inferred
      // user type, so we cast through unknown to our narrower ContextUser.
      user = result.user as unknown as ContextUser;
      session = result.session;
    }
  } catch (error) {
    log.warn("session_resolution_failed", { error });
  }

  return {
    db,
    ...opts,
    user,
    session,
    tenantId: user?.tenantId ?? null,
    authEnabled,
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

/**
 * Public procedure. BidTool intentionally has no authentication; this is the only procedure
 * type and is used everywhere.
 */
export const publicProcedure = t.procedure
  .use(rateLimitMiddleware)
  .use(timingMiddleware);

/**
 * Middleware that enforces authentication. Built to layer on top of the same
 * rate-limit → timing chain as publicProcedure.
 *
 * - When auth is disabled, there is no user to require, so it passes through
 *   (ctx.user stays null). This keeps protected procedures usable pre-rollout
 *   so the app remains fully functional while AUTH_ENABLED=false.
 * - When auth is enabled and there is no user, it throws UNAUTHORIZED.
 * - Otherwise it narrows ctx so downstream resolvers see a non-null user.
 */
const enforceAuth = t.middleware(async ({ ctx, next }) => {
  if (!ctx.authEnabled) {
    return next();
  }

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  return next({
    ctx: {
      // Re-attach as non-null so ctx.user / ctx.session narrow for downstream
      // procedures.
      user: ctx.user,
      session: ctx.session,
    },
  });
});

/**
 * Protected procedure. Requires an authenticated user when auth is enabled;
 * passes through (with a null user) when auth is disabled. Use this for any
 * procedure that should be gated behind login but does not need a specific
 * permission.
 */
export const protectedProcedure = t.procedure
  .use(rateLimitMiddleware)
  .use(timingMiddleware)
  .use(enforceAuth);

/**
 * Builds a procedure that requires a specific {@link Permission}. Layers on top
 * of protectedProcedure, then checks the resolved user's role against the
 * permission map in `~/lib/permissions`.
 *
 * - When auth is disabled, enforcement is skipped (no role to check, app stays
 *   usable pre-rollout).
 * - When auth is enabled, throws FORBIDDEN if the user's role lacks the
 *   permission.
 *
 * Usage in routers: `requirePermission("material:write").input(...).mutation(...)`.
 */
export const requirePermission = (permission: Permission) =>
  protectedProcedure.use(async ({ ctx, next }) => {
    // When auth is disabled, ctx.user is null and there is nothing to enforce.
    if (!ctx.authEnabled) {
      return next();
    }

    // Auth is enabled, so enforceAuth has already guaranteed a user; the guard
    // also narrows the type for the permission check below.
    if (!ctx.user) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    if (!can(ctx.user.role, permission)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Bạn không có quyền thực hiện thao tác này (${permission}).`,
      });
    }

    return next();
  });
