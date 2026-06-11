import { z } from "zod";

export const releaseChannelSchema = z.enum(["stable"]);
export type ReleaseChannel = z.infer<typeof releaseChannelSchema>;

export const deploymentSurfaceSchema = z.enum([
  "web",
  "onprem",
  "desktop-bundled",
]);
export type DeploymentSurface = z.infer<typeof deploymentSurfaceSchema>;

export const webArtifactSchema = z.object({
  buildId: z.string().min(1),
  deploymentUrl: z.string().url(),
  buildMetadata: z.string().min(1),
});

export const onpremArtifactSchema = z.object({
  image: z.string().min(1),
  digest: z.string().min(1),
  buildMetadata: z.string().min(1),
});

export const desktopPlatformArtifactSchema = z.object({
  url: z.string().url(),
  version: z.string().min(1),
});

export const releaseManifestSchema = z.object({
  version: z.string().min(1),
  releasedAt: z.string().datetime(),
  channel: releaseChannelSchema,
  schemaVersion: z.number().int().nonnegative(),
  changelog: z.string(),
  artifacts: z.object({
    web: webArtifactSchema,
    onprem: onpremArtifactSchema,
    desktop: z.object({
      win: desktopPlatformArtifactSchema.optional(),
      linux: desktopPlatformArtifactSchema.optional(),
    }),
  }),
  migrations: z.object({
    forwardOnly: z.literal(true),
    notes: z.string(),
  }),
});

export type ReleaseManifest = z.infer<typeof releaseManifestSchema>;

export const releasePinEntrySchema = z.object({
  releasedAt: z.string().datetime(),
  manifestUrl: z.string().url(),
  web: webArtifactSchema,
  onprem: onpremArtifactSchema,
  desktop: z.object({
    win: desktopPlatformArtifactSchema.optional(),
    linux: desktopPlatformArtifactSchema.optional(),
  }),
});

export type ReleasePinEntry = z.infer<typeof releasePinEntrySchema>;

export const releasePinsSchema = z.object({
  current: z.string().min(1),
  releases: z.record(releasePinEntrySchema),
});

export type ReleasePins = z.infer<typeof releasePinsSchema>;

export function parseReleaseManifest(input: unknown): ReleaseManifest {
  return releaseManifestSchema.parse(input);
}

export function parseReleasePins(input: unknown): ReleasePins {
  return releasePinsSchema.parse(input);
}

export function parseSemverCore(version: string): [number, number, number] {
  const core = version.trim().replace(/^v/i, "").split("+")[0]!.split("-")[0]!;
  const parts = core.split(".");
  const major = Number(parts[0]);
  const minor = Number(parts[1]);
  const patch = Number(parts[2]);
  if (
    !Number.isInteger(major) ||
    !Number.isInteger(minor) ||
    !Number.isInteger(patch)
  ) {
    throw new Error(`Invalid semver '${version}'.`);
  }
  return [major, minor, patch];
}

export function compareSemver(a: string, b: string): number {
  const left = parseSemverCore(a);
  const right = parseSemverCore(b);
  for (let index = 0; index < 3; index += 1) {
    if (left[index]! < right[index]!) {
      return -1;
    }
    if (left[index]! > right[index]!) {
      return 1;
    }
  }
  return 0;
}

export function isUpdateAvailable(current: string, latest: string): boolean {
  return compareSemver(current, latest) < 0;
}

export function getSchemaVersionFromJournal(journal: {
  entries: Array<{ idx: number }>;
}): number {
  const lastEntry = journal.entries.at(-1);
  return lastEntry?.idx ?? 0;
}

export function buildOnPremUpdateCommand(version: string): string {
  return `BIDTOOL_IMAGE_TAG=${version} bun run onprem:update`;
}

export function buildDesktopBuildMetadata(
  version: string,
  platform: "win" | "linux",
  commitSha: string,
): string {
  const shortSha = commitSha.slice(0, 7);
  return `${version}+desktop.${platform}.${shortSha}`;
}

export function buildWebBuildMetadata(
  version: string,
  commitSha: string,
): string {
  const shortSha = commitSha.slice(0, 7);
  return `${version}+web.${shortSha}`;
}

export function buildOnPremBuildMetadata(
  version: string,
  commitSha: string,
): string {
  const shortSha = commitSha.slice(0, 7);
  return `${version}+onprem.${shortSha}`;
}
