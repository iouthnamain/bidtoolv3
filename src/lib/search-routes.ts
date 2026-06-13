import type { SearchMode } from "~/lib/search-modes";

export const SEARCH_MODE_PATHS = {
  package_keyword: "/search/packages",
  package_location: "/search/packages/location",
  package_area_location: "/search/packages/area",
  plan: "/search/plans",
  project: "/search/projects",
} as const satisfies Record<SearchMode, `/${string}`>;

const PATH_TO_MODE = Object.fromEntries(
  Object.entries(SEARCH_MODE_PATHS).map(([mode, path]) => [path, mode]),
) as Record<string, SearchMode>;

export function getSearchPathForMode(mode: SearchMode): `/${string}` {
  return SEARCH_MODE_PATHS[mode];
}

export function readSearchModeFromPathname(pathname: string): SearchMode | null {
  return PATH_TO_MODE[pathname] ?? null;
}

export const SEARCH_MODE_NAV_ITEMS = (
  Object.entries(SEARCH_MODE_PATHS) as Array<[SearchMode, string]>
).map(([mode, href]) => ({ mode, href }));
