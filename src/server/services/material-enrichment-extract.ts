import "server-only";

import {
  ENRICHABLE_FIELDS,
  type EnrichableField,
  type MaterialEnrichmentEvidence,
  type MaterialEnrichmentInput,
} from "~/lib/materials/material-enrichment-types";
import { callAiProvider } from "~/server/services/ai-dispatch";
import {
  resolveEnrichmentAiConcurrency,
  resolveEnrichmentAiTimeoutMs,
  type ResolvedAiProvider,
} from "~/server/services/app-settings";
import { createAsyncLimiter } from "~/server/services/concurrency";
import type { WebSearchResult } from "~/server/services/material-web-search";
import { createLogger, traceFn } from "~/server/lib/logger";
const log = createLogger("services-material-enrichment-extract");

let aiLimiterConcurrency = 0;
let aiLimiter = createAsyncLimiter(6);

async function runWithAiLimit<T>(task: () => Promise<T>): Promise<T> {
  const concurrency = await resolveEnrichmentAiConcurrency();
  if (concurrency !== aiLimiterConcurrency) {
    aiLimiterConcurrency = concurrency;
    aiLimiter = createAsyncLimiter(concurrency);
  }
  return aiLimiter(task);
}

async function enrichmentAiSignal(signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(await resolveEnrichmentAiTimeoutMs());
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

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

const EXTRACTION_SYSTEM_PROMPT = `You extract structured product data from web page content for construction / MEP materials (Vietnamese market).
Rules:
- Return JSON only. No markdown fences or commentary.
- Use only facts explicitly present in the provided sources.
- Never invent values. If uncertain, set value to null and confidence to 0.
- Goal: fill as many fields as the evidence supports — extract every field you can find for THIS product.
- Match the product to the row context (name, code, manufacturer). Ignore specs for a different SKU/variant.
- Each non-null field must include at least one evidence item with field, value, sourceUrl, snippet copied from the sources.
- confidence is 0..1 reflecting how directly the source supports the value.
- For "price": extract the unit selling price as a plain number string with NO currency symbol or thousands separators (e.g. "1250000", not "1.250.000₫"). Prefer the listed/selling price for a single unit. If only a price range or unclear price appears, set value to null.
- For "code": extract the manufacturer part number / model / SKU code for the product (e.g. "CV-2x2.5", "NF125-SGV", "PVC-D90"). Set value to null if no clear product code appears.
- For "specText": compile ALL technical specifications into a detailed multi-line block (Thông số kỹ thuật).
  * One attribute per line as "Label: value" (keep Vietnamese labels when the source is Vietnamese).
  * Include every measurable attribute found: dimensions (DxRxD, Ø, W×H×L), diameter, thickness, weight, voltage, current, pressure, material, color/finish, standard (TCVN/IEC/ISO), packaging, origin, warranty, application, etc.
  * Merge rows from spec tables and definition lists — do NOT collapse into one short phrase.
  * When the source has a spec table with 5+ rows, specText should have at least 5 lines.
  * Preserve units and numeric values exactly as written in the source.
- For "category": use the product type / ngành hàng (e.g. "Ống PVC", "Cáp điện", "Van cửa").
- For "manufacturer" and "originCountry": prefer official brand / country from spec tables or product header.
- For "unit": use the selling unit (m, cái, kg, bộ, cuộn, tấm, …) when listed.
- catalogPdfUrls may only include PDF URLs present in the sources.

JSON shape:
{
  "fields": {
    "code": { "value": string|null, "confidence": number, "evidence": [{ "field": string, "value": string, "sourceUrl": string, "snippet": string }] },
    "category": { "value": string|null, "confidence": number, "evidence": [{ "field": string, "value": string, "sourceUrl": string, "snippet": string }] },
    "specText": { ... },
    "manufacturer": { ... },
    "originCountry": { ... },
    "unit": { ... },
    "price": { ... },
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
    input.code ? `code: ${input.code}` : null,
    input.manufacturer ? `manufacturer: ${input.manufacturer}` : null,
    input.category ? `category: ${input.category}` : null,
    input.specText ? `specText: ${input.specText}` : null,
    input.sku ? `sku: ${input.sku}` : null,
    input.model ? `model: ${input.model}` : null,
    input.defaultUnitPrice != null
      ? `currentPrice: ${input.defaultUnitPrice} ${input.currency}`
      : null,
    "",
    "Source content (search hits and/or fetched page text):",
  ]
    .filter(Boolean)
    .join("\n");

  const snippets = candidates
    .slice(0, 12)
    .map((candidate, index) => {
      const content = candidate.snippet.trim();
      const truncated =
        content.length > 10_000
          ? `${content.slice(0, 10_000)}\n…[truncated]`
          : content;
      return `[${index + 1}] title: ${candidate.title}\nurl: ${candidate.url}\ndomain: ${candidate.domain}\ncontent:\n${truncated}`;
    })
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
  const normalizedValue = rawValue == null ? null : asString(rawValue) || null;
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

function _parseExtractionResponse(content: string): ExtractedProductFields {
  const parsed = JSON.parse(extractJsonObject(content)) as Record<
    string,
    unknown
  >;
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

async function _extractProductFromSources(
  input: MaterialEnrichmentInput,
  candidates: WebSearchResult[],
  provider: ResolvedAiProvider,
  signal?: AbortSignal,
): Promise<ExtractedProductFields> {
  if (candidates.length === 0) {
    return { catalogPdfUrls: [] };
  }

  const completion = await runWithAiLimit(async () => {
    const requestSignal = await enrichmentAiSignal(signal);
    return callAiProvider(
      provider,
      [
        { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
        { role: "user", content: buildExtractionUserPrompt(input, candidates) },
      ],
      { signal: requestSignal, responseFormat: "json_object" },
    );
  });

  return parseExtractionResponse(completion.content);
}

export const parseExtractionResponse = traceFn(
  log,
  "parseExtractionResponse",
  _parseExtractionResponse,
);
export const extractProductFromSources = traceFn(
  log,
  "extractProductFromSources",
  _extractProductFromSources,
);
