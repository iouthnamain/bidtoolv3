import {
  SEARCH_ENTITY_LABELS,
  getSearchEntityType,
  type SearchMode,
} from "~/lib/search-modes";
import { type RouterOutputs } from "~/trpc/react";

export type SearchResult = RouterOutputs["search"]["querySearchResults"];
export type SearchItem = SearchResult["items"][number];

export type FormState = {
  keyword: string;
  provinces: string[];
  packageCategories: string[];
  classifyIds: number[];
  planFields: string[];
  procurementMethods: string[];
  projectGroups: string[];
  budgetMin: string;
  budgetMax: string;
  publishedFrom: string;
  publishedTo: string;
  minMatchScore: number;
};

export function selectedKey(item: SearchItem) {
  return `${item.entityType}:${item.externalId}`;
}

export function entityLabelForMode(mode: SearchMode) {
  return SEARCH_ENTITY_LABELS[getSearchEntityType(mode)];
}
