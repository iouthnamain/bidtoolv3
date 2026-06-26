import { createLogger, traceFn } from "~/server/lib/logger";
const log = createLogger("services-excel-research-query-builder");

export type SearchQuery = {
  query: string;
  intent:
    | "official"
    | "datasheet"
    | "pdf"
    | "general"
    | "bang_gia"
    | "vn_spec"
    | "vn_pdf";
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
  unit?: string | null;
  category?: string | null;
  originCountry?: string | null;
  maxQueries?: number;
}): SearchQuery[] {
  const name = input.name.trim();
  if (!name) return [];

  const brand = input.manufacturer?.trim() ?? "";
  const code = input.code?.trim() ?? "";
  const sku = input.sku?.trim() ?? "";
  const model = input.model?.trim() ?? "";
  const identifier = sku || model || code;
  const category = input.category?.trim() ?? "";
  const unit = input.unit?.trim() ?? "";
  const origin = input.originCountry?.trim() ?? "";
  const maxQueries = Math.max(1, input.maxQueries ?? 6);
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
    push(`${brand} ${identifier} catalogue filetype:pdf`, "vn_pdf");
  }

  if (brand) {
    push(`${brand} ${name} thông số kỹ thuật`, "vn_spec");
    push(`${name} ${brand} thông số kỹ thuật filetype:pdf`, "vn_pdf");
    push(`${name} bảng giá ${brand}`, "bang_gia");
  }

  if (identifier) {
    push(brand ? `${identifier} ${brand}` : identifier, "official");
    if (brand) {
      push(`${identifier} catalogue ${brand}`, "vn_pdf");
    }
  }

  if (category && textOverlap(category, name) < 0.6) {
    push(`${name} ${category}`, "general");
  }

  if (unit && textOverlap(unit, name) < 0.5) {
    push(`${name} ${unit}`, "general");
  }

  if (origin && brand) {
    push(`${name} ${brand} ${origin}`, "general");
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
