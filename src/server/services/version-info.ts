import "server-only";

import { readFile } from "node:fs/promises";

import {
  compareSemver,
  isUpdateAvailable,
  parseReleaseManifest,
  parseReleasePins,
  type DeploymentSurface,
  type ReleaseManifest,
  type ReleasePins,
} from "~/lib/release-manifest";
import { env } from "~/env";
import { canApplyInAppOnPremUpdates } from "~/server/services/onprem-update";

export type VersionStatus = {
  current: string;
  buildMetadata: string | null;
  surface: DeploymentSurface;
  latest: string | null;
  latestBuildMetadata: string | null;
  updateAvailable: boolean;
  changelog: string | null;
  updateCommand: string | null;
  canApplyInApp: boolean;
  schemaVersion: number | null;
  manifestUrl: string | null;
  checkedAt: string;
};

const MANIFEST_CACHE_MS = 10 * 60_000;
let cachedManifest: ReleaseManifest | null = null;
let cachedManifestUrl: string | null = null;
let cachedManifestFetchedAt = 0;

let cachedPins: ReleasePins | null = null;
let cachedPinsFetchedAt = 0;

function resolveSurface(): DeploymentSurface {
  const configured = process.env.BIDTOOL_DEPLOYMENT_SURFACE?.trim();
  if (
    configured === "web" ||
    configured === "onprem" ||
    configured === "desktop-bundled"
  ) {
    return configured;
  }

  if (process.env.VERCEL === "1") {
    return "web";
  }

  return "onprem";
}

function resolveCurrentVersion(): string {
  const configured = process.env.BIDTOOL_APP_VERSION?.trim();
  if (configured) {
    return configured.replace(/^v/i, "");
  }

  return env.BIDTOOL_PACKAGE_VERSION;
}

function resolveBuildMetadata(): string | null {
  const configured = process.env.BIDTOOL_BUILD_METADATA?.trim();
  return configured && configured.length > 0 ? configured : null;
}

function resolveManifestPath(): string | null {
  const configured = process.env.BIDTOOL_MANIFEST_PATH?.trim();
  return configured && configured.length > 0 ? configured : null;
}

function resolveManifestUrl(): string | null {
  const configured = process.env.BIDTOOL_MANIFEST_URL?.trim();
  if (configured && configured.length > 0) {
    return configured;
  }

  const repo = process.env.BIDTOOL_GITHUB_REPO?.trim() ?? "iouthnamain/bidtoolv3";
  const current = resolveCurrentVersion();
  return `https://github.com/${repo}/releases/download/v${current}/manifest.json`;
}

function resolvePinsUrl(): string {
  const configured = process.env.BIDTOOL_PINS_URL?.trim();
  if (configured && configured.length > 0) {
    return configured;
  }

  const repo = process.env.BIDTOOL_GITHUB_REPO?.trim() ?? "iouthnamain/bidtoolv3";
  const branch = process.env.BIDTOOL_PINS_BRANCH?.trim() ?? "main";
  return `https://raw.githubusercontent.com/${repo}/${branch}/releases/pins.json`;
}

async function loadManifestFromFilesystem(path: string): Promise<ReleaseManifest> {
  const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
  return parseReleaseManifest(raw);
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "bidtoolv3-version-service",
    },
    next: { revalidate: 600 },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  return (await response.json()) as T;
}

async function loadLatestManifest(): Promise<{
  manifest: ReleaseManifest | null;
  manifestUrl: string | null;
}> {
  const now = Date.now();
  if (
    cachedManifest &&
    cachedManifestUrl &&
    now - cachedManifestFetchedAt < MANIFEST_CACHE_MS
  ) {
    return { manifest: cachedManifest, manifestUrl: cachedManifestUrl };
  }

  const manifestPath = resolveManifestPath();
  if (manifestPath) {
    const manifest = await loadManifestFromFilesystem(manifestPath);
    cachedManifest = manifest;
    cachedManifestUrl = manifestPath;
    cachedManifestFetchedAt = now;
    return { manifest, manifestUrl: manifestPath };
  }

  try {
    if (now - cachedPinsFetchedAt >= MANIFEST_CACHE_MS || !cachedPins) {
      cachedPins = parseReleasePins(await fetchJson<unknown>(resolvePinsUrl()));
      cachedPinsFetchedAt = now;
    }

    const latestVersion = cachedPins.current;
    const pin = cachedPins.releases[latestVersion];
    if (!pin) {
      return { manifest: null, manifestUrl: null };
    }

    const manifest = parseReleaseManifest(await fetchJson<unknown>(pin.manifestUrl));
    cachedManifest = manifest;
    cachedManifestUrl = pin.manifestUrl;
    cachedManifestFetchedAt = now;
    return { manifest, manifestUrl: pin.manifestUrl };
  } catch {
    const manifestUrl = resolveManifestUrl();
    if (!manifestUrl) {
      return { manifest: null, manifestUrl: null };
    }

    try {
      const manifest = parseReleaseManifest(await fetchJson<unknown>(manifestUrl));
      cachedManifest = manifest;
      cachedManifestUrl = manifestUrl;
      cachedManifestFetchedAt = now;
      return { manifest, manifestUrl };
    } catch {
      return { manifest: null, manifestUrl };
    }
  }
}

function resolveUpdateCommand(
  surface: DeploymentSurface,
  latestVersion: string | null,
): string | null {
  if (!latestVersion || surface !== "onprem") {
    return null;
  }

  return `BIDTOOL_IMAGE_TAG=${latestVersion} bun run onprem:update`;
}

export async function getVersionStatus(): Promise<VersionStatus> {
  const current = resolveCurrentVersion();
  const buildMetadata = resolveBuildMetadata();
  const surface = resolveSurface();
  const { manifest, manifestUrl } = await loadLatestManifest();
  const latest = manifest?.version ?? null;
  const latestBuildMetadata =
    surface === "web"
      ? (manifest?.artifacts.web.buildMetadata ?? null)
      : surface === "onprem"
        ? (manifest?.artifacts.onprem.buildMetadata ?? null)
        : null;

  return {
    current,
    buildMetadata,
    surface,
    latest,
    latestBuildMetadata,
    updateAvailable: latest ? isUpdateAvailable(current, latest) : false,
    changelog: manifest?.changelog ?? null,
    updateCommand: resolveUpdateCommand(surface, latest),
    canApplyInApp: surface === "onprem" && canApplyInAppOnPremUpdates(),
    schemaVersion: manifest?.schemaVersion ?? null,
    manifestUrl,
    checkedAt: new Date().toISOString(),
  };
}

export function compareVersionStrings(left: string, right: string): number {
  return compareSemver(left, right);
}
