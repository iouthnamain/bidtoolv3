import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

import { env } from "~/env";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { user } from "~/server/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

interface SetupBody {
  token?: unknown;
  email?: unknown;
  name?: unknown;
  password?: unknown;
}

/** Constant-time string comparison that never short-circuits on length. */
function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) {
    // Still run a compare to keep timing roughly constant, then fail.
    timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

function badRequest(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

/**
 * One-time bootstrap of the first admin account for a fresh web/on-prem install.
 *
 * Security model:
 * - Requires AUTH_BOOTSTRAP_TOKEN to be configured server-side; if unset, setup
 *   is disabled entirely (no way to call this without an out-of-band secret).
 * - The submitted token is compared in constant time.
 * - Refuses if any user already exists (setup is strictly one-time). This also
 *   avoids leaking whether a specific email exists.
 */
export async function POST(request: Request) {
  const configuredToken = env.AUTH_BOOTSTRAP_TOKEN?.trim();
  if (!configuredToken) {
    return badRequest(
      "Thiết lập ban đầu đã bị tắt. Cấu hình AUTH_BOOTSTRAP_TOKEN để bật.",
      403,
    );
  }

  let body: SetupBody;
  try {
    body = (await request.json()) as SetupBody;
  } catch {
    return badRequest("Dữ liệu không hợp lệ.");
  }

  const token = typeof body.token === "string" ? body.token : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!safeEqual(token, configuredToken)) {
    // Generic message: don't reveal whether the token was close.
    return badRequest("Mã thiết lập không hợp lệ.", 401);
  }

  if (!email || !name || password.length < 8) {
    return badRequest(
      "Cần nhập email, tên và mật khẩu tối thiểu 8 ký tự.",
    );
  }

  // One-time guard: refuse if ANY user already exists.
  const existing = await db.select({ id: user.id }).from(user).limit(1);
  if (existing.length > 0) {
    return badRequest(
      "Hệ thống đã có người dùng. Thiết lập ban đầu chỉ chạy một lần.",
      409,
    );
  }

  // Create the user via Better Auth (hashes the password, creates account row).
  try {
    await auth.api.signUpEmail({
      body: { name, email, password },
    });
  } catch (caught) {
    const message =
      caught instanceof Error ? caught.message : "Không thể tạo tài khoản.";
    return badRequest(message, 400);
  }

  // Promote the freshly-created user to admin. signUpEmail can't set a role,
  // and the admin set-role endpoint requires an existing admin caller — so for
  // the literal first user we update the role column directly.
  try {
    await db
      .update(user)
      .set({ role: "admin", emailVerified: true, updatedAt: new Date() })
      .where(eq(user.email, email));
  } catch (caught) {
    const message =
      caught instanceof Error
        ? caught.message
        : "Đã tạo tài khoản nhưng không thể đặt quyền admin.";
    return badRequest(message, 500);
  }

  return NextResponse.json({ ok: true });
}
