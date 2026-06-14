import { createPageMetadata } from "~/app/_lib/seo";
import { ResearchEnrichClient } from "~/app/_components/research-enrich/research-enrich-client";

export const dynamic = "force-dynamic";

export const metadata = createPageMetadata({
  title: "Nghiên cứu Excel",
  description:
    "Tải lên Excel sản phẩm, chạy job nghiên cứu AI, xét duyệt bằng chứng và kế hoạch điền rồi xuất file hoàn chỉnh.",
  path: "/research-enrich",
  keywords: [
    "nghiên cứu Excel",
    "research Excel",
    "điền sản phẩm",
    "AI nghiên cứu vật tư",
  ],
});

export default function ResearchEnrichPage() {
  return <ResearchEnrichClient />;
}
