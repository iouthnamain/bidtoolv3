import { createPageMetadata } from "~/app/_lib/seo";
import { prefetchSearchPageData, toUrlSearchParams } from "~/app/_lib/search-page";
import { SearchPageClient } from "~/app/_components/dashboard/search-page-client";
import { getSearchPathForMode } from "~/lib/search-routes";
import { HydrateClient } from "~/trpc/server";

const MODE = "project" as const;

export const metadata = createPageMetadata({
  title: "Tìm kiếm dự án",
  description: "Tìm dự án đầu tư phát triển từ nguồn BidWinner public.",
  path: getSearchPathForMode(MODE),
});

type SearchModePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SearchProjectsPage({
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
