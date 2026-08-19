import { describe, expect, it } from "vitest";

import {
  materialProfileActionMessage,
  materialProfileScrapeFailureMessage,
  shouldHideMaterialProfileTechnicalDetail,
} from "~/lib/materials/profile-user-message";

describe("material profile user messages", () => {
  it("keeps actionable validation details", () => {
    expect(
      materialProfileActionMessage(
        "Thiếu cột Tên vật tư.",
        "Không thể lưu ánh xạ.",
      ),
    ).toBe("Không thể lưu ánh xạ. Thiếu cột Tên vật tư.");
  });

  it("hides runtime setup commands from action errors", () => {
    const detail =
      'Không khởi động được browser scrape. Chạy "bun x playwright install chromium --force".';
    expect(
      materialProfileActionMessage(detail, "Không thể xử lý workbook."),
    ).toBe("Không thể xử lý workbook.");
    expect(shouldHideMaterialProfileTechnicalDetail(detail)).toBe(true);
  });

  it("turns scrape runtime failures into recovery guidance", () => {
    expect(
      materialProfileScrapeFailureMessage(
        "playwright install chromium --force exited with code 1",
      ),
    ).toContain("kiểm tra cấu hình máy chủ");
    expect(materialProfileScrapeFailureMessage("Navigation timeout")).toContain(
      "phản hồi quá chậm",
    );
  });
});
