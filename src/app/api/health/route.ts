import { NextResponse } from "next/server";

import { logApiRoute } from "~/server/lib/trpc-request-log";

export async function GET() {
  const desktopInstance = process.env.BIDTOOL_DESKTOP_INSTANCE;
  return logApiRoute({
    route: "/api/health",
    method: "GET",
    handler: async () =>
      NextResponse.json(
        { ok: true, service: "bidtoolv3", timestamp: new Date().toISOString() },
        desktopInstance
          ? { headers: { "x-bidtool-desktop-instance": desktopInstance } }
          : undefined,
      ),
  });
}
