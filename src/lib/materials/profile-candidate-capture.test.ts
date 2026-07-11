import { describe, expect, it } from "vitest";

import type { WebLinkResult } from "~/lib/materials/enrich-gap-fill";
import type { RowDecision } from "~/lib/materials/review-decision";
import {
  findProfileScrapedProduct,
  mergeProfileCandidateCapture,
  profileCandidateCaptureKey,
  profileCandidateSearchGeneration,
  profileCandidateSourceMatches,
  type ProfileScrapedProduct,
} from "~/lib/materials/profile-candidate-capture";

const source: WebLinkResult = {
  title: "Máy bơm ABC",
  url: "https://example.com/pump",
  domain: "example.com",
  snippet: "Thông tin sản phẩm",
  rankScore: 0.9,
};

const product: ProfileScrapedProduct = {
  name: "Máy bơm ABC chính hãng",
  unit: "cái",
  category: "Máy công nghiệp",
  specText: "IP68",
  manufacturer: "ABC",
  originCountry: "Việt Nam",
  price: 1_200_000,
  priceText: "1.200.000 ₫",
  currency: "VND",
  sourceUrl: source.url,
  sku: "ABC-01",
  model: null,
  shopCategory: null,
  catalogPdfUrls: ["https://example.com/catalog.pdf"],
};

const baseDecision: RowDecision = {
  materialId: null,
  acceptedFields: new Set(),
  webLinkResults: [source],
  webLinksStatus: "done",
  selectedSearchCandidateKey: profileCandidateCaptureKey(source.url),
};

