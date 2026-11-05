import type { LookupAddress } from "node:dns";
import { expect, test, vi } from "vitest";
import { createHttpFixture, createResolverFixture } from "./http";

const dns = vi.hoisted(() => ({
  lookup: vi.fn<(hostname: string) => Promise<LookupAddress[]>>(),
}));
vi.mock("node:dns/promises", () => ({ lookup: dns.lookup }));
import { assertSafeScrapeUrl } from "~/server/services/shop-material-scraper/url-safety";

test("HTTP safety uses controlled DNS without querying a network resolver", async () => {
  const resolver = createResolverFixture({
    "public.fixture.invalid": [{ address: "93.184.216.34", family: 4 }],
    "private.fixture.invalid": [{ address: "10.0.0.1", family: 4 }],
  });
  dns.lookup.mockImplementation(resolver.lookup);
  await expect(
    assertSafeScrapeUrl("https://public.fixture.invalid/item"),
  ).resolves.toBeInstanceOf(URL);
  await expect(
    assertSafeScrapeUrl("https://private.fixture.invalid/item"),
  ).rejects.toThrow("nội bộ");
  expect(resolver.queries).toEqual([
    "public.fixture.invalid",
    "private.fixture.invalid",
  ]);
});

test("a real stream delivers an initial chunk before the caller releases the rest", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fixture = await createHttpFixture((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.write("first");
    void gate.then(() => response.end("second"));
  });
  try {
    const response = await fetch(fixture.origin);
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("first");
    release();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(
      "second",
    );
    expect((await reader.read()).done).toBe(true);
  } finally {
    release();
    await fixture.cleanup();
  }
});

test("aborting a stalled response closes the real socket", async () => {
  let closed!: () => void;
  const closeGate = new Promise<void>((resolve) => {
    closed = resolve;
  });
  const fixture = await createHttpFixture((_request, response) => {
    response.on("close", closed);
    response.writeHead(200);
    response.write("first");
  });
  try {
    const controller = new AbortController();
    const response = await fetch(fixture.origin, { signal: controller.signal });
    const reader = response.body!.getReader();
    await reader.read();
    const pending = reader.read();
    controller.abort();
    await expect(pending).rejects.toThrow();
    await closeGate;
  } finally {
    await fixture.cleanup();
  }
});
