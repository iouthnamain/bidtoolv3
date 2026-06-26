import Link from "next/link";

import { Logo } from "~/app/_components/brand/logo";
import { createPageMetadata } from "~/app/_lib/seo";

export const metadata = createPageMetadata({
  title: "BidTool v3",
  description: "Procurement OS cho BidWinner.",
  path: "/",
});

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-4">
      <Logo href="/" ariaLabel="BidTool v3" tagline="Procurement OS" size="lg" />
      <Link
        href="/dashboard"
        className="inline-flex min-h-10 items-center rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-800 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:outline-none"
      >
        Vào dashboard
      </Link>
    </main>
  );
}
