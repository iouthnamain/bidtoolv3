import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { extractPriceFromText } from "~/lib/material-price-sources";

export {
  buildMaterialMetadata,
  MATERIAL_FIELD_LOCK_KEYS,
  normalizeMaterialMetadata,
} from "~/lib/material-price-sources";
export type {
  MaterialFieldLockKey,
  MaterialMetadata,
  MaterialPriceSource,
  MaterialPriceSourceMode,
} from "~/lib/material-price-sources";

const DNS_TIMEOUT_MS = 5_000;

export async function fetchPriceFromUrl(url: string): Promise<{
  priceText: string | null;
  price: number | null;
}> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("URL nguồn không hợp lệ.");
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("Chỉ hỗ trợ URL http hoặc https.");
  }
  await assertPublicHostname(parsedUrl.hostname);

  const response = await fetch(parsedUrl, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; BidTool/1.0; +https://localhost)",
      accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
    },
    signal: AbortSignal.timeout(12_000),
  });

  if (!response.ok) {
    throw new Error(`Không đọc được nguồn giá (${response.status}).`);
  }

  const html = await response.text();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&");

  return extractPriceFromText(text);
}

async function assertPublicHostname(hostname: string) {
  const normalizedHostname = hostname.toLowerCase();
  if (
    normalizedHostname === "localhost" ||
    normalizedHostname.endsWith(".localhost") ||
    normalizedHostname.endsWith(".local")
  ) {
    throw new Error("Không hỗ trợ URL nguồn nội bộ.");
  }

  const directIpVersion = isIP(normalizedHostname);
  if (directIpVersion !== 0) {
    if (isPrivateIp(normalizedHostname)) {
      throw new Error("Không hỗ trợ IP nguồn nội bộ.");
    }
    return;
  }

  const addresses = await withTimeout(
    lookup(normalizedHostname, { all: true, verbatim: true }),
    DNS_TIMEOUT_MS,
    "Không thể xác thực host nguồn trong thời gian cho phép.",
  );
  if (
    addresses.length === 0 ||
    addresses.some((item) => isPrivateIp(item.address))
  ) {
    throw new Error("Không hỗ trợ host nguồn nội bộ.");
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
) {
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
