export type OptionMatchResult = {
  option: string;
  score: number;
} | null;

export type NormalizeStringOptions = {
  stripDiacritics?: boolean;
};

function stripVietnameseDiacritics(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

/** Lowercase, trim, collapse whitespace, optionally strip punctuation and VN diacritics. */
export function normalizeOptionString(
  value: string,
  options: NormalizeStringOptions = {},
): string {
  let normalized = value.trim().toLowerCase().replace(/\s+/g, " ");
  normalized = normalized.replace(/[^\p{L}\p{N}\s]/gu, " ");
  normalized = normalized.replace(/\s+/g, " ").trim();
  if (options.stripDiacritics) {
    normalized = stripVietnameseDiacritics(normalized);
  }
  return normalized;
}

function trigrams(value: string): Set<string> {
  const padded = `  ${value.replace(/\s+/g, " ").trim()} `;
  const set = new Set<string>();
  for (let index = 0; index < padded.length - 2; index += 1) {
    set.add(padded.slice(index, index + 3));
  }
  return set;
}

/** Jaccard similarity over character trigrams of normalized strings. */
export function simpleSimilarity(a: string, b: string): number {
  const left = normalizeOptionString(a, { stripDiacritics: true });
  const right = normalizeOptionString(b, { stripDiacritics: true });
  if (!left || !right) {
    return 0;
  }
  if (left === right) {
    return 1;
  }

  const leftTrigrams = trigrams(left);
  const rightTrigrams = trigrams(right);
  if (leftTrigrams.size === 0 || rightTrigrams.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const gram of leftTrigrams) {
    if (rightTrigrams.has(gram)) {
      intersection += 1;
    }
  }
  const union = leftTrigrams.size + rightTrigrams.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/** Return the closest catalog option above `threshold`, or null. */
export function findClosestOption(
  value: string,
  options: string[],
  threshold = 0.6,
): OptionMatchResult {
  const trimmed = value.trim();
  if (!trimmed || options.length === 0) {
    return null;
  }

  let bestOption: string | null = null;
  let bestScore = 0;

  for (const option of options) {
    const candidate = option.trim();
    if (!candidate) {
      continue;
    }
    const score = simpleSimilarity(trimmed, candidate);
    if (score > bestScore) {
      bestScore = score;
      bestOption = candidate;
    }
  }

  if (!bestOption || bestScore < threshold) {
    return null;
  }

  return { option: bestOption, score: bestScore };
}
