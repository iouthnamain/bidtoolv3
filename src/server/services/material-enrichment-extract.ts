import "server-only";

import {
  ENRICHABLE_FIELDS,
  type EnrichableField,
  type MaterialEnrichmentEvidence,
  type MaterialEnrichmentInput,
} from "~/lib/materials/material-enrichment-types";
import { callAiProvider } from "~/server/services/ai-dispatch";
import type { ResolvedAiProvider } from "~/server/services/app-settings";
import type { WebSearchResult } from "~/server/services/material-web-search";

export type ExtractedProductFields = Partial<
  Record<
    EnrichableField,
    {
      value: string | null;
      confidence: number;
      evidence: MaterialEnrichmentEvidence[];
    }
  >
> & {
  catalogPdfUrls?: string[];
};

const EXTRACTION_SYSTEM_PROMPT = `You extract structured product data from web search snippets for construction materials.
Rules:
- Return JSON only. No markdown fences or commentary.
- Use only facts explicitly present in the provided snippets.
- Never invent values. If uncertain, set value to null and confidence to 0.
- Each non-null field must include at least one evidence item with field, value, sourceUrl, snippet copied from the snippets.
- confidence is 0..1 reflecting how directly the snippet supports the value.
- catalogPdfUrls may only include PDF URLs present in the snippets.

JSON shape:
{
  "fields": {
    "category": { "value": string|null, "confidence": number, "evidence": [{ "field": string, "value": string, "sourceUrl": string, "snippet": string }] },
    "specText": { ... },
    "manufacturer": { ... },
    "originCountry": { ... },
    "unit": { ... },
    "sourceUrl": { ... }
  },
  "catalogPdfUrls": string[]
}`;

function buildExtractionUserPrompt(
  input: MaterialEnrichmentInput,
  candidates: WebSearchResult[],
) {
  const header = [
    "Material to enrich:",
    `name: ${input.name}`,
    `unit: ${input.unit}`,
    input.manufacturer ? `manufacturer: ${input.manufacturer}` : null,
    input.category ? `category: ${input.category}` : null,
    input.specText ? `specText: ${input.specText}` : null,
    input.sku ? `sku: ${input.sku}` : null,
    input.model ? `model: ${input.model}` : null,
    "",
    "Search snippets:",
  ]
    .filter(Boolean)
    .join("\n");

  const snippets = candidates
    .slice(0, 12)
    .map(
      (candidate, index) =>
        `[${index + 1}] title: ${candidate.title}\nurl: ${candidate.url}\ndomain: ${candidate.domain}\nsnippet: ${candidate.snippet}`,
    )
    .join("\n\n");

  return `${header}\n${snippets}`;
}

function extractJsonObject(content: string) {
  const trimmed = content.trim();
  const fencedPattern = /```(?:json)?\s*([\s\S]*?)```/i;
  const fenced = fencedPattern.exec(trimmed);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("LLM response did not contain JSON.");
  }
  return candidate.slice(start, end + 1);
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asConfidence(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function parseEvidenceList(value: unknown): MaterialEnrichmentEvidence[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const evidence: MaterialEnrichmentEvidence[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as Record<string, unknown>;
    const field = asString(record.field);
    const snippet = asString(record.snippet);
    const sourceUrl = asString(record.sourceUrl);
    const evidenceValue = asString(record.value);
    if (!field || !snippet || !sourceUrl) {
      continue;
    }
    evidence.push({ field, value: evidenceValue, sourceUrl, snippet });
  }
  return evidence;
}

function parseFieldResult(
  value: unknown,
  field: EnrichableField,
): ExtractedProductFields[EnrichableField] | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const rawValue = record.value;
  const normalizedValue =
    rawValue == null ? null : asString(rawValue) || null;
  const evidence = parseEvidenceList(record.evidence).filter(
    (item) => item.field === field,
  );
  if (!normalizedValue && evidence.length === 0) {
    return {
      value: null,
      confidence: 0,
      evidence: [],
    };
  }
  return {
    value: normalizedValue,
    confidence: asConfidence(record.confidence),
    evidence,
  };
}

export function parseExtractionResponse(content: string): ExtractedProductFields {
  const parsed = JSON.parse(extractJsonObject(content)) as Record<string, unknown>;
  const fields: ExtractedProductFields = {};
  const rawFields =
    parsed.fields && typeof parsed.fields === "object"
      ? (parsed.fields as Record<string, unknown>)
      : parsed;

  for (const field of ENRICHABLE_FIELDS) {
    const fieldResult = parseFieldResult(rawFields[field], field);
    if (fieldResult) {
      fields[field] = fieldResult;
    }
  }

  const catalogPdfUrls = Array.isArray(parsed.catalogPdfUrls)
    ? parsed.catalogPdfUrls
        .map((url) => asString(url))
        .filter((url) => url.length > 0 && /\.pdf(?:$|[?#])/i.test(url))
    : [];

  fields.catalogPdfUrls = [...new Set(catalogPdfUrls)];
  return fields;
}

export async function extractProductFromSources(
  input: MaterialEnrichmentInput,
  candidates: WebSearchResult[],
  provider: ResolvedAiProvider,
  signal?: AbortSignal,
): Promise<ExtractedProductFields> {
  if (candidates.length === 0) {
    return { catalogPdfUrls: [] };
  }

  const completion = await callAiProvider(
    provider,
    [
      { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
      { role: "user", content: buildExtractionUserPrompt(input, candidates) },
    ],
    { signal, responseFormat: "json_object" },
  );

  return parseExtractionResponse(completion.content);
}
