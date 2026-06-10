import { type MetadataRoute } from "next";

import { absoluteUrl } from "~/app/_lib/seo";

const routes: Array<{
  path: `/${string}`;
  priority: number;
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
}> = [
  { path: "/", priority: 1, changeFrequency: "daily" },
  { path: "/dashboard", priority: 0.9, changeFrequency: "daily" },
  { path: "/search", priority: 0.9, changeFrequency: "daily" },
  { path: "/saved-items", priority: 0.8, changeFrequency: "daily" },
  { path: "/workflows", priority: 0.8, changeFrequency: "weekly" },
  { path: "/notifications", priority: 0.7, changeFrequency: "daily" },
  { path: "/documents", priority: 0.7, changeFrequency: "weekly" },
  { path: "/import-mapping", priority: 0.7, changeFrequency: "weekly" },
  { path: "/materials", priority: 0.8, changeFrequency: "weekly" },
  { path: "/materials/import", priority: 0.7, changeFrequency: "weekly" },
  { path: "/materials/scrape", priority: 0.7, changeFrequency: "weekly" },
  { path: "/materials/new", priority: 0.5, changeFrequency: "monthly" },
  { path: "/insights", priority: 0.7, changeFrequency: "daily" },
  { path: "/help", priority: 0.8, changeFrequency: "monthly" },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return routes.map((route) => ({
    url: absoluteUrl(route.path),
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
