import { describe, expect, it } from "vitest";

import { runWithConcurrency } from "~/server/services/concurrency";

describe("runWithConcurrency", () => {
  it("processes every item exactly once", async () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ n: i }));
    const seen: number[] = [];
    await runWithConcurrency(items, 4, async (item) => {
      seen.push(item.n);
    });
    expect(seen.slice().sort((a, b) => a - b)).toEqual(items.map((i) => i.n));
  });

  it("skips falsy slots (callers pass object items, never falsy primitives)", async () => {
    const seen: Array<number | null> = [];
    await runWithConcurrency([1, 0, 2, null, 3], 2, async (item) => {
      seen.push(item);
    });
    expect(seen.slice().sort()).toEqual([1, 2, 3]);
  });

  it("never exceeds the concurrency cap in flight", async () => {
    const items = Array.from({ length: 12 }, (_, i) => i);
    let inFlight = 0;
    let maxInFlight = 0;
    await runWithConcurrency(items, 3, async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
    });
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it("caps parallelism at the item count when concurrency exceeds it", async () => {
    let maxInFlight = 0;
    let inFlight = 0;
    await runWithConcurrency([1, 2], 8, async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
    });
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it("treats concurrency < 1 as a single runner", async () => {
    const order: number[] = [];
    await runWithConcurrency([1, 2, 3], 0, async (item) => {
      order.push(item);
    });
    expect(order).toEqual([1, 2, 3]);
  });

  it("rejects when a worker throws", async () => {
    await expect(
      runWithConcurrency([1, 2, 3], 2, async (item) => {
        if (item === 2) {
          throw new Error("boom");
        }
      }),
    ).rejects.toThrow("boom");
  });

  it("does nothing for an empty list", async () => {
    let calls = 0;
    await runWithConcurrency([], 4, async () => {
      calls += 1;
    });
    expect(calls).toBe(0);
  });
});
