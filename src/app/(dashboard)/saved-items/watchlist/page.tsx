import { createPageMetadata } from "~/app/_lib/seo";
import { WatchlistSection } from "~/app/_components/dashboard/watchlist-section";

export const metadata = createPageMetadata({
  title: "Danh sách theo dõi",
  description:
    "Theo dõi gói thầu, KHLCNT, dự án và các nguồn cần quay lại sau trong BidTool v3.",
  path: "/saved-items/watchlist",
  keywords: ["watchlist đấu thầu", "theo dõi gói thầu", "KHLCNT"],
});

export default function WatchlistPage() {
  return <WatchlistSection />;
}
