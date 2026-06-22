import { NextResponse } from "next/server";

import { getVersionStatus } from "~/server/services/version-info";
import { logApiRoute } from "~/server/lib/trpc-request-log";

export const dynamic = "force-dynamic";

export async function GET() {
  return logApiRoute({
    route: "/api/version",
    method: "GET",
    handler: async () => {
      const status = await getVersionStatus();
      return NextResponse.json(status);
    },
  });
}
