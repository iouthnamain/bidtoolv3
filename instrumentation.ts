export async function register() {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { ensurePlaywrightPlatformEnvInProcess } = await import(
    "~/server/services/playwright-platform-env"
  );
  ensurePlaywrightPlatformEnvInProcess();

  const { createLogger } = await import("~/server/lib/logger");
  const log = createLogger("bootstrap");
  log.info("server_boot");

  const { startJobScheduler } = await import("~/server/services/job-scheduler");
  startJobScheduler();

  // Desktop auto-admin bootstrap. Self-guarded: no-ops unless the surface is
  // desktop-bundled with auth + auto-admin enabled. Idempotent and never throws,
  // so it is safe to await on every Node.js server boot.
  const { ensureDesktopAdmin } = await import(
    "~/server/services/auth-bootstrap"
  );
  await ensureDesktopAdmin();
}
