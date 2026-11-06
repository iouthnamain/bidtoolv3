import { afterEach, describe, expect, it } from "vitest";

import {
  getSchedulerState,
  markSchedulerPollFailed,
  markSchedulerPollSucceeded,
  resetSchedulerStateForTests,
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
});
