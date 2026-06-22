import { afterEach, describe, expect, it, vi } from "vitest";

describe("createLogger", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("writes pretty logs in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("BIDTOOL_LOG_FORMAT", "pretty");
    vi.stubEnv("BIDTOOL_LOG_LEVEL", "debug");

    const { createLogger } = await import("./logger");
    const log = createLogger("test-service");
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    log.info("hello_world", { jobId: "abc-123" });

    expect(spy).toHaveBeenCalledOnce();
    const line = String(spy.mock.calls[0]?.[0]);
    expect(line).toContain("INFO");
    expect(line).toContain("[test-service]");
    expect(line).toContain("hello_world");
    expect(line).toContain("jobId=abc-123");
  });

  it("writes JSON logs when configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BIDTOOL_LOG_FORMAT", "json");
    vi.stubEnv("BIDTOOL_LOG_LEVEL", "info");

    const { createLogger } = await import("./logger");
    const log = createLogger("worker");
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    log.info("job_completed", { jobId: "job-1", durationMs: 42 });

    const payload = JSON.parse(String(spy.mock.calls[0]?.[0])) as {
      level: string;
      service: string;
      msg: string;
      jobId: string;
      durationMs: number;
    };

    expect(payload.level).toBe("info");
    expect(payload.service).toBe("worker");
    expect(payload.msg).toBe("job_completed");
    expect(payload.jobId).toBe("job-1");
    expect(payload.durationMs).toBe(42);
  });

  it("serializes errors in context", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BIDTOOL_LOG_FORMAT", "json");
    vi.stubEnv("BIDTOOL_LOG_LEVEL", "error");

    const { createLogger } = await import("./logger");
    const log = createLogger("api");
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const err = new Error("boom");

    log.error("request_failed", { error: err });

    const payload = JSON.parse(String(spy.mock.calls[0]?.[0])) as {
      error: { message: string; name: string };
    };
    expect(payload.error.message).toBe("boom");
    expect(payload.error.name).toBe("Error");
  });
});

describe("traceFn", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("logs function lifecycle when tracing is enabled", async () => {
    vi.stubEnv("BIDTOOL_TRACE_FUNCTIONS", "true");
    vi.stubEnv("BIDTOOL_LOG_FORMAT", "json");
    vi.stubEnv("BIDTOOL_LOG_LEVEL", "debug");

    const { createLogger, traceFn } = await import("./logger");
    const log = createLogger("worker");
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const run = traceFn(log, "doWork", async () => "ok");
    await expect(run()).resolves.toBe("ok");

    const messages = spy.mock.calls.map((call) =>
      JSON.parse(String(call[0])),
    ) as Array<{ msg: string; fn?: string }>;
    expect(messages.some((entry) => entry.msg === "function_started")).toBe(
      true,
    );
    expect(messages.some((entry) => entry.msg === "function_finished")).toBe(
      true,
    );
  });

  it("skips tracing when disabled", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BIDTOOL_LOG_LEVEL", "info");
    vi.stubEnv("BIDTOOL_TRACE_FUNCTIONS", "false");

    const { createLogger, traceFn } = await import("./logger");
    const log = createLogger("worker");
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const run = traceFn(log, "doWork", () => 42);
    expect(run()).toBe(42);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("trpc request logging", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("parses single and batched procedure paths", async () => {
    const { parseTrpcProcedures } = await import("./trpc-request-log");

    expect(
      parseTrpcProcedures(
        new URL("http://localhost:3000/api/trpc/notification.unreadCount?batch=1"),
      ),
    ).toEqual(["notification.unreadCount"]);

    expect(
      parseTrpcProcedures(
        new URL(
          "http://localhost:3000/api/trpc/notification.unreadCount,version.getStatus?batch=1",
        ),
      ),
    ).toEqual(["notification.unreadCount", "version.getStatus"]);
  });

  it("downgrades quiet polling procedures to debug", async () => {
    vi.stubEnv("BIDTOOL_TRPC_SLOW_MS", "750");

    const { resolveTrpcRequestLogLevel } = await import("./trpc-request-log");

    expect(
      resolveTrpcRequestLogLevel({
        procedures: ["notification.unreadCount"],
        status: 200,
        durationMs: 480,
        hadError: false,
      }),
    ).toBe("debug");

    expect(
      resolveTrpcRequestLogLevel({
        procedures: ["material.list"],
        status: 200,
        durationMs: 480,
        hadError: false,
      }),
    ).toBe("info");
  });
});
