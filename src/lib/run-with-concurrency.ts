export async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit = 3,
  onProgress?: (completed: number, total: number) => void,
): Promise<T[]> {
  if (tasks.length === 0) return [];

  const results = new Array<T>(tasks.length);
  let nextIndex = 0;
  let completed = 0;

  const worker = async () => {
    while (nextIndex < tasks.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await tasks[index]!();
      completed += 1;
      onProgress?.(completed, tasks.length);
    }
  };

  const workers = Math.min(limit, tasks.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}
