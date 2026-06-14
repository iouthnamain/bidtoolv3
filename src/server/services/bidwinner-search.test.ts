import { describe, expect, it } from "vitest";

import {
  computeScanPageRange,
  formatBidNoticeNumber,
} from "~/server/services/bidwinner-search";

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

describe("computeScanPageRange", () => {
  describe("without refinement (exact window)", () => {
    it("maps the first page window 1:1", () => {
      expect(
        computeScanPageRange({
          offset: 0,
          limit: 20,
          perPage: 20,
          refineActive: false,
          lastPage: 50,
        }),
      ).toEqual({ pages: [1], truncated: false });
    });

    it("maps a later offset to its single source page", () => {
      expect(
        computeScanPageRange({
          offset: 40,
          limit: 20,
          perPage: 20,
          refineActive: false,
          lastPage: 50,
        }),
      ).toEqual({ pages: [3], truncated: false });
    });

    it("spans multiple source pages when the window straddles a boundary", () => {
      expect(
        computeScanPageRange({
          offset: 10,
          limit: 20,
          perPage: 20,
          refineActive: false,
          lastPage: 50,
        }),
      ).toEqual({ pages: [1, 2], truncated: false });
    });

    it("clamps to lastPage", () => {
      expect(
        computeScanPageRange({
          offset: 100,
          limit: 20,
          perPage: 20,
          refineActive: false,
          lastPage: 3,
        }),
      ).toEqual({ pages: [3], truncated: false });
    });
  });

  describe("with refinement (page-1 anchored scan)", () => {
    it("anchors at page 1 and pulls up to the page cap regardless of offset", () => {
      expect(
        computeScanPageRange({
          offset: 40,
          limit: 20,
          perPage: 20,
          refineActive: true,
          lastPage: 50,
        }),
      ).toEqual({ pages: [1, 2, 3, 4, 5], truncated: true });
    });

    it("does not exceed lastPage and is not truncated when fully covered", () => {
      expect(
        computeScanPageRange({
          offset: 0,
          limit: 20,
          perPage: 20,
          refineActive: true,
          lastPage: 3,
        }),
      ).toEqual({ pages: [1, 2, 3], truncated: false });
    });

    it("flags truncation when the source has more pages than the cap", () => {
      const result = computeScanPageRange({
        offset: 0,
        limit: 20,
        perPage: 20,
        refineActive: true,
        lastPage: 6,
      });
      expect(result.pages).toEqual([1, 2, 3, 4, 5]);
      expect(result.truncated).toBe(true);
    });
  });
});
