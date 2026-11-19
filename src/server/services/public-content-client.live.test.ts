import { describe, expect, it } from "vitest";

import { fetchPublicContent } from "./public-content-client";

const runLiveTest = process.env.BIDTOOL_RUN_LIVE_HTTP_TESTS === "1";

describe("public content live TLS acceptance", () => {
  it.skipIf(!runLiveTest)(
    "connects to a public HTTPS host with the validated address and original TLS name",
    async () => {
      const response = await fetchPublicContent({
        url: "https://example.com/",
        kind: "text",
        timeoutMs: 15_000,
      });

      expect(response.status).toBe(200);
      expect(response.finalUrl).toMatch(/^https:\/\/example\.com\/?$/);
      expect(response.contentType).toContain("text/html");
      expect(response.body.toString("utf8")).toContain("Example Domain");
    },
    20_000,
  );
});
