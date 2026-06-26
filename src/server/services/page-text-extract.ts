import "server-only";

const SPEC_SECTION_RE =
  /thông\s*số|đặc\s*tính|specification|technical\s*data|datasheet|catalogue|catalog|kích\s*thước|thông\s*tin\s*(?:kỹ\s*thuật|sản\s*phẩm)|product\s*detail|mô\s*tả\s*chi\s*tiết/i;

const DEFAULT_MAX_CHARS = 12_000;

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripHtmlTags(value: string) {
  return decodeHtmlEntities(
    value
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|li|tr|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim(),
  );
}

function removeNoiseHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ");
}

function extractMetaDescription(html: string): string | null {
  const metaPattern =
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i;
  const altPattern =
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i;
  const match = metaPattern.exec(html) ?? altPattern.exec(html);
  const text = stripHtmlTags(match?.[1] ?? "");
  return text.length > 20 ? text : null;
}

function extractTableRows(html: string): string[] {
  const rows: string[] = [];
  const trPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch: RegExpExecArray | null;
  while ((trMatch = trPattern.exec(html)) !== null) {
    const cells: string[] = [];
    const cellPattern = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellPattern.exec(trMatch[1]!)) !== null) {
      const text = stripHtmlTags(cellMatch[1]!);
      if (text) cells.push(text);
    }
    if (cells.length === 2) {
      rows.push(`${cells[0]}: ${cells[1]}`);
    } else if (cells.length > 2) {
      rows.push(cells.join(" | "));
    } else if (cells.length === 1 && cells[0]!.length > 3) {
      rows.push(cells[0]!);
    }
  }
  return rows;
}

function extractDefinitionLists(html: string): string[] {
  const pairs: string[] = [];
  const dlPattern = /<dl[^>]*>([\s\S]*?)<\/dl>/gi;
  let dlMatch: RegExpExecArray | null;
  while ((dlMatch = dlPattern.exec(html)) !== null) {
    const block = dlMatch[1]!;
    const dtPattern = /<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi;
    let pairMatch: RegExpExecArray | null;
    while ((pairMatch = dtPattern.exec(block)) !== null) {
      const label = stripHtmlTags(pairMatch[1]!);
      const value = stripHtmlTags(pairMatch[2]!);
      if (label && value) {
        pairs.push(`${label}: ${value}`);
      }
    }
  }
  return pairs;
}

function extractLabeledListItems(html: string): string[] {
  const items: string[] = [];
  const liPattern = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let liMatch: RegExpExecArray | null;
  while ((liMatch = liPattern.exec(html)) !== null) {
    const text = stripHtmlTags(liMatch[1]!);
    if (/[:：]/.test(text) && text.length >= 8 && text.length <= 240) {
      items.push(text);
    }
  }
  return items;
}

function extractSpecSections(html: string): string[] {
  const cleaned = removeNoiseHtml(html);
  const chunks: string[] = [];
  const sectionPattern =
    /<(?:section|div|article)[^>]*>([\s\S]{0,4000}?)<\/(?:section|div|article)>/gi;
  let sectionMatch: RegExpExecArray | null;
  while ((sectionMatch = sectionPattern.exec(cleaned)) !== null) {
    const raw = sectionMatch[0] ?? "";
    if (!SPEC_SECTION_RE.test(raw)) continue;
    const text = stripHtmlTags(sectionMatch[1]!);
    if (text.length >= 40) {
      chunks.push(text);
    }
  }
  return chunks;
}

function joinUniqueLines(parts: string[], maxChars: number): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  let length = 0;

  for (const part of parts) {
    for (const line of part.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.length < 2) continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const nextLength = length + trimmed.length + 1;
      if (nextLength > maxChars) {
        return lines.join("\n");
      }
      lines.push(trimmed);
      length = nextLength;
    }
  }

  return lines.join("\n");
}

/** Extract readable, spec-rich text from HTML for AI enrichment. */
export function extractEnrichmentPageText(
  html: string,
  maxChars = DEFAULT_MAX_CHARS,
): string {
  if (!html.trim()) return "";

  const cleaned = removeNoiseHtml(html);
  const parts: string[] = [];

  const meta = extractMetaDescription(html);
  if (meta) {
    parts.push(`Mô tả: ${meta}`);
  }

  const tableRows = extractTableRows(cleaned);
  if (tableRows.length > 0) {
    parts.push(["=== Bảng thông số ===", ...tableRows].join("\n"));
  }

  const dlPairs = extractDefinitionLists(cleaned);
  if (dlPairs.length > 0) {
    parts.push(["=== Thông số chi tiết ===", ...dlPairs].join("\n"));
  }

  const listItems = extractLabeledListItems(cleaned);
  if (listItems.length > 0) {
    parts.push(["=== Danh sách thông số ===", ...listItems].join("\n"));
  }

  const specSections = extractSpecSections(cleaned);
  if (specSections.length > 0) {
    parts.push(["=== Mục thông số kỹ thuật ===", ...specSections].join("\n\n"));
  }

  const bodyText = stripHtmlTags(cleaned);
  if (bodyText.length > 0) {
    parts.push(bodyText);
  }

  return joinUniqueLines(parts, maxChars);
}
