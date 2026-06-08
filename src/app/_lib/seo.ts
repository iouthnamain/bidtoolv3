import { type Metadata } from "next";

export const siteConfig = {
  name: "BidTool v3",
  shortName: "BidTool",
  url: "https://bidtoolv3.vercel.app",
  locale: "vi_VN",
  language: "vi",
  title: "BidTool v3 - Procurement OS",
  description:
    "BidTool v3 gom tìm kiếm BidWinner, Smart View, workflow cảnh báo và import catalog vật tư vào một trung tâm điều hành đấu thầu.",
  keywords: [
    "BidTool",
    "đấu thầu",
    "BidWinner",
    "gói thầu",
    "KHLCNT",
    "quản lý vật tư",
    "catalog vật tư",
    "workflow đấu thầu",
  ],
};

export function getSiteUrl() {
  const rawUrl =
    process.env.APP_BASE_URL?.trim() ??
    process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() ??
    process.env.VERCEL_URL?.trim() ??
    siteConfig.url;
  const url = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;

  try {
    return new URL(url).origin;
  } catch {
    return siteConfig.url;
  }
}

export function absoluteUrl(path = "/") {
  return new URL(path, getSiteUrl()).toString();
}

export function createPageMetadata({
  title,
  description,
  path = "/",
  keywords = [],
  noIndex = false,
}: {
  title: string;
  description: string;
  path?: `/${string}`;
  keywords?: string[];
  noIndex?: boolean;
}): Metadata {
  const canonical = absoluteUrl(path);

  return {
    title,
    description,
    keywords: [...siteConfig.keywords, ...keywords],
    alternates: {
      canonical,
    },
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: siteConfig.name,
      locale: siteConfig.locale,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
    robots: noIndex
      ? {
          index: false,
          follow: false,
          googleBot: {
            index: false,
            follow: false,
          },
        }
      : undefined,
  };
}
