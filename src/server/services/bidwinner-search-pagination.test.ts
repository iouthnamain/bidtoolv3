import { afterEach, expect, it, vi } from "vitest";

import { searchBidWinnerLive } from "~/server/services/bidwinner-search";
import { fetchPublicContent } from "~/server/services/public-content-client";

vi.mock("~/server/services/app-settings", () => ({
  resolveBidwinnerBaseUrl: async () => "https://bidwinner.info",
  resolveBidwinnerTimeoutMs: async () => 100,
}));
vi.mock("~/server/services/bidwinner-page-cache", () => ({
  fetchHtmlWithCache: (_key: string, fetchHtml: () => Promise<string>) =>
    fetchHtml(),
}));
vi.mock("~/server/services/public-content-client", () => ({
  fetchPublicContent: vi.fn(),
}));

const transport = vi.mocked(fetchPublicContent);
const provinces = ["Hà Nội", "Đà Nẵng"];
const defaultSearch = {
  provinces,
  categories: [],
  minMatchScore: 0,
  sortBy: "publishedAt",
  sortOrder: "desc",
  offset: 0,
  limit: 1,
} satisfies Parameters<typeof searchBidWinnerLive>[0];

function item(id: number, title: string, day: number) {
  return {
    id,
    ten_goi_thau: title,
    thoi_diem_dang_tai: `2026-11-${String(day).padStart(2, "0")}T00:00:00Z`,
  };
}

function page(
  currentPage: number,
  lastPage: number,
  data: ReturnType<typeof item>[],
) {
  return {
    current_page: currentPage,
    last_page: lastPage,
    total: lastPage,
    per_page: 1,
    data,
  };
}

function mockPages(
  getPage: (province: string, pageNumber: number) => ReturnType<typeof page>,
) {
  const requested: string[] = [];
  transport.mockImplementation(async ({ url }) => {
    const target = new URL(url);
    const province = target.searchParams.get("matp");
    const number = Number(target.searchParams.get("page"));
    const payload = province ? getPage(province, number) : page(1, 1, []);
    if (province) requested.push(`${province}:${number}`);
    const encode = (value: unknown) =>
      JSON.stringify(value).replaceAll('"', "&quot;");
    const body = Buffer.from(
      `<bid-search :hsmts="${encode(payload)}" :ttp="${encode([
        { matp: 1, ten_tinh: "Hà Nội" },
        { matp: 2, ten_tinh: "Đà Nẵng" },
      ])}" />`,
    );
    return {
      status: 200,
      body,
      finalUrl: target.href,
      contentType: "text/html",
    };
  });
  return requested;
}

afterEach(() => {
  vi.resetAllMocks();
});

it("finds matches beyond the first merged page and paginates the filtered results", async () => {
  mockPages((province, number) => {
    if (province === "1") {
      return number === 1
        ? page(1, 2, [item(1, "Máy tính", 6)])
        : page(2, 2, [item(3, "Máy bơm", 4)]);
    }
    return number === 1
      ? page(1, 2, [item(2, "Máy in", 5)])
      : page(2, 2, [item(4, "Máy bơm", 3)]);
  });
  const input = { ...defaultSearch, keyword: "máy bơm" };

  await expect(searchBidWinnerLive(input)).resolves.toMatchObject({
    items: [{ id: 3 }],
    total: 2,
    visibleCount: 2,
    scannedCount: 4,
    windowTruncated: false,
  });
  await expect(
    searchBidWinnerLive({ ...input, offset: 1 }),
  ).resolves.toMatchObject({
    items: [{ id: 4 }],
    total: 2,
    visibleCount: 2,
    scannedCount: 4,
    windowTruncated: false,
  });
});

it.each([true, false])(
  "stops a repeating upstream page when current_page is stale = %s",
  async (stalePageNumber) => {
    let repeatRequests = 0;
    const requested = mockPages((province, number) => {
      if (province === "2") return page(1, 1, [item(4, "Máy bơm", 1)]);
      if (number === 1) return page(1, 3, [item(1, "Máy tính", 6)]);
      if (number === 2 && repeatRequests++ === 0) {
        return page(stalePageNumber ? 1 : 2, 3, [item(1, "Máy tính", 6)]);
      }
      return page(number, 3, [item(3, "Máy bơm", 4)]);
    });

    await expect(
      searchBidWinnerLive({ ...defaultSearch, limit: 2 }),
    ).resolves.toMatchObject({
      items: [{ id: 1 }],
      total: 1,
      windowTruncated: true,
    });
    expect(requested).toHaveLength(3);
    expect(requested).toContain("1:2");
  },
);

it("keeps the existing five-page refinement window per province", async () => {
  const requested = mockPages((province, number) =>
    page(number, 100_000, [
      item(Number(province) * 10 + number, "Máy bơm", 20 - number),
    ]),
  );

  await expect(
    searchBidWinnerLive({ ...defaultSearch, keyword: "máy bơm" }),
  ).resolves.toMatchObject({
    total: 10,
    visibleCount: 10,
    scannedCount: 10,
    windowTruncated: true,
  });
  expect(requested).toHaveLength(10);
});

it("limits how far an unfiltered merge follows a province's upstream pages", async () => {
  const requested = mockPages((province, number) =>
    province === "1"
      ? page(number, 100_000, [item(number, "Máy bơm", 26)])
      : page(1, 1, [item(102, "Máy bơm", 1)]),
  );

  await expect(
    searchBidWinnerLive({ ...defaultSearch, offset: 19, limit: 3 }),
  ).resolves.toMatchObject({
    items: [{ id: 20 }],
    total: 20,
    scannedCount: 20,
    windowTruncated: true,
  });
  expect(requested).toHaveLength(21);
  expect(requested).not.toContain("1:21");
});
