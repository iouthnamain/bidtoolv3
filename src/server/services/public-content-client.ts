import "server-only";

import { lookup as dnsLookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import * as http from "node:http";
import * as https from "node:https";
import { isIP } from "node:net";
import { type Readable, type Transform } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

import { createLogger, traceFn } from "~/server/lib/logger";

const log = createLogger("services-public-content-client");

export const PUBLIC_CONTENT_TEXT_MAX_BYTES = 5 * 1024 * 1024;
export const PUBLIC_CONTENT_PDF_MAX_BYTES = 50 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 5;
const DNS_TIMEOUT_MS = 5_000;

type AddressFamily = 4 | 6;

export type PublicContentKind = "pdf" | "text";

export type PublicContentRequest = {
  url: string | URL;
  kind: PublicContentKind;
  headers?: Record<string, string>;
  timeoutMs: number;
  signal?: AbortSignal;
  maxBytes?: number;
  maxRedirects?: number;
  /** Called for every initial and redirected URL before DNS resolution. */
  validateUrl?: (url: URL) => void;
};

export type PublicContentResponse = {
  status: number;
  finalUrl: string;
  contentType: string;
  body: Buffer;
};

export class PublicContentError extends Error {
  readonly code:
    | "invalid_url"
    | "private_destination"
    | "dns_failed"
    | "timeout"
    | "aborted"
    | "redirect_limit"
    | "redirect_invalid"
    | "body_limit"
    | "unsupported_encoding"
    | "transport"
    | "http";

  constructor(message: string, code: PublicContentError["code"]) {
    super(message);
    this.name = "PublicContentError";
    this.code = code;
  }
}

type PublicContentAddress = {
  address: string;
  family: AddressFamily;
};

type Lookup = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<LookupAddress[]>;

type RequestFactory = (
  options: http.RequestOptions,
  callback: (response: http.IncomingMessage) => void,
) => http.ClientRequest;

type PublicContentClientDependencies = {
  lookup: Lookup;
  httpRequest: RequestFactory;
  httpsRequest: RequestFactory;
};

const defaultDependencies: PublicContentClientDependencies = {
  lookup: dnsLookup as Lookup,
  httpRequest: http.request,
  httpsRequest: https.request,
};

function parseUrl(input: string | URL): URL {
  let parsed: URL;
  try {
    parsed = input instanceof URL ? new URL(input.href) : new URL(input);
  } catch {
    throw new PublicContentError("URL nguồn không hợp lệ.", "invalid_url");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new PublicContentError(
      "Chỉ hỗ trợ tải nội dung qua http/https.",
      "invalid_url",
    );
  }
  if (parsed.username || parsed.password) {
    throw new PublicContentError(
      "URL nguồn không được chứa thông tin đăng nhập.",
      "invalid_url",
    );
  }
  if (!parsed.hostname || parsed.hostname.endsWith(".")) {
    // A trailing DNS dot is a valid DNS spelling, but it makes host policy and
    // TLS names diverge between runtimes. Keep the public boundary strict.
    throw new PublicContentError("URL nguồn không hợp lệ.", "invalid_url");
  }

  return parsed;
}

function hostnameForPolicy(url: URL) {
  return url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

function ipv4ToNumber(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) return -1;
    const value = Number(part);
    return value >= 0 && value <= 255 ? value : -1;
  });
  if (octets.some((part) => part < 0)) return null;
  return (
    (((octets[0] ?? 0) * 256 + (octets[1] ?? 0)) * 256 + (octets[2] ?? 0)) *
      256 +
    (octets[3] ?? 0)
  );
}

function isIpv4InRange(address: string, start: number, end: number) {
  const value = ipv4ToNumber(address);
  return value !== null && value >= start && value <= end;
}

