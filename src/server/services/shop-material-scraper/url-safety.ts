import {
  assertPublicUrl,
  isPublicIpAddress,
} from "~/server/services/public-content-client";

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

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (expectedHostname && hostname !== expectedHostname.toLowerCase()) {
    throw new Error("Chỉ theo pagination trong cùng domain shop.");
  }
  try {
    await assertPublicUrl(parsed);
  } catch (error) {
    if (error instanceof Error && error.message.includes("http/https")) {
      throw error;
    }
    throw new Error("Không hỗ trợ scrape URL nội bộ.");
  }
  return parsed;
}

export { isPublicIpAddress };
