import { createServer } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import {
  closeShopScraperBrowser,
  acquireShopScraperBrowser,
} from "~/server/services/shop-material-scraper/browser";
import { buildChromiumHostResolverRule } from "~/server/services/playwright-chromium-launch";

const RUN_BROWSER_TESTS = process.env.R2_RUN_BROWSER_TESTS === "1";

describe.skipIf(!RUN_BROWSER_TESTS)("shop Chromium connection pinning", () => {
  afterEach(() => closeShopScraperBrowser());

  it("loads a real page while another lease is released, then closes on final release", async () => {
    const target = { hostname: "public.test", address: "1.1.1.1" };
    const [first, second] = await Promise.all([
      acquireShopScraperBrowser(target),
      acquireShopScraperBrowser(target),
    ]);
    expect(first.browser).toBe(second.browser);
    const page = await second.browser.newPage();
    await page.goto(
      "data:text/html,<title>Owned browser lease</title><p>loaded</p>",
    );
    await first.release();
    expect(second.browser.isConnected()).toBe(true);
    expect(await page.title()).toBe("Owned browser lease");
    expect(await page.locator("p").innerText()).toBe("loaded");
    await second.release();
    expect(second.browser.isConnected()).toBe(false);
  }, 15_000);

  it("does not send a pinned public hostname to a loopback fixture", async () => {
    const hostname = "public.test";
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("loopback-fixture");
    });
    let requestCount = 0;
    server.on("request", () => {
      requestCount += 1;
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Missing browser fixture socket.");
    }

    const lease = await acquireShopScraperBrowser({
      hostname,
      address: "1.1.1.1",
    });
    const context = await lease.browser.newContext();
    try {
      await context.route("**/*", async (route) => {
        const requestUrl = new URL(route.request().url());
        if (
          requestUrl.hostname === hostname &&
          ["http:", "https:"].includes(requestUrl.protocol)
        ) {
          await route.continue();
          return;
        }
        await route.abort();
      });

      const page = await context.newPage();
      await page
        .goto(`http://${hostname}:${address.port}/rebinding-probe`, {
          waitUntil: "domcontentloaded",
          timeout: 2_000,
        })
        .catch(() => undefined);

      expect(
        buildChromiumHostResolverRule({ hostname, address: "1.1.1.1" }),
      ).toBe("--host-resolver-rules=MAP public.test 1.1.1.1");
      expect(() =>
        buildChromiumHostResolverRule({
          hostname: "public.test",
          address: "127.0.0.1",
        }),
      ).toThrow();
      expect(() =>
        buildChromiumHostResolverRule({
          hostname: "1.1.1.1",
          address: "127.0.0.1",
        }),
      ).toThrow();
      expect(requestCount).toBe(0);
    } finally {
      await context.close();
      await lease.release();
      await closeShopScraperBrowser();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }, 15_000);
});