function parseIpv6(address: string): bigint | null {
  const [normalized = ""] = address.toLowerCase().split("%");
  if (!normalized?.includes(":")) return null;

  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const parseGroup = (group: string) => {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    return Number.parseInt(group, 16);
  };

  const leftGroups: number[] = [];
  const rightGroups: number[] = [];
  const parseGroups = (parts: string[], target: number[]) => {
    for (const group of parts) {
      if (group.includes(".")) {
        const ipv4 = ipv4ToNumber(group);
        if (ipv4 === null) return false;
        target.push((ipv4 >>> 16) & 0xffff, ipv4 & 0xffff);
        continue;
      }
      const parsed = parseGroup(group);
      if (parsed === null) return false;
      target.push(parsed);
    }
    return true;
  };
  if (!parseGroups(left, leftGroups) || !parseGroups(right, rightGroups)) {
    return null;
  }
  const present = leftGroups.length + rightGroups.length;
  const missing = 8 - present;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const expanded = [
    ...leftGroups,
    ...(halves.length === 2 ? Array.from({ length: missing }, () => 0) : []),
    ...rightGroups,
  ];
  if (expanded.length !== 8) return null;

  return expanded.reduce((value, group) => (value << 16n) | BigInt(group), 0n);
}

function ipv6Prefix(value: bigint, bits: number) {
  return value >> BigInt(128 - bits);
}

function isPublicIpv4(address: string) {
  const value = ipv4ToNumber(address);
  if (value === null) return false;

  return !(
    isIpv4InRange(address, 0x00000000, 0x00ffffff) || // unspecified/current network
    isIpv4InRange(address, 0x0a000000, 0x0affffff) || // private
    isIpv4InRange(address, 0x64400000, 0x647fffff) || // carrier-grade NAT
    isIpv4InRange(address, 0x7f000000, 0x7fffffff) || // loopback
    isIpv4InRange(address, 0xa9fe0000, 0xa9feffff) || // link-local
    isIpv4InRange(address, 0xac100000, 0xac1fffff) || // private
    isIpv4InRange(address, 0xc0000000, 0xc00000ff) || // IETF protocol assignments
    isIpv4InRange(address, 0xc0000200, 0xc00002ff) || // TEST-NET-1
    isIpv4InRange(address, 0xc0586300, 0xc05863ff) || // 6to4 relay anycast
    isIpv4InRange(address, 0xc0a80000, 0xc0a8ffff) || // private
    isIpv4InRange(address, 0xc6120000, 0xc613ffff) || // benchmarking
    isIpv4InRange(address, 0xc6336400, 0xc63364ff) || // TEST-NET-2
    isIpv4InRange(address, 0xcb007100, 0xcb0071ff) || // TEST-NET-3
    value >= 0xe0000000 // multicast and reserved
  );
}

/** Returns true only for globally routable IP address space. */
export function isPublicIpAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPublicIpv4(address);
  if (version !== 6) return false;

  const value = parseIpv6(address);
  if (value === null) return false;

  if (value === 0n || value === 1n) return false; // unspecified / loopback
  const mappedPrefix = ipv6Prefix(value, 96);
  if (mappedPrefix === 0xffffn) {
    const mappedIpv4 = Number(value & 0xffffffffn);
    const octets = [
      (mappedIpv4 >>> 24) & 0xff,
      (mappedIpv4 >>> 16) & 0xff,
      (mappedIpv4 >>> 8) & 0xff,
      mappedIpv4 & 0xff,
    ].join(".");
    return isPublicIpv4(octets);
  }

  // IPv4-compatible IPv6 (deprecated, but still accepted by URL parsers)
  // carries its destination in the low 32 bits and must use the same policy.
  if (ipv6Prefix(value, 96) === 0n) {
    const embeddedIpv4 = Number(value & 0xffffffffn);
    const octets = [
      (embeddedIpv4 >>> 24) & 0xff,
      (embeddedIpv4 >>> 16) & 0xff,
      (embeddedIpv4 >>> 8) & 0xff,
      embeddedIpv4 & 0xff,
    ].join(".");
    return isPublicIpv4(octets);
  }

  const prefix7 = ipv6Prefix(value, 7);
  const prefix10 = ipv6Prefix(value, 10);
  const prefix32 = ipv6Prefix(value, 32);
  return !(
    prefix7 === 0b1111110n || // fc00::/7 unique local
    prefix10 === 0b1111111010n || // fe80::/10 link-local
    ipv6Prefix(value, 8) === 0xffn || // multicast
    prefix10 === 0b1111111011n || // fec0::/10 site-local
    prefix32 === 0x20010db8n // documentation
  );
}

