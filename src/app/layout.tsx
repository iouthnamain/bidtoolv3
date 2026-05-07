import "~/styles/globals.css";

import { type Metadata } from "next";
import { Be_Vietnam_Pro } from "next/font/google";

import { ToastProvider } from "~/app/_components/ui/toast";
import { TRPCReactProvider } from "~/trpc/react";

export const metadata: Metadata = {
  title: {
    default: "BidTool v3",
    template: "%s · BidTool v3",
  },
  description: "Nền tảng điều hành, tìm kiếm và tự động hóa đấu thầu",
  applicationName: "BidTool v3",
  openGraph: {
    title: "BidTool v3",
    description: "Nền tảng điều hành, tìm kiếm và tự động hóa đấu thầu",
    locale: "vi_VN",
    type: "website",
  },
};

const beVietnamPro = Be_Vietnam_Pro({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-be-vietnam-pro",
});

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi" className={`${beVietnamPro.variable}`}>
      <body className="app-bg text-slate-900 antialiased">
        <TRPCReactProvider>
          <ToastProvider>{children}</ToastProvider>
        </TRPCReactProvider>
      </body>
    </html>
  );
}
