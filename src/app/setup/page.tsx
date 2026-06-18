import type { Metadata } from "next";

import { SetupForm } from "./setup-form";

export const metadata: Metadata = {
  title: "Thiết lập",
  description: "Thiết lập tài khoản quản trị viên đầu tiên.",
  robots: { index: false, follow: false },
};

export default function SetupPage() {
  return <SetupForm />;
}