function assertPublicHostname(hostname: string) {
  const normalized = hostname.toLowerCase();
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local")
  ) {
    throw new PublicContentError(
      "Không hỗ trợ truy cập đích nội bộ.",
      "private_destination",
    );
  }
}

function remainingMs(deadline: number) {
  return Math.max(0, deadline - Date.now());
}

function abortError(signal: AbortSignal): PublicContentError {
  const reason: unknown = signal.reason;
  if (reason instanceof PublicContentError) return reason;
  return new PublicContentError(
    signal.aborted && reason instanceof Error
      ? reason.message
      : "Đã hủy yêu cầu tải nội dung.",
    signal.aborted && reason instanceof Error && reason.name === "TimeoutError"
      ? "timeout"
      : "aborted",
  );
}

async function raceWithSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  timeoutMessage: string,
): Promise<T> {
  if (signal.aborted) throw abortError(signal);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      reject(new PublicContentError(timeoutMessage, "dns_failed"));
    }, DNS_TIMEOUT_MS);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(abortError(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        signal.removeEventListener("abort", onAbort);
        reject(
          error instanceof Error ? error : new Error("DNS lookup failed."),
        );
      },
    );
  });
}

async function resolvePublicDestination(
  url: URL,
  dependencies: PublicContentClientDependencies,
  signal: AbortSignal,
): Promise<PublicContentAddress> {
  const hostname = hostnameForPolicy(url);
  assertPublicHostname(hostname);
  const directVersion = isIP(hostname);
  if (directVersion !== 0) {
    if (!isPublicIpAddress(hostname)) {
      throw new PublicContentError(
        "Không hỗ trợ truy cập đích nội bộ.",
        "private_destination",
      );
    }
    return { address: hostname, family: directVersion as AddressFamily };
  }

  let addresses: LookupAddress[];
  try {
    addresses = await raceWithSignal(
      dependencies.lookup(hostname, { all: true, verbatim: true }),
      signal,
      "Không thể xác thực host trong thời gian cho phép.",
    );
  } catch (error) {
    if (error instanceof PublicContentError) throw error;
    throw new PublicContentError(
      "Không thể xác thực host trong thời gian cho phép.",
      "dns_failed",
    );
  }

  if (
    addresses.length === 0 ||
    addresses.some(
      (item) =>
        (item.family !== 4 && item.family !== 6) ||
        !isPublicIpAddress(item.address),
    )
  ) {
    throw new PublicContentError(
      "Không hỗ trợ host trỏ tới đích nội bộ hoặc không công khai.",
      "private_destination",
    );
  }

  const first = addresses[0];
  if (!first) {
    throw new PublicContentError(
      "Không hỗ trợ host không có địa chỉ công khai.",
      "private_destination",
    );
  }
  return { address: first.address, family: first.family as AddressFamily };
}

export async function assertPublicUrl(
  input: string | URL,
  options?: { signal?: AbortSignal },
): Promise<URL> {
  const parsed = parseUrl(input);
  const controller = new AbortController();
  const signal = options?.signal ?? controller.signal;
  await resolvePublicDestination(parsed, defaultDependencies, signal);
  return parsed;
}

function responseHeaders(response: http.IncomingMessage) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(response.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  return headers;
}

function destroyStream(
  stream: { destroy?: () => void; resume?: () => void } | undefined | null,
) {
  if (!stream) return;
  if ("destroy" in stream && typeof stream.destroy === "function") {
    stream.destroy();
    return;
  }
  if (typeof stream.resume === "function") stream.resume();
}

function decoderFor(contentEncoding: string | null): Transform | null {
  const normalized = contentEncoding?.trim().toLowerCase();
  if (!normalized || normalized === "identity") return null;
  if (normalized === "gzip" || normalized === "x-gzip") return createGunzip();
  if (normalized === "deflate") return createInflate();
  if (normalized === "br") return createBrotliDecompress();
  throw new PublicContentError(
    "Nguồn dùng kiểu nén không được hỗ trợ.",
    "unsupported_encoding",
  );
}

