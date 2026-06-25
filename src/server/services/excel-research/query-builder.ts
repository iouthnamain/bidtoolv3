import { createLogger, traceFn } from "~/server/lib/logger";
const log = createLogger("services-excel-research-query-builder");

export type SearchQuery = {
  query: string;
  intent: "official" | "datasheet" | "pdf" | "general";
};

function textOverlap(a: string, b: string): number {
  const tokensA = new Set(
    a
      .toLowerCase()
      .split(/\s+/)
      .filter((token) => token.length > 2),
  );
  const tokensB = new Set(
    b
      .toLowerCase()
      .split(/\s+/)
      .filter((token) => token.length > 2),
  );
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let overlap = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) {
      overlap += 1;
    }
  }
  return overlap / Math.min(tokensA.size, tokensB.size);
}

function _buildSearchQueries(input: {
  name: string;
  manufacturer?: string | null;
  code?: string | null;
  specText?: string | null;
  sku?: string | null;
  model?: string | null;
  maxQueries?: number;
}): SearchQuery[] {
  const name = input.name.trim();
  if (!name) return [];

  const brand = input.manufacturer?.trim() ?? "";
  const code = input.code?.trim() ?? "";
  const sku = input.sku?.trim() ?? "";
  const model = input.model?.trim() ?? "";
  const identifier = sku || model || code;
  const maxQueries = Math.max(1, input.maxQueries ?? 4);
  const queries: SearchQuery[] = [];

  const push = (
    query: string | null | undefined,
    intent: SearchQuery["intent"],
  ) => {
    const trimmed = query?.trim();
    if (!trimmed || trimmed.length < 3) return;
    if (queries.some((item) => item.query === trimmed)) return;
    if (queries.some((item) => textOverlap(trimmed, item.query) > 0.75)) return;
    queries.push({ query: trimmed, intent });
  };

  if (brand && identifier) {
    push(`"${brand}" "${identifier}" datasheet filetype:pdf`, "pdf");
  }

  if (brand) {
    push(`${brand} ${name} thông số kỹ thuật`, "official");
  }

  if (identifier) {
    push(brand ? `${identifier} ${brand}` : identifier, "official");
  }

  if (input.specText) {
    const shortSpec = input.specText.slice(0, 60).trim();
    if (textOverlap(shortSpec, name) < 0.6) {
      push(`${name} ${shortSpec}`, "general");
    }
  }

  push(`${name} catalog datasheet`, "datasheet");
  push(brand ? `${name} ${brand}` : name, "general");

  return queries.slice(0, maxQueries);
}

export const buildSearchQueries = traceFn(
  log,
  "buildSearchQueries",
  _buildSearchQueries,
);
