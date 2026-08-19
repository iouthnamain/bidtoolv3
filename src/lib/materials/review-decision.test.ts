import { describe, expect, it } from "vitest";

import {
  deriveMatchStatus,
  deriveReviewRowStatus,
  deserializeRowDecision,
  reconcileFetchedRowDecision,
  seedDecisionFromItem,
  serializeRowDecision,
  type RowDecision,
} from "~/lib/materials/review-decision";

describe("review-decision", () => {
  it("round-trips serialize and deserialize", () => {
    const decision: RowDecision = {
      materialId: 42,
      acceptedFields: new Set(["code", "unit", "specText"] as const),
      overwriteFields: new Set(["specText"]),
      editedValues: { manufacturer: "Acme" },
      webProposedFields: { originCountry: "VN" },
      webEvidence: [
        {
          field: "originCountry",
          value: "VN",
          snippet: "Made in VN",
          sourceUrl: "https://x",
        },
      ],
      webSearchStatus: "done",
      skipped: false,
    };

    const serialized = serializeRowDecision(decision);
    const restored = deserializeRowDecision(serialized);
    expect(restored).not.toBeNull();
    expect(restored!.materialId).toBe(42);
    expect(restored!.acceptedFields.has("unit")).toBe(true);
    expect(restored!.overwriteFields?.has("specText")).toBe(true);
    expect(restored!.editedValues?.manufacturer).toBe("Acme");
    expect(restored!.webProposedFields?.originCountry).toBe("VN");
    expect(restored!.webEvidence?.[0]?.snippet).toBe("Made in VN");
    expect(restored!.webSearchStatus).toBe("done");
  });

  it("round-trips profile split web and AI fields", () => {
    const decision: RowDecision = {
      materialId: null,
      acceptedFields: new Set<"unit">(["unit"]),
      webLinkResults: [
        {
          title: "Product page",
          url: "https://example.com/p",
          domain: "example.com",
          snippet: "Specs here",
          query: "widget",
          rankScore: 0.9,
          baseRankScore: 0.7,
          rrfScore: 0.031,
          fetchStatus: "verified",
          provider: "searxng",
          engines: ["bing", "yep"],
          matchedQueries: [{ query: "widget", intent: "general", rank: 1 }],
        },
      ],
      webLinksStatus: "done",
      aiSearchResult: {
        fields: { manufacturer: "Acme" },
        sourceUrls: ["https://example.com/p"],
        evidence: [
          {
            field: "manufacturer",
            value: "Acme",
            snippet: "By Acme",
            sourceUrl: "https://example.com/p",
          },
        ],
      },
      aiSearchStatus: "done",
      selectedSource: "ai",
      selectedSearchCandidateKey: "ai:0",
      aiSearchCandidates: [
        {
          fields: { manufacturer: "Acme" },
          sourceUrls: ["https://example.com/p"],
          evidence: [
            {
              field: "manufacturer",
              value: "Acme",
              snippet: "By Acme",
              sourceUrl: "https://example.com/p",
            },
          ],
          title: "Acme product",
          url: "https://example.com/p",
          rankScore: 0.88,
        },
        {
          fields: { manufacturer: "Beta" },
          sourceUrls: ["https://example.com/b"],
          evidence: [],
          url: "https://example.com/b",
          rankScore: 0.55,
        },
      ],
    };

    const restored = deserializeRowDecision({
      ...serializeRowDecision(decision),
      webScrapeResults: [
        {
          fields: {
            defaultUnitPrice: "1200000",
            sourceUrl: "https://example.com/p",
          },
          sourceUrls: ["https://example.com/p"],
          evidence: [],
          url: "https://example.com/p",
        },
      ],
    });
    expect(restored?.webLinkResults?.[0]?.url).toBe("https://example.com/p");
    expect(restored?.webLinkResults?.[0]).toMatchObject({
      provider: "searxng",
      engines: ["bing", "yep"],
      fetchStatus: "verified",
      rrfScore: 0.031,
      matchedQueries: [{ query: "widget", intent: "general", rank: 1 }],
    });
    expect(restored?.webLinksStatus).toBe("done");
    expect(restored?.aiSearchResult?.fields.manufacturer).toBe("Acme");
    expect(restored?.aiSearchCandidates?.length).toBe(2);
    expect(restored?.scrapeResults?.[0]?.fields.defaultUnitPrice).toBe(
      "1200000",
    );
    expect(serializeRowDecision(restored!)).not.toHaveProperty(
      "webScrapeResults",
    );
    expect(restored?.aiSearchStatus).toBe("done");
    expect(restored?.selectedSource).toBe("ai");
    expect(restored?.selectedSearchCandidateKey).toBe("ai:0");
  });

  it("refreshes server fields while preserving edits made during the fetch", () => {
    const requested: RowDecision = {
      materialId: null,
      acceptedFields: new Set(["sourceUrl"]),
      editedValues: { sourceUrl: "https://old.example/product" },
      webLinkResults: [
        {
          title: "Old",
          url: "https://old.example/product",
          domain: "old.example",
          snippet: "Old result",
        },
      ],
      selectedSearchCandidateKey: "web:https://old.example/product",
    };
    const current: RowDecision = {
      ...requested,
      editedValues: {
        ...requested.editedValues,
        manufacturer: "Acme local",
      },
    };
    const remote: RowDecision = {
      ...requested,
      editedValues: {
        sourceUrl: "https://old.example/product",
        unit: "bộ",
      },
      webLinkResults: [
        {
          title: "New",
          url: "https://new.example/product",
          domain: "new.example",
          snippet: "New result",
        },
      ],
      webLinksStatus: "done",
    };

    const reconciled = reconcileFetchedRowDecision({
      requested,
      current,
      remote,
    });

    expect(reconciled.editedValues?.manufacturer).toBe("Acme local");
    expect(reconciled.editedValues?.unit).toBe("bộ");
    expect(reconciled.webLinkResults?.[0]?.title).toBe("New");
    expect(reconciled.webLinksStatus).toBe("done");
    expect(reconciled.selectedSearchCandidateKey).toBe(
      "web:https://old.example/product",
    );
  });

  it("preserves a source switch made while server results refresh", () => {
    const requested: RowDecision = {
      materialId: null,
      acceptedFields: new Set(),
      selectedSource: "web",
      selectedSearchCandidateKey: "web:https://old.example/product",
    };
    const current: RowDecision = {
      ...requested,
      selectedSearchCandidateKey: "web:https://local.example/product",
    };
    const remote: RowDecision = {
      ...requested,
      selectedSearchCandidateKey: "web:https://remote.example/product",
      webLinksStatus: "done",
    };

    const reconciled = reconcileFetchedRowDecision({
      requested,
      current,
      remote,
    });

    expect(reconciled.selectedSearchCandidateKey).toBe(
      "web:https://local.example/product",
    );
    expect(reconciled.webLinksStatus).toBe("done");
  });

  it("keeps a valid local selection when the fetched snapshot predates persistence", () => {
    const localUrl = "https://local.example/product";
    const remoteUrl = "https://remote.example/product";
    const local: RowDecision = {
      materialId: null,
      acceptedFields: new Set(["sourceUrl"]),
      editedValues: { sourceUrl: localUrl },
      webProposedFields: { sourceUrl: localUrl },
      selectedSource: "web",
      selectedSearchCandidateKey: `web:${localUrl}`,
    };
    const remote: RowDecision = {
      materialId: null,
      acceptedFields: new Set(["sourceUrl"]),
      editedValues: { sourceUrl: remoteUrl },
      webProposedFields: { sourceUrl: remoteUrl },
      selectedSource: "web",
      selectedSearchCandidateKey: `web:${remoteUrl}`,
      webLinkResults: [
        {
          title: "Local candidate",
          url: localUrl,
          domain: "local.example",
          snippet: "Local",
        },
        {
          title: "Remote candidate",
          url: remoteUrl,
          domain: "remote.example",
          snippet: "Remote",
        },
      ],
      webLinksStatus: "done",
    };

    const reconciled = reconcileFetchedRowDecision({
      requested: local,
      current: local,
      remote,
    });

    expect(reconciled.selectedSearchCandidateKey).toBe(`web:${localUrl}`);
    expect(reconciled.editedValues?.sourceUrl).toBe(localUrl);
    expect(reconciled.webLinkResults).toEqual(remote.webLinkResults);
    expect(reconciled.webLinksStatus).toBe("done");
  });

  it("reuses the current decision when reconciliation makes no changes", () => {
    const current: RowDecision = {
      materialId: null,
      acceptedFields: new Set(["manufacturer"]),
      editedValues: { manufacturer: "Acme" },
    };

    const reconciled = reconcileFetchedRowDecision({
      requested: current,
      current,
      remote: {
        materialId: null,
        acceptedFields: new Set(["manufacturer"]),
        editedValues: { manufacturer: "Acme" },
      },
    });

    expect(reconciled).toBe(current);
  });

  it("reads legacy profile AI result when candidate array is missing", () => {
    const restored = deserializeRowDecision({
      materialId: null,
      acceptedFields: [],
      selectedSource: "ai",
      aiSearchStatus: "done",
      aiSearchResult: {
        fields: { manufacturer: "Acme" },
        sourceUrls: ["https://example.com/p"],
        evidence: [],
        url: "https://example.com/p",
      },
    });

    expect(restored?.aiSearchCandidates?.length).toBe(1);
    expect(restored?.aiSearchResult?.fields.manufacturer).toBe("Acme");
    expect(restored?.selectedSearchCandidateKey).toBe("ai:0");
  });

  it("round-trips profile-only name and image decisions", () => {
    const restored = deserializeRowDecision(
      serializeRowDecision({
        materialId: null,
        acceptedFields: new Set(),
        acceptedProfileFields: new Set(["name", "imageUrl"]),
        editedProfileValues: {
          name: "Máy bơm đã duyệt",
          imageUrl: "https://example.com/pump.jpg",
        },
      }),
    );
    expect(restored?.acceptedProfileFields).toEqual(
      new Set(["name", "imageUrl"]),
    );
    expect(restored?.editedProfileValues).toEqual({
      name: "Máy bơm đã duyệt",
      imageUrl: "https://example.com/pump.jpg",
    });
  });

  it("migrates a legacy active scrape into a product-specific draft", () => {
    const sourceUrl = "https://example.com/pump";
    const restored = deserializeRowDecision({
      materialId: null,
      acceptedFields: ["unit"],
      overwriteFields: ["unit"],
      editedValues: { unit: "bộ" },
      acceptedProfileFields: ["name"],
      editedProfileValues: { name: "Máy bơm đã sửa" },
      catalogPdfUrls: ["https://example.com/manual.pdf"],
      selectedSource: "web",
      selectedSearchCandidateKey: `web:${sourceUrl}`,
      scrapeResults: [
        {
          jobId: "legacy-job",
          shopScrapeJobId: null,
          sourceCandidateKey: `web:${sourceUrl}`,
          sourceUrl,
          sourceScore: 0.9,
          product: {
            name: "Máy bơm ABC",
            unit: "cái",
            category: null,
            specText: "IP68",
            manufacturer: null,
            originCountry: null,
            price: null,
            priceText: null,
            currency: "VND",
            sourceUrl,
            imageUrl: null,
            sku: "ABC-01",
            model: null,
            shopCategory: null,
            catalogPdfUrls: [],
          },
          fields: { unit: "cái", sourceUrl },
          name: "Máy bơm ABC",
          evidence: [],
          catalogPdfUrls: [],
          productMatchScore: null,
        },
      ],
    });

    const result = restored?.scrapeResults?.[0];
    expect(result?.productKey).toMatch(/^scrape:/);
    expect(restored?.selectedScrapeProductKey).toBe(result?.productKey);
    expect(result?.reviewDraft).toMatchObject({
      acceptedFields: ["unit"],
      overwriteFields: ["unit"],
      editedValues: { unit: "bộ" },
      acceptedProfileFields: ["name"],
      editedProfileValues: { name: "Máy bơm đã sửa" },
      catalogPdfUrls: ["https://example.com/manual.pdf"],
    });
  });

  it("round-trips an explicit null active scrape and ignores malformed drafts", () => {
    const restored = deserializeRowDecision({
      materialId: null,
      acceptedFields: [],
      selectedScrapeProductKey: null,
      scrapeResults: [
        {
          productKey: "scrape:one",
          jobId: "job",
          shopScrapeJobId: null,
          sourceCandidateKey: "web:https://example.com/p",
          sourceUrl: "https://example.com/p",
          sourceScore: null,
          product: {
            name: "P",
            unit: null,
            category: null,
            specText: "x",
            manufacturer: null,
            originCountry: null,
            price: null,
            priceText: null,
            currency: "VND",
            sourceUrl: "https://example.com/p",
            sku: null,
            model: null,
            shopCategory: null,
            catalogPdfUrls: [],
          },
          fields: { specText: "x" },
          name: "P",
          evidence: [],
          catalogPdfUrls: [],
          productMatchScore: null,
          reviewDraft: { acceptedFields: "invalid" },
        },
      ],
    });

    expect(restored?.selectedScrapeProductKey).toBeNull();
    expect(restored?.scrapeResults?.[0]?.reviewDraft).toBeUndefined();
    expect(serializeRowDecision(restored!).selectedScrapeProductKey).toBeNull();
  });

  it("seeds auto row from item materialId and fill plan", () => {
    const decision = seedDecisionFromItem({
      id: 1,
      originalRowIndex: 3,
      materialId: 10,
      matchStatus: "matched",
      reviewDecisionJson: {},
      enrichedSnapshotJson: {
        status: "auto",
        fillPlan: [
          { field: "unit", action: "filled" },
          { field: "code", action: "filled" },
        ],
      },
    });
    expect(decision.materialId).toBe(10);
    expect(decision.acceptedFields.has("unit")).toBe(true);
    expect(decision.acceptedFields.has("code")).toBe(true);
  });

  it("prefers stored reviewDecisionJson when present", () => {
    const stored = serializeRowDecision({
      materialId: 99,
      acceptedFields: new Set(["unit"]),
      skipped: true,
    });
    const decision = seedDecisionFromItem({
      id: 2,
      originalRowIndex: 5,
      materialId: 10,
      matchStatus: "matched",
      reviewDecisionJson: stored,
      enrichedSnapshotJson: { status: "auto", fillPlan: [] },
    });
    expect(decision.materialId).toBe(99);
    expect(decision.skipped).toBe(true);
  });

  it("derives match status for assign, skip, and auto confirm", () => {
    expect(
      deriveMatchStatus(
        { materialId: null, acceptedFields: new Set(), skipped: true },
        "unmatched",
        null,
      ),
    ).toBe("unmatched");

    expect(
      deriveMatchStatus(
        { materialId: 7, acceptedFields: new Set(["unit"]) },
        "auto",
        7,
      ),
    ).toBe("matched");

    expect(
      deriveMatchStatus(
        { materialId: 8, acceptedFields: new Set(["unit"]) },
        "auto",
        7,
      ),
    ).toBe("manual");

    expect(
      deriveMatchStatus(
        { materialId: null, acceptedFields: new Set() },
        "review",
        null,
      ),
    ).toBe("candidates_found");

    expect(
      deriveMatchStatus(
        {
          materialId: null,
          acceptedFields: new Set(["specText"]),
          editedValues: { specText: "PVC D90" },
        },
        "unmatched",
        null,
      ),
    ).toBe("manual");
  });

  it("derives review row status when a web/AI or catalog candidate is chosen", () => {
    expect(
      deriveReviewRowStatus(
        {
          materialId: 7,
          acceptedFields: new Set(["unit"]),
        },
        "auto",
        7,
      ),
    ).toBe("auto");

    expect(
      deriveReviewRowStatus(
        {
          materialId: 8,
          acceptedFields: new Set(["unit"]),
        },
        "auto",
        7,
      ),
    ).toBe("review");

    expect(
      deriveReviewRowStatus(
        {
          materialId: null,
          acceptedFields: new Set(["specText", "defaultUnitPrice", "currency"]),
          editedValues: {
            specText: "PVC D90",
            defaultUnitPrice: "120000",
            currency: "VND",
          },
        },
        "unmatched",
        null,
      ),
    ).toBe("review");

    expect(deriveReviewRowStatus(undefined, "unmatched", null)).toBe(
      "unmatched",
    );
  });

  it("seeds empty decisions for profile review until user chooses", () => {
    const decision = seedDecisionFromItem(
      {
        id: 1,
        originalRowIndex: 1,
        materialId: 42,
        matchStatus: "matched",
        enrichedSnapshotJson: {
          status: "auto",
          fillPlan: [{ field: "unit", action: "filled" }],
        },
        reviewDecisionJson: null,
      },
      { emptyUntilReview: true },
    );
    expect(decision.materialId).toBeNull();
    expect(decision.acceptedFields.size).toBe(0);
  });
});
