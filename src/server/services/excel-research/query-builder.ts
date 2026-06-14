export type SearchQuery = {
  query: string;
  intent: "official" | "datasheet" | "pdf" | "general";
};

export function buildSearchQueries(input: {
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
