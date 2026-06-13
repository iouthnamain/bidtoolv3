import { type inferRouterInputs } from "@trpc/server";

import { type SortOrder } from "~/constants/search-options";
import {
  parsePositiveId,
  parsePositiveInt,
  readSearchCriteriaFromSearchParams,
} from "~/lib/search-criteria";
import type { SearchMode } from "~/lib/search-modes";
import { type AppRouter } from "~/server/api/root";
import { api } from "~/trpc/server";

export type SearchQueryInput =
  inferRouterInputs<AppRouter>["search"]["querySearchResults"];

export function toUrlSearchParams(
  searchParams: Record<string, string | string[] | undefined>,
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

export function buildSearchQueryInput(
  searchParams: URLSearchParams,
  mode: SearchMode,
): SearchQueryInput {
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

export function prefetchSearchPageData(
  searchParams: URLSearchParams,
  mode: SearchMode,
) {
  void api.search.querySearchResults.prefetch(
    buildSearchQueryInput(searchParams, mode),
  );

  const savedFilterId = parsePositiveId(searchParams.get("savedFilterId"));
  if (savedFilterId !== null) {
    void api.search.getSavedFilter.prefetch({ id: savedFilterId });
  }
}
