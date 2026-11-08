import { describe, expect, it } from "vitest";
import { resolveSafeScrapeUrl } from "./shop-material-scraper/url-safety";

describe("shop same-host policy", () => {
  it.each(["[2606:4700:4700::1111]", "2606:4700:4700::1111"])(
    "accepts the same public IPv6 host with expected hostname %s",
    async (expectedHostname) => {
      const result = await resolveSafeScrapeUrl(
        "https://[2606:4700:4700::1111]/page/2",
        expectedHostname,
      );
      expect(result.url.hostname).toBe("[2606:4700:4700::1111]");
      expect(result.destination.address).toBe("2606:4700:4700::1111");
    },
  );

  it("rejects another public IPv6 host", async () => {
    await expect(
      resolveSafeScrapeUrl(
        "https://[2606:4700:4700::1001]/",
        "[2606:4700:4700::1111]",
      ),
    ).rejects.toThrow("cùng domain");
  });

  it.each(["[::1]", "[fc00::1]", "[::ffff:127.0.0.1]"])(
    "still refuses private IPv6 host %s",
    async (hostname) => {
      await expect(
        resolveSafeScrapeUrl(
          `https://${hostname}/`,
          new URL(`https://${hostname}`).hostname,
        ),
      ).rejects.toThrow("URL nội bộ");
    },
  );
});
