import { NextResponse } from "next/server";

import { getReadinessStatus } from "~/server/services/readiness";

export async function GET() {
  const readiness = await getReadinessStatus();
  return NextResponse.json(readiness, { status: readiness.ok ? 200 : 503 });
}
