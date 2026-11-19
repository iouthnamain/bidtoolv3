export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensurePlaywrightPlatformEnvInProcess } =
      await import("~/server/services/playwright-platform-env");
    ensurePlaywrightPlatformEnvInProcess();

    const { createLogger } = await import("~/server/lib/logger");
    const log = createLogger("bootstrap");
    log.info("server_boot");

    const { startJobScheduler } = await import("~/server/services/job-scheduler");
    startJobScheduler();
  }
}
