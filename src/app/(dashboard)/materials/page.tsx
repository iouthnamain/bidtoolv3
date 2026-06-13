import { createPageMetadata } from "~/app/_lib/seo";
import { MaterialsListClient } from "~/app/_components/materials/list-client";

export const metadata = createPageMetadata({
  title: "Sản phẩm / vật tư",
  description:
    "Quản lý catalog sản phẩm và vật tư để import, đối chiếu, chuẩn hóa và tái sử dụng trong BidTool v3.",
  path: "/materials",
  keywords: ["quản lý vật tư", "catalog sản phẩm", "danh mục vật tư"],
});

export default function MaterialsPage() {
  return <MaterialsListClient />;
}
