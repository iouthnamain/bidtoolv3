import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getSchedulerState,
  markSchedulerPollFailed,
  markSchedulerPollSucceeded,
  resetSchedulerStateForTests,
  schedulerActiveRuns,
  setSchedulerState,
} from "./scheduler-state";

describe("scheduler readiness state", () => {
  afterEach(() => resetSchedulerStateForTests());

  it("records recovery, retry, and the last successful poll without starting work on import", () => {
    expect(getSchedulerState()).toMatchObject({
      state: "disabled",
      lastSuccessfulPollAt: null,
    });
    setSchedulerState("recovering");
    markSchedulerPollFailed(new Error("database unavailable"));
    expect(getSchedulerState()).toMatchObject({
      state: "recovering",
      lastError: "database unavailable",
    });
    setSchedulerState("retrying");
    markSchedulerPollSucceeded("2026-11-05T12:00:00.000Z");
    expect(getSchedulerState()).toEqual({
      state: "ready",
      lastSuccessfulPollAt: "2026-11-05T12:00:00.000Z",
      lastError: null,
    });
  });

  it("shares readiness across separately loaded server entry points", async () => {
    markSchedulerPollSucceeded("2026-11-05T12:00:00.000Z");
    vi.resetModules();

    const routeEntry = await import("./scheduler-state");

    expect(routeEntry.getSchedulerState()).toMatchObject({ state: "ready" });
  });

  it("lets an API entry cancel a job started by instrumentation", async () => {
    const controller = new AbortController();
    schedulerActiveRuns.scrape.set("scrape-fixture", controller);
    try {
      vi.resetModules();
      const { abortShopScrapeJob } = await import("./job-scheduler");
      abortShopScrapeJob("scrape-fixture");
      expect(controller.signal.aborted).toBe(true);
    } finally {
      schedulerActiveRuns.scrape.delete("scrape-fixture");
    }
  });
});
