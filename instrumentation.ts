export async function register() {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { startJobScheduler } = await import("~/server/services/job-scheduler");
  startJobScheduler();
}
