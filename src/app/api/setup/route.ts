import { NextResponse } from "next/server";

function retired() {
  return NextResponse.json(
    { error: "Thiết lập tài khoản đã được gỡ khỏi BidTool local." },
    { status: 410 },
  );
}

export const GET = retired;
export const POST = retired;
export const PUT = retired;
export const PATCH = retired;
export const DELETE = retired;
export const OPTIONS = retired;
