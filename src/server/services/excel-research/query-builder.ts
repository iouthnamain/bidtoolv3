import { createLogger, traceFn } from "~/server/lib/logger";
const log = createLogger("services-excel-research-query-builder");

export type SearchQuery = {
  query: string;
  intent: "official" | "datasheet" | "pdf" | "general";
};

function _buildSearchQueries(input: {
  name: string;
  manufacturer?: string;
  code?: string;
  specText?: string;
}): SearchQuery[] {
  const name = input.name.trim();
  if (!name) return [];

  const brand = input.manufacturer?.trim() ?? "";
  const code = input.code?.trim() ?? "";
  const queries: SearchQuery[] = [];

  if (brand && code) {
    queries.push({
      query: `"${brand}" "${code}" datasheet filetype:pdf`,
      intent: "pdf",
    });
  }

  if (brand) {
    queries.push({
      query: `${brand} ${name} thông số kỹ thuật`,
      intent: "official",
    });
  }

  queries.push({
    query: `${name} catalog datasheet`,
    intent: "datasheet",
  });

  return queries.slice(0, 2);
}

export const buildSearchQueries = traceFn(log, "buildSearchQueries", _buildSearchQueries);
