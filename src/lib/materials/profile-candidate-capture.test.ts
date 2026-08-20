import { describe, expect, it } from "vitest";

import type { WebLinkResult } from "~/lib/materials/enrich-gap-fill";
import type { RowDecision } from "~/lib/materials/review-decision";
import {
  activateProfileCandidateCapture,
  findProfileScrapedProduct,
  mergeProfileCandidateCapture,
  profileCandidateCaptureKey,
  profileCandidateSearchGeneration,
  profileCandidateSourceMatches,
  removeProfileCandidateCapture,
  storeProfileCandidateCapture,
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

  it("refreshes the same product without duplicating it", () => {
    const first = mergeProfileCandidateCapture(baseDecision, source, product)!;
    const previous = first.decision.scrapeResults![0]!;
    const decision: RowDecision = {
      ...baseDecision,
      selectedSource: "web",
      selectedScrapeProductKey: previous.productKey,
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
    ]);
    expect(merged?.decision.skipped).toBe(true);
    expect(merged?.decision.webLinksStatus).toBe("done");
  });

  it("retains two products from the same source", () => {
    const first = storeProfileCandidateCapture(baseDecision, source, product)!;
    const second = storeProfileCandidateCapture(first.decision, source, {
      ...product,
      name: "Máy bơm ABC bản công suất lớn",
      sku: "ABC-02",
      sourceUrl: `${source.url}#abc-02`,
    });

    expect(second?.decision.scrapeResults).toHaveLength(2);
    expect(
      new Set(second?.decision.scrapeResults?.map((item) => item.productKey))
        .size,
    ).toBe(2);
  });

  it("starts a newly selected product from its own scraped fields", () => {
    const first = mergeProfileCandidateCapture(baseDecision, source, product)!;
    const secondProduct: ProfileScrapedProduct = {
      ...product,
      name: "Máy bơm ABC bản công suất lớn",
      unit: "bộ",
      price: 2_400_000,
      priceText: "2.400.000 ₫",
      sku: "ABC-02",
    };
    const secondStored = storeProfileCandidateCapture(
      first.decision,
      source,
      secondProduct,
    )!;
    const second = activateProfileCandidateCapture(
      secondStored.decision,
      secondStored.productKey,
    )!;

    expect(second.editedValues?.unit).toBe("bộ");
    expect(second.editedValues?.defaultUnitPrice).toBe("2400000");
  });

  it("activates a newly retained web product with its product profile", () => {
    const stored = storeProfileCandidateCapture(
      {
        ...baseDecision,
        selectedSource: "web",
        acceptedProfileFields: new Set(["name"]),
        editedProfileValues: { name: "Tên fallback chưa được chấp nhận" },
      },
      source,
      product,
    )!;
    const activated = activateProfileCandidateCapture(
      stored.decision,
      stored.productKey,
    )!;

    expect(activated.acceptedProfileFields).toContain("name");
    const activeProduct = activated.scrapeResults?.find(
      (result) => result.productKey === activated.selectedScrapeProductKey,
    );
    const effectiveName =
      activated.editedProfileValues?.name ?? activeProduct?.name;
    expect(effectiveName).toBe(product.name);
  });

  it("stores background results without stealing active focus", () => {
    const active = mergeProfileCandidateCapture(baseDecision, source, product)!;
    const background = storeProfileCandidateCapture(
      {
        ...active.decision,
        editedValues: { ...active.decision.editedValues, unit: "bộ" },
      },
      source,
      {
        ...product,
        name: "Máy bơm ABC dự phòng",
        sku: "ABC-03",
      },
    )!;

    expect(background.decision.selectedScrapeProductKey).toBe(
      active.productKey,
    );
    expect(background.decision.editedValues?.unit).toBe("bộ");
  });

  it("switches products with separate complete drafts", () => {
    const first = mergeProfileCandidateCapture(baseDecision, source, product)!;
    const secondStored = storeProfileCandidateCapture(
      {
        ...first.decision,
        editedValues: { ...first.decision.editedValues, unit: "bộ A" },
        editedProfileValues: { name: "Tên A" },
        catalogPdfUrls: ["https://example.com/a.pdf"],
      },
      source,
      { ...product, name: "Máy bơm B", sku: "B-01" },
    )!;
    const second = activateProfileCandidateCapture(
      secondStored.decision,
      secondStored.productKey,
    )!;
    const editedSecond: RowDecision = {
      ...second,
      editedValues: { ...second.editedValues, unit: "bộ B" },
      editedProfileValues: { name: "Tên B" },
      catalogPdfUrls: ["https://example.com/b.pdf"],
    };
    const restoredFirst = activateProfileCandidateCapture(
      editedSecond,
      first.productKey,
    )!;
    const restoredSecond = activateProfileCandidateCapture(
      restoredFirst,
      secondStored.productKey,
    )!;

    expect(restoredFirst.editedValues?.unit).toBe("bộ A");
    expect(restoredFirst.editedProfileValues?.name).toBe("Tên A");
    expect(restoredFirst.catalogPdfUrls).toEqual(["https://example.com/a.pdf"]);
    expect(restoredSecond.editedValues?.unit).toBe("bộ B");
    expect(restoredSecond.editedProfileValues?.name).toBe("Tên B");
  });

  it("removes inactive and active products without selecting a fallback", () => {
    const first = mergeProfileCandidateCapture(baseDecision, source, product)!;
    const second = storeProfileCandidateCapture(first.decision, source, {
      ...product,
      name: "Máy bơm B",
      sku: "B-01",
    })!;
    const withoutInactive = removeProfileCandidateCapture(
      second.decision,
      second.productKey,
    );
    expect(withoutInactive.selectedScrapeProductKey).toBe(first.productKey);
    expect(withoutInactive.editedValues).toEqual(first.decision.editedValues);

    const withoutActive = removeProfileCandidateCapture(
      second.decision,
      first.productKey,
    );
    expect(withoutActive.selectedScrapeProductKey).toBeNull();
    expect(withoutActive.acceptedFields.size).toBe(0);
    expect(withoutActive.scrapeResults?.map((item) => item.productKey)).toEqual(
      [second.productKey],
    );
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
