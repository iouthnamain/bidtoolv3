import { Suspense } from "react";
import type { Metadata } from "next";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Đăng nhập",
  description: "Đăng nhập vào BidTool.",
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  // useSearchParams() in LoginForm requires a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
