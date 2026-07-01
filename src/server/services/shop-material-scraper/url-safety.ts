import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const DNS_TIMEOUT_MS = 5_000;
const PUBLIC_HOST_CACHE = new Map<string, Promise<void>>();

export async function assertSafeScrapeUrl(
  input: string,
  expectedHostname?: string,
) {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error("URL shop không hợp lệ.");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Chỉ hỗ trợ URL http hoặc https.");
  }

  const hostname = parsed.hostname.toLowerCase();
  if (expectedHostname && hostname !== expectedHostname.toLowerCase()) {
    throw new Error("Chỉ theo pagination trong cùng domain shop.");
  }

  const cached = PUBLIC_HOST_CACHE.get(hostname);
  if (cached) {
    await cached;
    return parsed;
  }

  const promise = assertPublicHostname(hostname);
  PUBLIC_HOST_CACHE.set(hostname, promise);
  try {
    await promise;
  } catch (error) {
    PUBLIC_HOST_CACHE.delete(hostname);
    throw error;
  }
  return parsed;
}

async function assertPublicHostname(hostname: string) {
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  ) {
    throw new Error("Không hỗ trợ scrape URL nội bộ.");
  }

  const directIpVersion = isIP(hostname);
  if (directIpVersion !== 0) {
    if (isPrivateIp(hostname)) {
      throw new Error("Không hỗ trợ scrape IP nội bộ.");
    }
    return;
  }

  const addresses = await withTimeout(
    lookup(hostname, { all: true, verbatim: true }),
    DNS_TIMEOUT_MS,
    "Không thể xác thực host shop trong thời gian cho phép.",
  );
  if (
    addresses.length === 0 ||
    addresses.some((item) => isPrivateIp(item.address))
  ) {
    throw new Error("Không hỗ trợ scrape host nội bộ.");
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });
}

function isPrivateIp(address: string) {
  if (address.includes(":")) {
    const normalized = address.toLowerCase();
    const mappedIpv4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
    if (mappedIpv4?.[1]) {
      return isPrivateIpv4(mappedIpv4[1]);
    }

    return (
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:")
    );
  }

  return isPrivateIpv4(address);
}

function isPrivateIpv4(address: string) {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return true;
  }
  const [a = 0, b = 0, c = 0] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}