describe("profile candidate shop scrape", () => {
  it("rejects a scrape without usable product details or a catalog PDF", () => {
    expect(
      mergeProfileCandidateCapture(baseDecision, source, {
        ...product,
        unit: null,
        category: null,
        specText: "",
        manufacturer: null,
        originCountry: null,
        price: null,
        priceText: null,
        sku: null,
        model: null,
        shopCategory: null,
        catalogPdfUrls: [],
      }),
    ).toBeNull();
  });

  it("selects and applies every scraped field without creating an AI result", () => {
    const merged = mergeProfileCandidateCapture(
      { ...baseDecision, materialId: 42 },
      source,
      product,
    );

    expect(merged?.candidateKey).toBe(`web:${source.url}`);
    expect(merged?.decision.acceptedFields).toEqual(
      new Set([
        "code",
        "unit",
        "category",
        "specText",
        "manufacturer",
        "originCountry",
        "defaultUnitPrice",
        "currency",
        "sourceUrl",
      ]),
    );
    expect(merged?.decision.editedValues?.currency).toBe("VND");
    expect(merged?.decision.aiSearchResult).toBeUndefined();
    expect(merged?.decision.aiSearchCandidates).toBeUndefined();
    expect(merged?.decision.scrapeResults).toHaveLength(1);
    expect(merged?.decision.materialId).toBe(42);
  });

  it("replaces the same-source scrape and preserves omitted values and row state", () => {
    const previous = mergeProfileCandidateCapture(
      baseDecision,
      source,
      product,
    )!.candidate;
    const decision: RowDecision = {
      ...baseDecision,
      skipped: true,
      editedValues: { category: "Máy công nghiệp" },
      catalogPdfUrls: ["https://example.com/manual.pdf"],
      scrapeResults: [
        previous,
        {
          ...previous,
          sourceCandidateKey: "web:https://other.example/item",
          sourceUrl: "https://other.example/item",
          product: {
            ...previous.product,
            sourceUrl: "https://other.example/item",
          },
          fields: { code: "OTHER" },
          evidence: [],
        },
      ],
    };
    const merged = mergeProfileCandidateCapture(decision, source, {
      ...product,
      unit: null,
      category: null,
      manufacturer: null,
      originCountry: null,
      price: null,
      priceText: null,
      sku: null,
      catalogPdfUrls: [],
    });

    expect(merged?.decision.scrapeResults).toHaveLength(2);
    expect(merged?.candidate.fields).toMatchObject({
      manufacturer: "ABC",
      unit: "cái",
      category: "Máy công nghiệp",
      specText: "IP68",
    });
    expect(merged?.candidate.catalogPdfUrls).toEqual([
      "https://example.com/catalog.pdf",
    ]);
    expect(merged?.decision.catalogPdfUrls).toEqual([
      "https://example.com/manual.pdf",
      "https://example.com/catalog.pdf",
    ]);
    expect(merged?.decision.skipped).toBe(true);
    expect(merged?.decision.webLinksStatus).toBe("done");
  });

  it("keeps AI fields out of the stored scrape snapshot", () => {
    const decision: RowDecision = {
      ...baseDecision,
      selectedSource: "ai",
      selectedSearchCandidateKey: "ai:0",
      acceptedFields: new Set(["manufacturer"]),
      editedValues: { manufacturer: "AI Corp" },
      webProposedFields: { manufacturer: "AI Corp" },
      aiSearchCandidates: [
        {
          fields: { manufacturer: "AI Corp" },
          sourceUrls: [source.url],
          evidence: [],
        },
      ],
    };
    const merged = mergeProfileCandidateCapture(decision, source, {
      ...product,
      manufacturer: null,
    });

    expect(merged?.candidate.fields.manufacturer).toBeUndefined();
    expect(merged?.decision.webProposedFields?.manufacturer).toBeUndefined();
    expect(merged?.decision.aiSearchCandidates?.[0]?.fields.manufacturer).toBe(
      "AI Corp",
    );
  });

  it("keeps manual edits as an overlay instead of relabeling them as scrape", () => {
    const decision: RowDecision = {
      ...baseDecision,
      selectedSource: "web",
      acceptedFields: new Set(["manufacturer"]),
      editedValues: { manufacturer: "Nhà sản xuất đã sửa" },
      webProposedFields: { manufacturer: "ABC" },
    };
    const merged = mergeProfileCandidateCapture(decision, source, product);

    expect(merged?.candidate.fields.manufacturer).toBe("ABC");
    expect(merged?.decision.webProposedFields?.manufacturer).toBe("ABC");
    expect(merged?.decision.editedValues?.manufacturer).toBe(
      "Nhà sản xuất đã sửa",
    );
  });

  it("matches the requested URL after harmless canonical URL differences", () => {
    expect(
      findProfileScrapedProduct(
        [
          { ...product, sourceUrl: "https://other.example/item" },
          { ...product, sourceUrl: `${source.url}/#details` },
        ],
        source.url,
      )?.sourceUrl,
    ).toBe(`${source.url}/#details`);
  });

  it("does not silently use an unrelated first product", () => {
    expect(
      findProfileScrapedProduct(
        [
          {
            ...product,
            name: "Sản phẩm khác",
            sourceUrl: "https://example.com/other",
          },
        ],
        source.url,
        { title: source.title, name: "Máy bơm ABC" },
      ),
    ).toBeUndefined();
  });

  it("accepts one unambiguous same-shop title match after a redirect", () => {
    expect(
      findProfileScrapedProduct(
        [
          { ...product, sourceUrl: "https://example.com/canonical-pump" },
          {
            ...product,
            name: "Van công nghiệp",
            sourceUrl: "https://example.com/valve",
          },
        ],
        source.url,
        { title: source.title, name: "Máy bơm ABC" },
      )?.sourceUrl,
    ).toBe("https://example.com/canonical-pump");
  });

  it("matches duplicate scrape jobs with the server URL identity", () => {
    expect(
      profileCandidateSourceMatches(
        "https://EXAMPLE.com/pump/?b=2&a=1#details",
        "https://example.com/pump?a=1&b=2",
      ),
    ).toBe(true);
    expect(
      profileCandidateSourceMatches(
        "http://example.com/pump",
        "https://example.com/pump",
      ),
    ).toBe(false);
  });

  it("detects changed search results but ignores unrelated operator edits", () => {
    const decision: RowDecision = {
      ...baseDecision,
      aiSearchCandidates: [
        {
          fields: { manufacturer: "ABC" },
          sourceUrls: [source.url],
          evidence: [],
          url: source.url,
        },
      ],
    };
    const generation = profileCandidateSearchGeneration(decision);

    expect(
      profileCandidateSearchGeneration({
        ...decision,
        editedValues: { category: "Máy công nghiệp" },
      }),
    ).toBe(generation);
    expect(
      profileCandidateSearchGeneration({
        ...decision,
        webLinkResults: [{ ...source, url: "https://example.com/new" }],
      }),
    ).not.toBe(generation);
  });
});
