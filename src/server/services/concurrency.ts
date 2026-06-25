import "server-only";
import { createLogger, traceFn } from "~/server/lib/logger";
const log = createLogger("services-concurrency");

/**
 * Runs `worker` over `items` with at most `concurrency` tasks in flight at a
 * time. Effective parallelism is `min(concurrency, items.length)`. A worker
 * that throws rejects the whole run (callers that want per-item error handling
 * should catch inside the worker).
 */
async function _runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const runners = Array.from(
    { length: Math.min(Math.max(concurrency, 1), items.length) },
    async () => {
      while (index < items.length) {
        const current = items[index];
        index += 1;
        if (!current) {
          continue;
        }
        await worker(current);
      }
    },
  );
  await Promise.all(runners);
}

export const runWithConcurrency = traceFn(
  log,
  "runWithConcurrency",
  _runWithConcurrency,
);

type LimitState = {
  active: number;
  queue: Array<() => void>;
};

/**
 * A small in-process async limiter for external calls. It gives each caller a
 * Promise-returning wrapper while enforcing a shared cap across concurrent jobs.
 */
function _createAsyncLimiter(maxConcurrency: number) {
  const state: LimitState = {
    active: 0,
    queue: [],
  };
  const limit = Math.max(1, Math.floor(maxConcurrency));

  const release = () => {
    state.active -= 1;
    const next = state.queue.shift();
    if (next) {
      next();
    }
  };

  return async function runLimited<T>(task: () => Promise<T>): Promise<T> {
    if (state.active >= limit) {
      await new Promise<void>((resolve) => {
        state.queue.push(resolve);
      });
    }
    state.active += 1;
    try {
      return await task();
    } finally {
      release();
    }
  };
}

export const createAsyncLimiter = traceFn(
  log,
  "createAsyncLimiter",
  _createAsyncLimiter,
);
