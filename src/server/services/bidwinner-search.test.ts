import { describe, expect, it } from "vitest";

import { formatBidNoticeNumber } from "~/server/services/bidwinner-search";

describe("formatBidNoticeNumber", () => {
  it("formats BidWinner numeric notice numbers like the source table", () => {
    expect(
      formatBidNoticeNumber({
        id: 11242349,
        so_tbmt: 2600190527,
        rev: "00",
      }),
    ).toBe("IB2600190527-00");
  });

  it("keeps source-formatted notice numbers unchanged", () => {
    expect(
      formatBidNoticeNumber({
        id: 11242349,
        so_tbmt: "IB2600190527-00",
        rev: "01",
      }),
    ).toBe("IB2600190527-00");
  });

  it("falls back to the internal id only when the notice number is missing", () => {
    expect(formatBidNoticeNumber({ id: 11242349 })).toBe("11242349");
  });
});
