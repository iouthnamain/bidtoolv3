import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "src");

function collectFiles(dir = SRC): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...collectFiles(fullPath));
      continue;
    }
    if (
      (fullPath.endsWith(".tsx") || fullPath.endsWith(".ts")) &&
      !fullPath.endsWith(".test.ts") &&
      !fullPath.endsWith(".test.tsx")
    ) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

const REPLACEMENTS: Array<[RegExp, string]> = [
  [/\banimate-rise\b/g, ""],
  [/sky-/g, "blue-"],
  [/from-\[#0e7490\]|via-\[var\(--brand-via\)\]|to-\[var\(--brand-to\)\]|from-\[var\(--brand-from\)\]/g, ""],
  [/bg-gradient-to-b from-\[var\(--brand-from\)\] via-\[var\(--brand-via\)\] to-\[var\(--brand-to\)\]/g, "bg-brand"],
  [/bg-gradient-to-r from-blue-50 to-transparent/g, "bg-blue-50"],
  [/border-slate-100\b/g, "border-slate-400"],
  [/border-slate-200\b/g, "border-slate-400"],
  [/border-slate-300\b/g, "border-slate-400"],
  [/rounded-2xl\b/g, "rounded"],
  [/rounded-xl\b/g, "rounded"],
  [/rounded-lg\b/g, "rounded"],
  [/rounded-md\b/g, "rounded"],
  [/text-\[10px\]/g, "text-xs"],
  [/text-\[11px\]/g, "text-xs"],
  [/text-slate-400\b/g, "text-slate-600"],
  [/text-slate-500\b/g, "text-slate-700"],
  [/ sm:min-h-8\b/g, ""],
  [/ sm:min-h-9\b/g, ""],
  [/ sm:min-h-10\b/g, ""],
  [/ sm:min-h-0\b/g, ""],
  [/ sm:py-1\b/g, ""],
  [/ sm:px-2\.5\b/g, ""],
  [/ sm:px-3\.5\b/g, ""],
  [/ sm:py-2\b/g, ""],
  [/ sm:text-xs\b/g, ""],
  [/ sm:text-sm\b/g, ""],
  [/ sm:p-5\b/g, ""],
  [/ sm:p-6\b/g, ""],
  [/duration-150\b/g, "duration-0"],
  [/duration-200\b/g, "duration-0"],
  [/transition-transform duration-0\b/g, ""],
  [/backdrop:backdrop-blur-sm\b/g, ""],
  [/shadow-\[0_2px_6px[^\]]+\]/g, ""],
  [/hover:shadow-\[[^\]]+\]/g, ""],
  [/ p-5\b/g, " p-2"],
  [/ p-6\b/g, " p-2"],
  [/ px-5\b/g, " px-2"],
  [/ py-5\b/g, " py-2"],
  [/ gap-3\b/g, " gap-1"],
  [/ gap-4\b/g, " gap-2"],
  [/ space-y-4\b/g, " space-y-2"],
  [/ space-y-6\b/g, " space-y-2"],
  [/ space-y-8\b/g, " space-y-2"],
  [/ pb-3\.5\b/g, " pb-2"],
  [/ mt-5\b/g, " mt-2"],
  [/ mt-4\b/g, " mt-2"],
];

function normalizeClasses(content: string): string {
  let next = content;
  for (const [pattern, replacement] of REPLACEMENTS) {
    next = next.replace(pattern, replacement);
  }
  return next;
}

let changed = 0;
for (const file of collectFiles()) {
  const original = readFileSync(file, "utf8");
  const updated = normalizeClasses(original);
  if (updated !== original) {
    writeFileSync(file, updated);
    changed += 1;
  }
}

console.log(`Theme migration updated ${changed} files.`);