async function readBody(
  response: http.IncomingMessage,
  headers: Headers,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Buffer> {
  const contentLength = Number(headers.get("content-length") ?? "");
  const contentEncoding = headers.get("content-encoding");
  let decoder: Transform | null;
  try {
    decoder = decoderFor(contentEncoding);
  } catch (error) {
    destroyStream(response);
    throw error;
  }
  if (!decoder && Number.isFinite(contentLength) && contentLength > maxBytes) {
    destroyStream(response);
    throw new PublicContentError(
      "Nội dung vượt quá giới hạn cho phép.",
      "body_limit",
    );
  }

  const source: Readable = decoder
    ? (response.pipe(decoder) as Readable)
    : response;
  const chunks: Buffer[] = [];
  let total = 0;
  const onAbort = () => {
    destroyStream(response);
    destroyStream(decoder);
  };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    for await (const chunk of source as AsyncIterable<unknown>) {
      if (signal.aborted) throw abortError(signal);
      const buffer =
        typeof chunk === "string"
          ? Buffer.from(chunk)
          : chunk instanceof Uint8Array
            ? Buffer.from(chunk)
            : Buffer.from(String(chunk));
      total += buffer.byteLength;
      if (total > maxBytes) {
        destroyStream(response);
        destroyStream(decoder);
        throw new PublicContentError(
          "Nội dung vượt quá giới hạn cho phép.",
          "body_limit",
        );
      }
      chunks.push(buffer);
    }
  } catch (error) {
    destroyStream(response);
    destroyStream(decoder);
    if (error instanceof PublicContentError) throw error;
    if (signal.aborted) throw abortError(signal);
    throw error;
  } finally {
    signal.removeEventListener("abort", onAbort);
    destroyStream(decoder);
  }
  return Buffer.concat(chunks, total);
}

