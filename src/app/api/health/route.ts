import { NextResponse } from "next/server";

import { logApiRoute } from "~/server/lib/trpc-request-log";

export async function GET() {
  return logApiRoute({
    route: "/api/health",
    method: "GET",
    handler: async () =>
      NextResponse.json({
        ok: true,
        service: "bidtoolv3",
        timestamp: new Date().toISOString(),
      }),
  });
}
