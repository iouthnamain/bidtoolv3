import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    ok: true,
    service: "bidtoolv3",
    timestamp: new Date().toISOString(),
  });
}
