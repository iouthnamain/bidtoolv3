import { describe, expect, it, beforeEach } from "vitest";

import {
  __clearBidWinnerPageCache,
  fetchHtmlWithCache,
} from "./bidwinner-page-cache";

describe("fetchHtmlWithCache", () => {
  beforeEach(() => {
    __clearBidWinnerPageCache();
  });

  it("runs the fetcher on a cache miss and caches the result", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return "html-A";
    };

    const first = await fetchHtmlWithCache("key-A", fetcher);
    const second = await fetchHtmlWithCache("key-A", fetcher);

    expect(first).toBe("html-A");
    expect(second).toBe("html-A");
    expect(calls).toBe(1);
  });

  it("re-fetches after the TTL expires", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return `html-${calls}`;
    };

    // 0ms TTL means the entry is immediately stale on the next call.
    const first = await fetchHtmlWithCache("key-ttl", fetcher, 0);
    const second = await fetchHtmlWithCache("key-ttl", fetcher, 0);

    expect(first).toBe("html-1");
    expect(second).toBe("html-2");
    expect(calls).toBe(2);
  });

  it("dedupes concurrent in-flight fetches for the same key", async () => {
    let calls = 0;
    let resolveFetch: ((value: string) => void) | undefined;
    const fetcher = () => {
      calls += 1;
      return new Promise<string>((resolve) => {
        resolveFetch = resolve;
      });
    };

    const a = fetchHtmlWithCache("key-race", fetcher);
    const b = fetchHtmlWithCache("key-race", fetcher);

    resolveFetch?.("shared");

    expect(await a).toBe("shared");
    expect(await b).toBe("shared");
    expect(calls).toBe(1);
  });

  it("does not cache a rejected fetch", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("boom");
      }
      return "recovered";
    };

    await expect(fetchHtmlWithCache("key-err", fetcher)).rejects.toThrow(
      "boom",
    );
    const second = await fetchHtmlWithCache("key-err", fetcher);

    expect(second).toBe("recovered");
    expect(calls).toBe(2);
  });
});
