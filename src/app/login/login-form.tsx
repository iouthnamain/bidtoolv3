"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { signIn, authClient } from "~/lib/auth-client";
import { isInternalRole, ROLES, type Role } from "~/lib/permissions";
import { Button } from "~/app/_components/ui";

/** Only allow same-origin relative redirects to avoid open-redirect attacks. */
function safeRedirect(target: string | null): string | null {
  if (!target) return null;
  // Must be a root-relative path, not a protocol-relative ("//evil") URL.
  if (target.startsWith("/") && !target.startsWith("//")) {
    return target;
  }
  return null;
}

function normalizeRole(role: string | null | undefined): Role | null {
  if (role && (ROLES as readonly string[]).includes(role)) {
    return role as Role;
  }
  return null;
}

/** Map a Better Auth error code/message to a Vietnamese message. */
function describeError(message: string | undefined, code: string | undefined) {
  if (code === "INVALID_EMAIL_OR_PASSWORD") {
    return "Email hoặc mật khẩu không đúng.";
  }
  if (code === "USER_BANNED" || code === "BANNED_USER") {
    return "Tài khoản đã bị khóa. Liên hệ quản trị viên.";
  }
  if (code === "EMAIL_NOT_VERIFIED") {
    return "Email chưa được xác minh.";
  }
  return message ?? "Đăng nhập thất bại. Vui lòng thử lại.";
}

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const result = await signIn.email({ email, password });

    if (result.error) {
      setError(describeError(result.error.message, result.error.code));
      setIsSubmitting(false);
      return;
    }

    // Resolve destination. Prefer an explicit, safe `redirect` query param.
    const requested = safeRedirect(searchParams.get("redirect"));
    if (requested) {
      router.replace(requested);
      return;
    }

    // Otherwise route by role: internal users -> dashboard, customers -> portal.
    // The sign-in response doesn't always carry the role, so read the session.
    const session = await authClient.getSession();
    const role = normalizeRole(session.data?.user.role);
    router.replace(isInternalRole(role) ? "/" : role === "customer" ? "/portal" : "/");
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="panel overflow-hidden">
          <div className="border-b border-slate-400 px-6 py-2">
            <h1 className="text-lg font-bold text-slate-950">Đăng nhập</h1>
            <p className="mt-1 text-sm text-slate-600">
              Đăng nhập để tiếp tục sử dụng BidTool.
            </p>
          </div>

          <form className="space-y-4 px-6 py-2" onSubmit={handleSubmit} noValidate>
            <div className="flex flex-col gap-1">
              <label htmlFor="login-email">
                <span className="text-xs font-semibold tracking-[0.12em] text-slate-600 uppercase">
                  Email
                </span>
              </label>
              <input
                id="login-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isSubmitting}
                className="h-11 w-full rounded border border-slate-400 bg-white px-3 text-sm text-slate-900 transition-colors duration-0 focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-100 focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-slate-100"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="login-password">
                <span className="text-xs font-semibold tracking-[0.12em] text-slate-600 uppercase">
                  Mật khẩu
                </span>
              </label>
              <input
                id="login-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isSubmitting}
                className="h-11 w-full rounded border border-slate-400 bg-white px-3 text-sm text-slate-900 transition-colors duration-0 focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-100 focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-slate-100"
              />
            </div>

            {error ? (
              <p
                role="alert"
                className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
              >
                {error}
              </p>
            ) : null}

            <Button
              type="submit"
              className="w-full"
              isLoading={isSubmitting}
              disabled={!email || !password}
            >
              Đăng nhập
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
