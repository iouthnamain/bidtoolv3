import { describe, expect, it, vi } from "vitest";

const fetchPublicContent = vi.hoisted(() => vi.fn());
vi.mock("~/server/services/public-content-client", () => ({
  fetchPublicContent,
}));

import { fetchPriceFromUrl } from "./material-price-sources";

describe("fetchPriceFromUrl", () => {
  it("reads prices through the bounded public text boundary", async () => {
    fetchPublicContent.mockResolvedValueOnce({
      status: 200,
      finalUrl: "https://prices.example/item",
      contentType: "text/html; charset=utf-8",
      body: Buffer.from(
        "<html><body>Ống PVC D90 giá 125.000 đ/m</body></html>",
      ),
    });

    const result = await fetchPriceFromUrl("https://prices.example/item");

    expect(result.priceText).toContain("125.000");
    expect(result.price).toBe(125000);
    expect(fetchPublicContent).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://prices.example/item",
        kind: "text",
        timeoutMs: 12_000,
      }),
    );
  });
});
