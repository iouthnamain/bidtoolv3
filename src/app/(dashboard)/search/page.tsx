import { Suspense } from "react";
import { type inferRouterInputs } from "@trpc/server";

import { createPageMetadata } from "~/app/_lib/seo";
import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { searchSectionNavItems } from "~/app/_components/dashboard/page-nav-presets";
import { SearchPageClient } from "~/app/_components/dashboard/search-page-client";
import { type SortOrder } from "~/constants/search-options";
import {
  parsePositiveId,
  parsePositiveInt,
  readSearchCriteriaFromSearchParams,
  readSearchModeFromSearchParams,
} from "~/lib/search-criteria";
import { type AppRouter } from "~/server/api/root";
import { HydrateClient, api } from "~/trpc/server";

type SearchPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const metadata = createPageMetadata({
  title: "Tìm kiếm BidWinner",
  description:
    "Tìm kiếm gói thầu, KHLCNT và dự án đầu tư phát triển từ BidWinner theo từ khóa, ngành nghề, địa phương và ngân sách.",
  path: "/search",
  keywords: ["tìm kiếm BidWinner", "tìm gói thầu", "KHLCNT", "dự án đầu tư"],
});

type SearchQueryInput =
  inferRouterInputs<AppRouter>["search"]["querySearchResults"];

function toUrlSearchParams(
  searchParams: Awaited<SearchPageProps["searchParams"]>,
) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        params.append(key, item);
      }
      continue;
    }

    if (typeof value === "string") {
      params.set(key, value);
    }
  }

  return params;
}

function readSortOrderFromSearchParams(
  searchParams: URLSearchParams,
): SortOrder {
  return searchParams.get("sortOrder") === "asc" ? "asc" : "desc";
}

function buildSearchQueryInput(
  searchParams: URLSearchParams,
): SearchQueryInput {
  const mode = readSearchModeFromSearchParams(searchParams);
  const criteria = readSearchCriteriaFromSearchParams(searchParams);
  const page = parsePositiveInt(searchParams.get("page"), 1);
  const limit = parsePositiveInt(searchParams.get("limit"), 20);
  const sortOrder = readSortOrderFromSearchParams(searchParams);

  return {
    mode,
    keyword: criteria.keyword,
    provinces: criteria.provinces,
    packageCategories: criteria.packageCategories,
    classifyIds: criteria.classifyIds,
    planFields: criteria.planFields,
    procurementMethods: criteria.procurementMethods,
    projectGroups: criteria.projectGroups,
    budgetMin: criteria.budgetMin,
    budgetMax: criteria.budgetMax,
    publishedFrom: criteria.publishedFrom ? criteria.publishedFrom : undefined,
    publishedTo: criteria.publishedTo ? criteria.publishedTo : undefined,
    minMatchScore: criteria.minMatchScore,
    sortOrder,
    offset: (page - 1) * limit,
    limit,
  };
}

function prefetchSearchPageData(searchParams: URLSearchParams) {
  void api.search.querySearchResults.prefetch(
    buildSearchQueryInput(searchParams),
  );

  const savedFilterId = parsePositiveId(searchParams.get("savedFilterId"));
  if (savedFilterId !== null) {
    void api.search.getSavedFilter.prefetch({ id: savedFilterId });
  }
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const parsedSearchParams = toUrlSearchParams(await searchParams);
  prefetchSearchPageData(parsedSearchParams);

  return (
    <DashboardShell
      title="Tìm kiếm public từ BidWinner"
      description="Một trung tâm tìm kiếm cho gói thầu, theo địa phương, ngành nghề & địa phương, KHLCNT và dự án đầu tư phát triển"
      sectionNavItems={searchSectionNavItems}
      sectionNavTitle="Luồng tìm kiếm"
    >
      <HydrateClient>
        <Suspense
          fallback={
            <div className="rounded-2xl border border-slate-200/80 bg-white/95 px-4 py-6 text-sm text-slate-600 shadow-sm">
              Đang tải dữ liệu tìm kiếm public…
            </div>
          }
        >
          <SearchPageClient />
        </Suspense>
      </HydrateClient>
    </DashboardShell>
  );
}
