import { chromium } from "playwright";
import { afterEach, describe, expect, it } from "vitest";
import { resolvePublicUrl } from "./public-content-client";
import { launchManagedChromium } from "./playwright-chromium-launch";

let browser: Awaited<ReturnType<typeof launchManagedChromium>> | undefined;
afterEach(async () => {
  await browser?.close();
  browser = undefined;
});

const runLiveTest = process.env.BIDTOOL_RUN_LIVE_HTTP_TESTS === "1";

describe.skipIf(!runLiveTest)("live Chromium TLS acceptance", () => {
  it("reaches public HTTPS with the validated address pin", async () => {
    const resolution = await resolvePublicUrl("https://example.com/");
    browser = await launchManagedChromium(chromium.executablePath(), {
      hostname: resolution.url.hostname,
      address: resolution.destination.address,
    });
    const page = await browser.newPage();
    const response = await page.goto(resolution.url.href, {
      waitUntil: "domcontentloaded",
      timeout: 15_000,
    });
    expect(response?.status()).toBe(200);
    expect(await page.locator("body").innerText()).toContain(
      "documentation examples",
    );
  }, 20_000);
});
