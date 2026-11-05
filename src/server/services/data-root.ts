import "server-only";

import path from "node:path";

/** Directory overrides keep their existing cwd-relative semantics. */
export function resolveDataRoot() {
  const configured = process.env.BIDTOOL_DATA_DIR?.trim();
  return path.resolve(
    configured && configured.length > 0 ? configured : "data",
  );
}

export function resolveStorageDirectory(
  subdirectory: "catalog-pdfs" | "excel-research" | "material-profiles",
  configured?: string | null,
) {
  return configured?.trim()
    ? path.resolve(configured.trim())
    : path.join(resolveDataRoot(), subdirectory);
}

/** Older workspaces stored an absolute path inside the bundled server. */
export function relocatedProfileWorkbook(filePath: string, root: string) {
  const normalized = filePath.replaceAll("\\", "/");
  const marker = "/data/material-profiles/";
  const index = normalized.lastIndexOf(marker);
  if (index < 0) return null;
  const relative = normalized.slice(index + marker.length);
  const candidate = path.resolve(root, relative);
  return candidate.startsWith(path.resolve(root) + path.sep) ? candidate : null;
}
