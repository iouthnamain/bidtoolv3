const hiddenTechnicalDetail =
  /(?:playwright|chromium|browser scrape|install-deps|bun x|node_modules|exited with code|spawn\s+\S+\s+enoent|\benoent\b|\/app\/|at\s+\S+\s*\([^)]*:\d+:\d+\))/i;

export function materialProfileActionMessage(
  detail: string | null | undefined,
  fallback: string,
) {
  const normalized = detail?.trim() ?? "";
  if (
    !normalized ||
    /^(?:INTERNAL_SERVER_ERROR|UNKNOWN_ERROR)$/i.test(normalized) ||
    hiddenTechnicalDetail.test(normalized)
  ) {
    return fallback;
  }
  return `${fallback} ${normalized}`;
}

export function materialProfileScrapeFailureMessage(
  detail: string | null | undefined,
) {
  const normalized = detail?.trim() ?? "";
  if (
    /playwright|chromium|browser scrape|install-deps|bun x/i.test(normalized)
  ) {
    return "Không thể mở trình duyệt thu thập dữ liệu. Hãy thử lại; nếu lỗi còn lặp lại, kiểm tra cấu hình máy chủ.";
  }
  if (/timed?\s*out|timeout|quá thời gian/i.test(normalized)) {
    return "Nguồn phản hồi quá chậm. Hãy thử lại hoặc chọn một nguồn khác.";
  }
  if (
    /\b(?:403|429)\b|forbidden|too many requests|rate.?limit/i.test(normalized)
  ) {
    return "Nguồn đang giới hạn truy cập. Hãy đợi một lúc hoặc chọn nguồn khác.";
  }
  return "Không thể thu thập dữ liệu từ nguồn này. Hãy thử lại hoặc chọn nguồn khác.";
}

export function shouldHideMaterialProfileTechnicalDetail(
  detail: string | null | undefined,
) {
  return hiddenTechnicalDetail.test(detail?.trim() ?? "");
}