function requestOnce(
  destination: PublicContentAddress,
  url: URL,
  headers: Record<string, string>,
  deadline: number,
  signal: AbortSignal,
  dependencies: PublicContentClientDependencies,
): Promise<http.IncomingMessage> {
  if (signal.aborted) return Promise.reject(abortError(signal));
  const requestFactory =
    url.protocol === "https:"
      ? dependencies.httpsRequest
      : dependencies.httpRequest;
  const requestHeaders = {
    "Accept-Encoding": "gzip, deflate, br",
    Connection: "close",
    ...Object.fromEntries(
      Object.entries(headers).filter(([name]) => name.toLowerCase() !== "host"),
    ),
    Host: url.host,
  };

  return new Promise((resolve, reject) => {
    const requestOptions: http.RequestOptions = {
      protocol: url.protocol,
      hostname: destination.address,
      family: destination.family,
      port: url.port || undefined,
      method: "GET",
      path: `${url.pathname || "/"}${url.search}`,
      headers: requestHeaders,
      ...(url.protocol === "https:"
        ? { servername: hostnameForPolicy(url) }
        : {}),
    };
    let settled = false;
    const finishReject = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(
        error instanceof PublicContentError
          ? error
          : signal.aborted
            ? abortError(signal)
            : new PublicContentError(
                "Không thể kết nối tới nguồn nội dung.",
                "transport",
              ),
      );
    };

    let request: http.ClientRequest;
    try {
      request = requestFactory(requestOptions, (response) => {
        if (settled) {
          destroyStream(response);
          return;
        }
        settled = true;
        resolve(response);
      });
    } catch (error) {
      finishReject(error);
      return;
    }

    const onAbort = () => {
      request.destroy(abortError(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    request.once("error", (error) => {
      signal.removeEventListener("abort", onAbort);
      finishReject(error);
    });
    const timeoutMs = remainingMs(deadline);
    if (timeoutMs <= 0) {
      request.destroy(
        new PublicContentError(
          "Tải nội dung quá thời gian cho phép.",
          "timeout",
        ),
      );
      return;
    }
    request.setTimeout(timeoutMs, () => {
      request.destroy(
        new PublicContentError(
          "Tải nội dung quá thời gian cho phép.",
          "timeout",
        ),
      );
    });
    request.end();
  });
}

export function createPublicContentClient(
  dependencies: Partial<PublicContentClientDependencies> = {},
) {
  const resolvedDependencies = { ...defaultDependencies, ...dependencies };

  async function fetchPublicContent(
    input: PublicContentRequest,
  ): Promise<PublicContentResponse> {
    const parsedInput = parseUrl(input.url);
    const maxBytes =
      input.maxBytes ??
      (input.kind === "pdf"
        ? PUBLIC_CONTENT_PDF_MAX_BYTES
        : PUBLIC_CONTENT_TEXT_MAX_BYTES);
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
      throw new PublicContentError(
        "Giới hạn nội dung không hợp lệ.",
        "body_limit",
      );
    }
    if (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0) {
      throw new PublicContentError("Thời hạn tải không hợp lệ.", "timeout");
    }

    const deadline = Date.now() + input.timeoutMs;
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort(
        new PublicContentError(
          "Tải nội dung quá thời gian cho phép.",
          "timeout",
        ),
      );
    }, input.timeoutMs);
    const onCallerAbort = () => {
      controller.abort(
        new PublicContentError("Đã hủy yêu cầu tải nội dung.", "aborted"),
      );
    };
    input.signal?.addEventListener("abort", onCallerAbort, { once: true });
    if (input.signal?.aborted) onCallerAbort();

    let currentUrl = parsedInput;
    let forwardCredentials = true;
    let redirects = 0;
    try {
      while (true) {
        if (controller.signal.aborted) throw abortError(controller.signal);
        input.validateUrl?.(currentUrl);
        const destination = await resolvePublicDestination(
          currentUrl,
          resolvedDependencies,
          controller.signal,
        );
        const requestHeaders = { ...(input.headers ?? {}) };
        if (!forwardCredentials) {
          for (const [name] of Object.entries(requestHeaders)) {
            if (
              ["authorization", "cookie", "proxy-authorization"].includes(
                name.toLowerCase(),
              )
            ) {
              delete requestHeaders[name];
            }
          }
        }
        const response = await requestOnce(
          destination,
          currentUrl,
          requestHeaders,
          deadline,
          controller.signal,
          resolvedDependencies,
        );
        const headers = responseHeaders(response);
        const status = response.statusCode ?? 0;

        if (status >= 300 && status < 400) {
          const location = headers.get("location");
          destroyStream(response);
          if (!location) {
            throw new PublicContentError(
              "Nguồn chuyển hướng không hợp lệ.",
              "redirect_invalid",
            );
          }
          if (redirects >= (input.maxRedirects ?? DEFAULT_MAX_REDIRECTS)) {
            throw new PublicContentError(
              "Nguồn chuyển hướng quá nhiều lần.",
              "redirect_limit",
            );
          }
          try {
            if (new URL(location, currentUrl).origin !== currentUrl.origin) {
              forwardCredentials = false;
            }
            currentUrl = parseUrl(new URL(location, currentUrl));
          } catch (error) {
            if (error instanceof PublicContentError) {
              throw new PublicContentError(
                "Nguồn chuyển hướng không hợp lệ.",
                "redirect_invalid",
              );
            }
            throw error;
          }
          redirects += 1;
          continue;
        }

        if (status < 200 || status >= 300) {
          destroyStream(response);
          throw new PublicContentError(
            `Nguồn trả về lỗi HTTP ${status}.`,
            "http",
          );
        }

        const body = await readBody(
          response,
          headers,
          maxBytes,
          controller.signal,
        );
        return {
          status,
          finalUrl: currentUrl.toString(),
          contentType: headers.get("content-type") ?? "",
          body,
        };
      }
    } catch (error) {
      if (controller.signal.aborted) {
        if (timedOut) {
          throw new PublicContentError(
            "Tải nội dung quá thời gian cho phép.",
            "timeout",
          );
        }
        throw abortError(controller.signal);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", onCallerAbort);
    }
  }

  return { fetchPublicContent };
}

const defaultClient = createPublicContentClient();

export const fetchPublicContent = traceFn(
  log,
  "fetchPublicContent",
  defaultClient.fetchPublicContent,
);
