import "server-only";

/**
 * Env vars:
 * - BIDTOOL_LOG_LEVEL: debug | info | warn | error
 * - BIDTOOL_LOG_FORMAT: pretty | json
 * - BIDTOOL_TRPC_DEBUG: log every tRPC procedure via middleware
 * - BIDTOOL_TRPC_SLOW_MS: slow procedure threshold (default 750)
 * - BIDTOOL_TRACE_FUNCTIONS: enable function entry/exit traces
 * - BIDTOOL_LOG_QUIET_PROCEDURES: comma-separated poll endpoints
 */

export type LogLevel = "debug" | "info" | "warn" | "error";
type LogFormat = "json" | "pretty";
type LogContext = Record<string, unknown>;

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const LEVEL_LABEL: Record<LogLevel, string> = {
  debug: "DEBUG",
  info: "INFO ",
  warn: "WARN ",
  error: "ERROR",
};

export type Logger = {
  debug: (msg: string, context?: LogContext) => void;
  info: (msg: string, context?: LogContext) => void;
  warn: (msg: string, context?: LogContext) => void;
  error: (msg: string, context?: LogContext) => void;
  child: (bindings: LogContext) => Logger;
};

function parseLogLevel(value: string | undefined, fallback: LogLevel): LogLevel {
  switch (value?.toLowerCase()) {
    case "debug":
    case "info":
    case "warn":
    case "error":
      return value.toLowerCase() as LogLevel;
    default:
      return fallback;
  }
}

function parseLogFormat(
  value: string | undefined,
  fallback: LogFormat,
): LogFormat {
  switch (value?.toLowerCase()) {
    case "json":
    case "pretty":
      return value.toLowerCase() as LogFormat;
    default:
      return fallback;
  }
}

function resolveMinLevel(): LogLevel {
  const fallback =
    process.env.NODE_ENV === "production" ? "info" : "debug";
  return parseLogLevel(process.env.BIDTOOL_LOG_LEVEL, fallback);
}

function resolveFormat(): LogFormat {
  const fallback =
    process.env.NODE_ENV === "production" ? "json" : "pretty";
  return parseLogFormat(process.env.BIDTOOL_LOG_FORMAT, fallback);
}

function shouldLog(level: LogLevel, minLevel: LogLevel) {
  return LEVEL_RANK[level] >= LEVEL_RANK[minLevel];
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause:
        error.cause !== undefined ? serializeValue(error.cause) : undefined,
    };
  }

  return { message: String(error) };
}

function serializeValue(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }
  if (value instanceof Error) {
    return serializeError(value);
  }
  if (Array.isArray(value)) {
    return value.map(serializeValue);
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      output[key] = serializeValue(nested);
    }
    return output;
  }
  return value;
}

function normalizeContext(context?: LogContext) {
  if (!context) {
    return {};
  }

  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (value === undefined) {
      continue;
    }
    output[key] = serializeValue(value);
  }
  return output;
}

function formatContextInline(context: Record<string, unknown>) {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(context)) {
    if (key === "service" || key === "msg") {
      continue;
    }
    parts.push(`${key}=${formatInlineValue(value)}`);
  }
  return parts.join(" ");
}

function formatInlineValue(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return value.includes(" ") ? JSON.stringify(value) : value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function emit(
  level: LogLevel,
  bindings: LogContext,
  msg: string,
  context?: LogContext,
) {
  const minLevel = resolveMinLevel();
  if (!shouldLog(level, minLevel)) {
    return;
  }

  const entry = {
    ...bindings,
    ...normalizeContext(context),
    msg,
  };

  if (resolveFormat() === "pretty") {
    writePretty(level, entry);
    return;
  }

  writeJson(level, entry);
}

export function createLogger(service: string, bindings: LogContext = {}): Logger {
  const baseBindings = { service, ...bindings };

  return {
    debug(msg, context) {
      emit("debug", baseBindings, msg, context);
    },
    info(msg, context) {
      emit("info", baseBindings, msg, context);
    },
    warn(msg, context) {
      emit("warn", baseBindings, msg, context);
    },
    error(msg, context) {
      emit("error", baseBindings, msg, context);
    },
    child(childBindings) {
      return createLogger(service, { ...bindings, ...childBindings });
    },
  };
}

function shouldTraceFunctions() {
  if (process.env.BIDTOOL_TRACE_FUNCTIONS === "true") {
    return true;
  }
  return resolveMinLevel() === "debug";
}

export function traceFn<TArgs extends unknown[], TReturn>(
  logger: Logger,
  fnName: string,
  fn: (...args: TArgs) => TReturn,
): (...args: TArgs) => TReturn {
  if (!shouldTraceFunctions()) {
    return fn;
  }

  const run = (...args: TArgs): TReturn => {
    const start = Date.now();
    logger.debug("function_started", { fn: fnName });

    try {
      const result = fn(...args);
      if (result instanceof Promise) {
        return result
          .then((value) => {
            logger.debug("function_finished", {
              fn: fnName,
              durationMs: Date.now() - start,
            });
            return value;
          })
          .catch((error: unknown) => {
            logger.warn("function_failed", {
              fn: fnName,
              durationMs: Date.now() - start,
              error,
            });
            throw error;
          }) as TReturn;
      }

      logger.debug("function_finished", {
        fn: fnName,
        durationMs: Date.now() - start,
      });
      return result;
    } catch (error) {
      logger.warn("function_failed", {
        fn: fnName,
        durationMs: Date.now() - start,
        error,
      });
      throw error;
    }
  };

  return run;
}

function writeJson(level: LogLevel, entry: Record<string, unknown>) {
  const payload = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    ...entry,
  });

  switch (level) {
    case "debug":
    case "info":
      console.log(payload);
      break;
    case "warn":
      console.warn(payload);
      break;
    case "error":
      console.error(payload);
      break;
  }
}

function writePretty(level: LogLevel, entry: Record<string, unknown>) {
  const ts = new Date().toISOString().slice(11, 23);
  const service =
    typeof entry.service === "string" ? `[${entry.service}] ` : "";
  const msg = typeof entry.msg === "string" ? entry.msg : "log";
  const inline = formatContextInline(entry);
  const line = `${ts} ${LEVEL_LABEL[level]} ${service}${msg}${inline ? ` ${inline}` : ""}`;

  switch (level) {
    case "debug":
    case "info":
      console.log(line);
      break;
    case "warn":
      console.warn(line);
      break;
    case "error":
      console.error(line);
      break;
  }
}
