import { describe, expect, it } from "vitest";

import {
  buildOnPremUpdateCommand,
  bumpSemverCore,
  compareSemver,
  formatReleaseTag,
  getSchemaVersionFromJournal,
  isUpdateAvailable,
  parseReleaseManifest,
  parseReleasePins,
  pickLatestSemver,
} from "./release-manifest";

describe("release manifest", () => {
  it("parses a valid manifest", () => {
    const manifest = parseReleaseManifest({
      version: "0.2.0",
      releasedAt: "2026-06-11T12:00:00.000Z",
      channel: "stable",
      schemaVersion: 14,
      changelog: "Test release",
      artifacts: {
        web: {
          buildId: "dpl_123",
          deploymentUrl: "https://bidtoolv3.vercel.app",
          buildMetadata: "0.2.0+web.abc1234",
        },
        onprem: {
          image: "ghcr.io/iouthnamain/bidtoolv3:0.2.0",
          digest: "sha256:deadbeef",
          buildMetadata: "0.2.0+onprem.abc1234",
        },
        desktop: {
          win: {
            url: "https://example.com/app.exe",
            version: "0.2.0+desktop.win.abc1234",
          },
        },
      },
      migrations: {
        forwardOnly: true,
        notes: "Forward only",
      },
    });

    expect(manifest.version).toBe("0.2.0");
    expect(manifest.artifacts.web.buildMetadata).toContain("+web.");
  });

  it("compares semver versions without build metadata", () => {
    expect(compareSemver("0.1.0", "0.2.0")).toBeLessThan(0);
    expect(compareSemver("0.2.0", "0.2.0")).toBe(0);
    expect(isUpdateAvailable("0.1.0", "0.2.0")).toBe(true);
    expect(isUpdateAvailable("0.2.0", "0.2.0")).toBe(false);
  });

  it("derives schema version from drizzle journal", () => {
    expect(
      getSchemaVersionFromJournal({
        entries: [{ idx: 0 }, { idx: 14 }],
      }),
    ).toBe(14);
  });

  it("bumps semver cores incrementally", () => {
    expect(bumpSemverCore("0.1.0", "patch")).toBe("0.1.1");
    expect(bumpSemverCore("0.1.9", "minor")).toBe("0.2.0");
    expect(bumpSemverCore("1.4.2", "major")).toBe("2.0.0");
    expect(formatReleaseTag("0.2.0")).toBe("v0.2.0");
    expect(pickLatestSemver(["0.1.0", "0.2.0", "0.1.5"])).toBe("0.2.0");
  });

  it("updates and reads release pins", () => {
    const pins = parseReleasePins({
      current: "0.2.0",
      releases: {
        "0.2.0": {
          releasedAt: "2026-06-11T12:00:00.000Z",
          manifestUrl: "https://example.com/manifest.json",
          web: {
            buildId: "dpl_123",
            deploymentUrl: "https://bidtoolv3.vercel.app",
            buildMetadata: "0.2.0+web.abc1234",
          },
          onprem: {
            image: "ghcr.io/iouthnamain/bidtoolv3:0.2.0",
            digest: "sha256:deadbeef",
            buildMetadata: "0.2.0+onprem.abc1234",
          },
          desktop: {},
        },
      },
    });

    expect(pins.current).toBe("0.2.0");
    expect(buildOnPremUpdateCommand("0.2.0")).toBe(
      "BIDTOOL_IMAGE_TAG=0.2.0 bun run onprem:update",
    );
  });
});
