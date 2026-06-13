import { createPageMetadata } from "~/app/_lib/seo";
import { prefetchSearchPageData, toUrlSearchParams } from "~/app/_lib/search-page";
import { SearchPageClient } from "~/app/_components/dashboard/search-page-client";
import { getSearchPathForMode } from "~/lib/search-routes";
import { HydrateClient } from "~/trpc/server";

const MODE = "package_keyword" as const;

export const metadata = createPageMetadata({
  title: "Tìm kiếm gói thầu",
  description: "Tìm gói thầu từ BidWinner theo từ khóa, ngành nghề, địa phương và ngân sách.",
  path: getSearchPathForMode(MODE),
  keywords: ["tìm gói thầu", "BidWinner", "đấu thầu"],
});

type SearchModePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SearchPackagesPage({
  searchParams,
}: SearchModePageProps) {
  const parsedSearchParams = toUrlSearchParams(await searchParams);
  prefetchSearchPageData(parsedSearchParams, MODE);

  return (
    <HydrateClient>
      <SearchPageClient fixedMode={MODE} />
    </HydrateClient>
  );
}
