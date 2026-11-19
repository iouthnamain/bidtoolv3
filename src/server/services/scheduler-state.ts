import "server-only";

import { isServerlessRuntime } from "~/server/runtime";

export type SchedulerStartupState =
  | "disabled"
  | "recovering"
  | "retrying"
  | "ready"
  | "stopped";

type SchedulerStateSnapshot = {
  state: SchedulerStartupState;
  lastSuccessfulPollAt: string | null;
  lastError: string | null;
};

function initialSnapshot(): SchedulerStateSnapshot {
  return { state: "disabled", lastSuccessfulPollAt: null, lastError: null };
}

function createSchedulerState() {
  return {
    snapshot: initialSnapshot(),
    runs: {
      scrape: new Map<string, AbortController>(),
      import: new Map<string, AbortController>(),
      enrichment: new Map<string, AbortController>(),
      profileSearch: new Map<string, AbortController>(),
      excelResearch: new Set<string>(),
    },
  };
}

// Next can bundle instrumentation and route handlers separately in one process.
const globalForScheduler = globalThis as typeof globalThis & {
  bidtoolSchedulerState?: ReturnType<typeof createSchedulerState>;
};
const scheduler = (globalForScheduler.bidtoolSchedulerState ??=
  createSchedulerState());
export const schedulerActiveRuns = scheduler.runs;

export function getSchedulerState(): SchedulerStateSnapshot {
  return { ...scheduler.snapshot };
}

/** Only the explicitly web/serverless surfaces opt out of the local worker. */
export function schedulerRequiredForRuntime() {
  return (
    !isServerlessRuntime() && process.env.BIDTOOL_DEPLOYMENT_SURFACE !== "web"
  );
}

export function setSchedulerState(
  state: SchedulerStartupState,
  details: Partial<Omit<SchedulerStateSnapshot, "state">> = {},
) {
  scheduler.snapshot = { ...scheduler.snapshot, state, ...details };
}

export function markSchedulerPollSucceeded(at = new Date().toISOString()) {
  scheduler.snapshot = {
    state: "ready",
    lastSuccessfulPollAt: at,
    lastError: null,
  };
}

export function markSchedulerPollFailed(error: unknown) {
  scheduler.snapshot = {
    ...scheduler.snapshot,
    lastError: error instanceof Error ? error.message : "scheduler poll failed",
  };
}

export function resetSchedulerStateForTests() {
  scheduler.snapshot = initialSnapshot();
}
