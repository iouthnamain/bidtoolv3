"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "~/app/_components/ui";

interface SetupResponse {
  ok: boolean;
  error?: string;
}

export function SetupForm() {
  const router = useRouter();

  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Mật khẩu phải có tối thiểu 8 ký tự.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, email, name, password }),
      });
      const data = (await response.json()) as SetupResponse;

      if (!response.ok || !data.ok) {
        setError(data.error ?? "Thiết lập thất bại. Vui lòng thử lại.");
        setIsSubmitting(false);
        return;
      }

      // Account created. Send the operator to sign in.
      router.replace("/login");
    } catch {
      setError("Không thể kết nối tới máy chủ. Vui lòng thử lại.");
      setIsSubmitting(false);
    }
  };

  const inputClass =
    "h-11 w-full rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] px-3 text-sm text-slate-900 transition-colors duration-0 focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-100 focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-slate-100";
  const labelClass =
    "text-xs font-semibold tracking-[0.12em] text-slate-600 uppercase";

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="panel overflow-hidden">
          <div className="border-b border-slate-400 px-6 py-2">
            <h1 className="text-lg font-bold text-slate-950">
              Thiết lập quản trị viên
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Tạo tài khoản admin đầu tiên cho hệ thống. Cần mã thiết lập do
              người cài đặt cung cấp.
            </p>
          </div>

          <form className="space-y-4 px-6 py-2" onSubmit={handleSubmit} noValidate>
            <div className="flex flex-col gap-1">
              <label htmlFor="setup-token">
                <span className={labelClass}>Mã thiết lập</span>
              </label>
              <input
                id="setup-token"
                type="password"
                autoComplete="off"
                required
                value={token}
                onChange={(e) => setToken(e.target.value)}
                disabled={isSubmitting}
                className={inputClass}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="setup-name">
                <span className={labelClass}>Họ tên</span>
              </label>
              <input
                id="setup-name"
                type="text"
                autoComplete="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isSubmitting}
                className={inputClass}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="setup-email">
                <span className={labelClass}>Email</span>
              </label>
              <input
                id="setup-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isSubmitting}
                className={inputClass}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="setup-password">
                <span className={labelClass}>Mật khẩu</span>
              </label>
              <input
                id="setup-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isSubmitting}
                className={inputClass}
              />
              <span className="text-xs text-slate-700">
                Tối thiểu 8 ký tự.
              </span>
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
              disabled={!token || !email || !name || !password}
            >
              Tạo tài khoản admin
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
