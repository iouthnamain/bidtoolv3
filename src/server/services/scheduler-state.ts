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

let snapshot: SchedulerStateSnapshot = {
  state: "disabled",
  lastSuccessfulPollAt: null,
  lastError: null,
};

export function getSchedulerState(): SchedulerStateSnapshot {
  return { ...snapshot };
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
  snapshot = { ...snapshot, state, ...details };
}

export function markSchedulerPollSucceeded(at = new Date().toISOString()) {
  snapshot = {
    ...snapshot,
    state: "ready",
    lastSuccessfulPollAt: at,
    lastError: null,
  };
}

export function markSchedulerPollFailed(error: unknown) {
  snapshot = {
    ...snapshot,
    lastError: error instanceof Error ? error.message : "scheduler poll failed",
  };
}

export function resetSchedulerStateForTests() {
  snapshot = {
    state: "disabled",
    lastSuccessfulPollAt: null,
    lastError: null,
  };
}
