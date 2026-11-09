import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ launch: vi.fn() }));
vi.mock("~/server/services/playwright-chromium-launch", () => ({
  launchManagedChromium: mocks.launch,
}));
vi.mock("~/server/runtime", () => ({ isServerlessRuntime: () => false }));

import { scrapeShopMaterialsFromUrl } from "./shop-material-scraper";
import {
  acquireShopScraperBrowser,
  closeShopScraperBrowser,
} from "./shop-material-scraper/browser";

function browserFixture() {
  const context = {
    route: vi.fn().mockRejectedValue(new Error("fixture route setup failed")),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const browser = {
    newContext: vi.fn().mockResolvedValue(context),
    on: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return { browser, context };
}

beforeEach(() => mocks.launch.mockReset());
afterEach(() => closeShopScraperBrowser());

describe("scraper browser lifetime", () => {
  it("closes each browser and context when scrape setup fails across targets", async () => {
    for (const url of ["https://1.1.1.1/", "https://8.8.8.8/"]) {
      const { browser, context } = browserFixture();
      mocks.launch.mockResolvedValueOnce(browser);
      await expect(scrapeShopMaterialsFromUrl({ url })).rejects.toThrow(
        "fixture route setup failed",
      );
      expect(context.close).toHaveBeenCalledOnce();
      expect(browser.close).toHaveBeenCalledOnce();
    }
  });

  it("releases a browser even if creating its context fails", async () => {
    const { browser } = browserFixture();
    browser.newContext.mockRejectedValueOnce(
      new Error("fixture context failed"),
    );
    mocks.launch.mockResolvedValueOnce(browser);
    await expect(
      scrapeShopMaterialsFromUrl({ url: "https://1.1.1.1/" }),
    ).rejects.toThrow("fixture context failed");
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it("closes the browser after caller cancellation inside the scrape", async () => {
    const { browser, context } = browserFixture();
    context.route.mockResolvedValueOnce(undefined);
    mocks.launch.mockResolvedValueOnce(browser);
    await expect(
      scrapeShopMaterialsFromUrl({
        url: "https://1.1.1.1/",
        signal: AbortSignal.abort(),
      }),
    ).rejects.toThrow();
    expect(context.close).toHaveBeenCalledOnce();
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it("keeps a concurrent user's pin alive until the final release", async () => {
    const { browser } = browserFixture();
    mocks.launch.mockResolvedValue(browser);
    const target = { hostname: "shop.example", address: "1.1.1.1" };
    const [first, second] = await Promise.all([
      acquireShopScraperBrowser(target),
      acquireShopScraperBrowser(target),
    ]);
    expect(mocks.launch).toHaveBeenCalledOnce();
    expect(first.browser).toBe(second.browser);
    await first.release();
    await first.release();
    expect(browser.close).not.toHaveBeenCalled();
    await second.release();
    expect(browser.close).toHaveBeenCalledOnce();

    const next = await acquireShopScraperBrowser(target);
    expect(mocks.launch).toHaveBeenCalledTimes(2);
    await next.release();
  });

  it("keeps different resolved-address pins independent", async () => {
    const first = browserFixture();
    const second = browserFixture();
    mocks.launch
      .mockResolvedValueOnce(first.browser)
      .mockResolvedValueOnce(second.browser);
    const a = await acquireShopScraperBrowser({
      hostname: "shop.example",
      address: "1.1.1.1",
    });
    const b = await acquireShopScraperBrowser({
      hostname: "shop.example",
      address: "8.8.8.8",
    });
    await a.release();
    expect(first.browser.close).toHaveBeenCalledOnce();
    expect(second.browser.close).not.toHaveBeenCalled();
    await b.release();
    expect(second.browser.close).toHaveBeenCalledOnce();
  });

  it("retries after a shared launch failure", async () => {
    mocks.launch.mockRejectedValueOnce(new Error("fixture launch failed"));
    const target = { hostname: "shop.example", address: "1.1.1.1" };
    const results = await Promise.allSettled([
      acquireShopScraperBrowser(target),
      acquireShopScraperBrowser(target),
    ]);
    expect(results.map((result) => result.status)).toEqual([
      "rejected",
      "rejected",
    ]);
    expect(mocks.launch).toHaveBeenCalledOnce();
    const { browser } = browserFixture();
    mocks.launch.mockResolvedValueOnce(browser);
    const retry = await acquireShopScraperBrowser(target);
    await retry.release();
    expect(mocks.launch).toHaveBeenCalledTimes(2);
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it("does not let an old disconnected browser remove a replacement lease", async () => {
    const old = browserFixture();
    const replacement = browserFixture();
    mocks.launch
      .mockResolvedValueOnce(old.browser)
      .mockResolvedValueOnce(replacement.browser);
    const target = { hostname: "shop.example", address: "1.1.1.1" };
    const first = await acquireShopScraperBrowser(target);
    const disconnected: unknown = old.browser.on.mock.calls[0]?.[1];
    if (typeof disconnected !== "function")
      throw new Error("Missing disconnect handler");
    disconnected();
    await Promise.resolve();
    const second = await acquireShopScraperBrowser(target);
    await first.release();
    const third = await acquireShopScraperBrowser(target);
    expect(mocks.launch).toHaveBeenCalledTimes(2);
    expect(third.browser).toBe(second.browser);
    await second.release();
    expect(replacement.browser.close).not.toHaveBeenCalled();
    await third.release();
    expect(replacement.browser.close).toHaveBeenCalledOnce();
  });
});
