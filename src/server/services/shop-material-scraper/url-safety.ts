import {
  resolvePublicUrl,
  isPublicIpAddress,
} from "~/server/services/public-content-client";

export type SafeScrapeUrlResolution = Awaited<ReturnType<typeof resolvePublicUrl>>;

export async function resolveSafeScrapeUrl(
  input: string,
  expectedHostname?: string,
): Promise<SafeScrapeUrlResolution> {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error("URL shop không hợp lệ.");
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (expectedHostname && hostname !== expectedHostname.toLowerCase()) {
    throw new Error("Chỉ theo pagination trong cùng domain shop.");
  }
  try {
    return await resolvePublicUrl(parsed);
  } catch (error) {
    if (error instanceof Error && error.message.includes("http/https")) {
      throw error;
    }
    throw new Error("Không hỗ trợ scrape URL nội bộ.");
  }
}

export async function assertSafeScrapeUrl(
  input: string,
  expectedHostname?: string,
) {
  return (await resolveSafeScrapeUrl(input, expectedHostname)).url;
}

export { isPublicIpAddress };
