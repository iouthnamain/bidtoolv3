import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

import { env } from "~/env";

/**
 * Edge-friendly auth middleware (Phase 4).
 *
 * Rationale: this is an OPTIMISTIC cookie check, not real enforcement. Better
 * Auth 1.6.19 runs on Node, and calling `auth.api.getSession` here would do a
 * DB session fetch on every request (heavy, and edge-incompatible). The Better
 * Auth recommended pattern is a lightweight cookie presence check in middleware
 * purely for redirect UX, with the REAL session validation done server-side in
 * the route-group layout (RSC) and in tRPC procedures (defense in depth).
 *
 * `getSessionCookie` only confirms a session cookie EXISTS; it does not verify
 * it is valid or unexpired, and it cannot cheaply read the user's role without
 * a DB hit. So we only gate authenticated-vs-anonymous here. Role-based routing
 * (dashboard vs. customer portal) is enforced in the server layouts.
 */

/**
 * Paths that are always allowed without any cookie check.
 *
 * Note: `_next`, static assets, and these API routes are also excluded by the
 * `config.matcher` below so middleware does not even run for them — this list
 * is the in-handler safety net / source of truth for the matcher.
 */
const PUBLIC_PATHS = ["/login", "/setup"];

const PUBLIC_PATH_PREFIXES = [
  "/api/auth", // Better Auth's own endpoints (sign-in/out, callbacks).
  "/api/health",
  "/api/version",
  // tRPC enforces its own auth and returns JSON 401s; never issue an HTML
  // redirect for API calls.
  "/api/trpc",
];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  return PUBLIC_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function middleware(request: NextRequest): NextResponse {
  // Invariant: when auth is disabled the middleware is a complete no-op.
  if (env.AUTH_ENABLED !== "true") {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // Optimistic check only — presence of the cookie, not validity. Real
  // validation happens in the server layout (RSC) and tRPC procedures.
  const sessionCookie = getSessionCookie(request);

  if (!sessionCookie) {
    const loginUrl = new URL("/login", request.url);
    // Preserve where the user was heading so the login page can bounce back.
    loginUrl.searchParams.set("redirect", pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  // Authenticated (cookie present): allow through. Role-based dashboard-vs-portal
  // routing is enforced in the server layouts, which can afford the DB lookup.
  return NextResponse.next();
}

export const config = {
  /**
   * Run middleware on everything EXCEPT:
   *  - `_next/*` (Next internals + build output) — blocking these breaks the app
   *  - the always-public API routes (auth, health, version, trpc)
   *  - common static asset file extensions (favicon, images, fonts, etc.)
   *
   * This keeps middleware on app routes and protected APIs (e.g. the catalog
   * PDF file route) only.
   */
  matcher: [
    "/((?!_next/|api/auth|api/health|api/version|api/trpc|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|css|js|map|txt|woff|woff2|ttf|otf|eot)$).*)",
  ],
};
