import "server-only";

/**
 * Runs `worker` over `items` with at most `concurrency` tasks in flight at a
 * time. Effective parallelism is `min(concurrency, items.length)`. A worker
 * that throws rejects the whole run (callers that want per-item error handling
 * should catch inside the worker).
 */
export async function runWithConcurrency<T>(
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
