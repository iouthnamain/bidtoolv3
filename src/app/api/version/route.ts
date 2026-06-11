import { NextResponse } from "next/server";

import { getVersionStatus } from "~/server/services/version-info";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = await getVersionStatus();
  return NextResponse.json(status);
}
