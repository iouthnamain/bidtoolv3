import { createPageMetadata } from "~/app/_lib/seo";
import { HelpIndexContent } from "~/app/_components/dashboard/help-index-content";

export const metadata = createPageMetadata({
  title: "Hướng dẫn sử dụng",
  description:
    "Hướng dẫn setup, tìm kiếm BidWinner, bộ lọc thông minh, workflow, import vật tư và vận hành BidTool v3.",
  path: "/help",
  keywords: ["hướng dẫn BidTool", "setup BidTool", "quy trình đấu thầu"],
});

export default function HelpPage() {
  return <HelpIndexContent />;
}
