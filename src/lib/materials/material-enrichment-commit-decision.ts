import {
  ENRICHABLE_FIELDS,
  type EnrichableField,
  type MaterialEnrichmentResult,
} from "~/lib/materials/material-enrichment-types";

/**
 * Resolve, per field, the proposed value to commit for a material-enrichment
 * item — honoring the review dialog's decision stored on `resultJson`:
 *
 *  - `accepted_fields` present → only those fields are eligible; others yield
 *    `undefined` (skip). Absent (auto-commit path) → every field is eligible.
 *  - `edited_fields[field]` (a non-blank inline edit) overrides the extracted
 *    value; otherwise the extracted `matchedOption ?? value` is used.
 *
 * This is the pure core of the commit field loop, extracted so it can be unit
 * tested without mocking the Drizzle transaction. Lock/parse/diff logic stays
 * in the commit service around this.
 */
export function resolveEnrichmentFieldProposal(
  result: Pick<MaterialEnrichmentResult, "fields" | "accepted_fields" | "edited_fields">,
  field: EnrichableField,
): string | null | undefined {
  const accepted = result.accepted_fields;
  if (accepted && !accepted.includes(field)) {
    return undefined;
  }
  const extracted = result.fields[field];
  const edited = result.edited_fields?.[field]?.trim();
  if (edited != null && edited.length > 0) {
    return edited;
  }
  return extracted?.matchedOption ?? extracted?.value ?? null;
}

/** Convenience: the eligible fields for a decision, in canonical order. */
export function acceptedEnrichmentFields(
  result: Pick<MaterialEnrichmentResult, "accepted_fields">,
): EnrichableField[] {
  const accepted = result.accepted_fields;
  return ENRICHABLE_FIELDS.filter((f) => !accepted || accepted.includes(f));
}
