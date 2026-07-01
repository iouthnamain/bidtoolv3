export const DEFAULT_SEARCH_BOOST_DOMAINS = [
  "binhminhplastic.com.vn",
  "hoaphat.com.vn",
  "cadivi-vn.com",
  "viglacera.vn",
  "thibidi.com",
];

export const DEFAULT_SEARCH_PENALTY_DOMAINS = [
  "shopee.vn",
  "lazada.vn",
  "tiki.vn",
  "sendo.vn",
];

export const DEFAULT_SEARXNG_ENGINES = ["google", "bing", "duckduckgo"];

function normalizeHostname(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;

  const withoutScheme = trimmed.includes("://")
    ? trimmed
    : `https://${trimmed}`;

  try {
    const parsed = new URL(withoutScheme);
    const hostname = parsed.hostname.replace(/^www\./, "");
    if (!hostname?.includes(".")) return null;
    return hostname;
  } catch {
    const cleaned = trimmed
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split(/[/?#]/)[0]
      ?.trim();
    if (!cleaned?.includes(".")) return null;
    if (!/^[a-z0-9.-]+$/i.test(cleaned)) return null;
    return cleaned.toLowerCase();
  }
}

export function normalizeDomainList(value: string | string[]): string[] {
  const parts = Array.isArray(value)
    ? value
    : value.split(/[\n,]+/).map((part) => part.trim());
  const seen = new Set<string>();
  const domains: string[] = [];

  for (const part of parts) {
    const domain = normalizeHostname(part);
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    domains.push(domain);
    if (domains.length >= 500) break;
  }

  return domains;
}

export function normalizeEngineList(value: string | string[]): string[] {
  const parts = Array.isArray(value)
    ? value
    : value.split(/[\n,]+/).map((part) => part.trim());
  const seen = new Set<string>();
  const engines: string[] = [];

  for (const part of parts) {
    const engine = part.trim().toLowerCase();
    if (!engine || !/^[a-z0-9_-]+$/.test(engine) || seen.has(engine)) {
      continue;
    }
    seen.add(engine);
    engines.push(engine);
    if (engines.length >= 20) break;
  }

  return engines;
}

export function domainMatches(domain: string, candidate: string): boolean {
  const normalizedDomain = domain.toLowerCase().replace(/^www\./, "");
  const normalizedCandidate = candidate.toLowerCase().replace(/^www\./, "");
  return (
    normalizedDomain === normalizedCandidate ||
    normalizedDomain.endsWith(`.${normalizedCandidate}`)
  );
}

export function domainMatchesAny(
  domain: string,
  candidates: string[],
): boolean {
  return candidates.some((candidate) => domainMatches(domain, candidate));
}
