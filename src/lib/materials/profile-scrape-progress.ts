export type MaterialProfileScrapeProgressJob = {
  status: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  lastProgressAt?: string | null;
  updatedAt?: string | null;
};

export type MaterialProfileScrapeProgressRun = {
  status: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  updatedAt?: string | null;
};

export function isMaterialProfileScrapeProducerActive(status: string) {
  return status === "queued" || status === "running";
}

function timestampMs(value: string | null | undefined) {
  if (!value) return null;
  const valueMs = new Date(value).getTime();
  return Number.isFinite(valueMs) ? valueMs : null;
}

export function materialProfileScrapeElapsedMs({
  job,
  run,
  childDurationMs,
  nowMs = Date.now(),
}: {
  job: MaterialProfileScrapeProgressJob;
  run?: MaterialProfileScrapeProgressRun | null;
  childDurationMs?: number | null;
  nowMs?: number;
}) {
  if (childDurationMs != null) return Math.max(0, childDurationMs);

  const startedAtMs =
    timestampMs(job.startedAt) ?? timestampMs(run?.startedAt) ?? nowMs;
  const producerActive = isMaterialProfileScrapeProducerActive(job.status);
  const finishedAtMs = producerActive
    ? nowMs
    : (timestampMs(job.finishedAt) ??
      timestampMs(run?.finishedAt) ??
      timestampMs(run?.updatedAt) ??
      timestampMs(job.lastProgressAt) ??
      timestampMs(job.updatedAt) ??
      startedAtMs);

  return Math.max(0, finishedAtMs - startedAtMs);
}
