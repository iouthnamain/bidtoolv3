import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getVersionStatus } from "./version-info";

describe("version info service", () => {
  beforeEach(() => {
    vi.stubEnv("BIDTOOL_APP_VERSION", "0.1.0");
    vi.stubEnv("BIDTOOL_BUILD_METADATA", "0.1.0+onprem.dev");
    vi.stubEnv("BIDTOOL_DEPLOYMENT_SURFACE", "onprem");
    vi.stubEnv("BIDTOOL_MANIFEST_PATH", "");
    vi.stubEnv("BIDTOOL_MANIFEST_URL", "");
    vi.stubEnv("VERCEL", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("reports update availability from pinned manifest data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url =
          input instanceof URL
            ? input.toString()
            : typeof input === "string"
              ? input
              : input.url;
        if (url.includes("pins.json")) {
          return new Response(
            JSON.stringify({
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
            }),
            { status: 200 },
          );
        }

        if (url.includes("manifest.json")) {
          return new Response(
            JSON.stringify({
              version: "0.2.0",
              releasedAt: "2026-06-11T12:00:00.000Z",
              channel: "stable",
              schemaVersion: 14,
              changelog: "New release",
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
                desktop: {},
              },
              migrations: {
                forwardOnly: true,
                notes: "Forward only",
              },
            }),
            { status: 200 },
          );
        }

        return new Response("not found", { status: 404 });
      }),
    );

    const status = await getVersionStatus();

    expect(status.current).toBe("0.1.0");
    expect(status.latest).toBe("0.2.0");
    expect(status.updateAvailable).toBe(true);
    expect(status.updateCommand).toBe(
      "BIDTOOL_IMAGE_TAG=0.2.0 bun run onprem:update",
    );
    expect(status.changelog).toBe("New release");
  });
});
