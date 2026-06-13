import { createPageMetadata } from "~/app/_lib/seo";
import { prefetchSearchPageData, toUrlSearchParams } from "~/app/_lib/search-page";
import { SearchPageClient } from "~/app/_components/dashboard/search-page-client";
import { getSearchPathForMode } from "~/lib/search-routes";
import { HydrateClient } from "~/trpc/server";

const MODE = "plan" as const;

export const metadata = createPageMetadata({
  title: "Tìm kiếm KHLCNT",
  description: "Tìm kế hoạch lựa chọn nhà thầu từ nguồn BidWinner public.",
  path: getSearchPathForMode(MODE),
});

type SearchModePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SearchPlansPage({
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
