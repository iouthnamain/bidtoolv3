#!/usr/bin/env bun
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const SERVER_ROOT = path.resolve(import.meta.dir, "../src/server");
const SKIP_FILES = new Set(["app-settings.ts", "shop-job-errors.ts"]);

async function collectTsFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTsFiles(fullPath)));
      continue;
    }
    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) {
      continue;
    }
    if (entry.name === "types.ts") {
      continue;
    }
    files.push(fullPath);
  }
  return files;
}

function serviceName(filePath: string) {
  const rel = path.relative(SERVER_ROOT, filePath).replace(/\.ts$/, "");
  return rel.replace(/[\\/]/g, "-");
}

function ensureTraceImports(content: string, filePath: string) {
  const name = serviceName(filePath);
  const hasLoggerImport = content.includes("~/server/lib/logger");

  if (!hasLoggerImport) {
    const importMatches = [...content.matchAll(/^import .+;$/gm)];
    const lastImport = importMatches.at(-1);
    const injection =
      `\nimport { createLogger, traceFn } from "~/server/lib/logger";\nconst log = createLogger("${name}");`;
    if (!lastImport) {
      return injection.trimStart() + "\n\n" + content;
    }
    const insertAt = lastImport.index + lastImport[0].length;
    return content.slice(0, insertAt) + injection + content.slice(insertAt);
  }

  if (!content.includes("traceFn")) {
    content = content.replace(
      /import \{([^}]*)\} from "~\/server\/lib\/logger";/,
      (_match, imports: string) => {
        const parts = imports
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean);
        if (!parts.includes("traceFn")) {
          parts.push("traceFn");
        }
        return `import { ${parts.join(", ")} } from "~/server/lib/logger";`;
      },
    );
  }

  if (!content.includes("const log = createLogger")) {
    const importMatches = [...content.matchAll(/^import .+;$/gm)];
    const lastImport = importMatches.at(-1);
    if (lastImport?.index !== undefined) {
      const insertAt = lastImport.index + lastImport[0].length;
      content =
        content.slice(0, insertAt) +
        `\nconst log = createLogger("${name}");` +
        content.slice(insertAt);
    }
  }

  return content;
}

async function processFile(filePath: string) {
  const base = path.basename(filePath);
  if (SKIP_FILES.has(base)) {
    return { filePath, status: "skipped" as const };
  }

  let content = await readFile(filePath, "utf8");
  if (content.includes("= traceFn(log")) {
    return { filePath, status: "already-wrapped" as const };
  }

  const names: string[] = [];
  for (const match of content.matchAll(/^export (async )?function (\w+)/gm)) {
    names.push(match[2]!);
  }

  if (names.length === 0) {
    return { filePath, status: "no-exports" as const };
  }

  for (const name of names) {
    content = content.replace(
      `export async function ${name}`,
      `async function _${name}`,
    );
    content = content.replace(
      `export function ${name}`,
      `function _${name}`,
    );
  }

  content = ensureTraceImports(content, filePath);

  const wrappers = names
    .map(
      (name) =>
        `export const ${name} = traceFn(log, "${name}", _${name});`,
    )
    .join("\n");
  content = `${content.trimEnd()}\n\n${wrappers}\n`;

  await writeFile(filePath, content);
  return { filePath, status: "wrapped" as const, count: names.length };
}

async function main() {
  const serviceFiles = await collectTsFiles(path.join(SERVER_ROOT, "services"));
  const tenantScopePath = path.join(SERVER_ROOT, "api/tenant-scope.ts");
  const results = [];

  for (const file of serviceFiles) {
    results.push(await processFile(file));
  }
  results.push(await processFile(tenantScopePath));

  for (const result of results) {
    const rel = path.relative(SERVER_ROOT, result.filePath);
    const count = "count" in result ? ` (${result.count})` : "";
    console.log(`${result.status}\t${rel}${count}`);
  }
}

void main();
