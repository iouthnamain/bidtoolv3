import { createPageMetadata } from "~/app/_lib/seo";
import { MaterialEnrichClient } from "~/app/_components/enrich/enrich-client";

export const dynamic = "force-dynamic";

export const metadata = createPageMetadata({
  title: "Đối chiếu & điền Excel",
  description:
    "Tải lên Excel còn thiếu trường, đối chiếu catalog, nghiên cứu web (tùy chọn) và xuất file đã điền.",
  path: "/enrich",
  keywords: ["đối chiếu Excel", "điền vật tư", "enrich Excel", "ghép catalog"],
});

export default function EnrichPage() {
  return <MaterialEnrichClient />;
}
