import { createPageMetadata } from "~/app/_lib/seo";
import { prefetchSearchPageData, toUrlSearchParams } from "~/app/_lib/search-page";
import { SearchPageClient } from "~/app/_components/dashboard/search-page-client";
import { getSearchPathForMode } from "~/lib/search-routes";
import { HydrateClient } from "~/trpc/server";

const MODE = "package_location" as const;

export const metadata = createPageMetadata({
  title: "Tìm kiếm theo địa phương",
  description: "Tìm gói thầu theo tỉnh/thành từ nguồn BidWinner public.",
  path: getSearchPathForMode(MODE),
});

type SearchModePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SearchPackagesLocationPage({
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
