import { createPageMetadata } from "~/app/_lib/seo";
import { MaterialsListClient } from "~/app/_components/materials/list-client";

export const metadata = createPageMetadata({
  title: "Thống kê vật tư",
  description:
    "Tổng quan số vật tư, đơn giá, nguồn giá và category trong catalog BidTool v3.",
  path: "/materials/stats",
  keywords: ["thống kê vật tư", "catalog vật tư"],
});

export default function MaterialsStatsPage() {
  return <MaterialsListClient view="stats" />;
}
