import { describe, expect, it } from "vitest";

import {
  activateProfileCandidateCapture,
  mergeProfileCandidateCapture,
  storeProfileCandidateCapture,
} from "~/lib/materials/profile-candidate-capture";
import {
  buildMaterialProfileProposal,
  incompleteProfileMaterialFields,
  isMaterialProfileCatalogSnapshotCurrent,
  isMaterialProfileUndoVersionCurrent,
  pickProfileTargetWinner,
  profileMaterialTargetScore,
  unionProfileCatalogUrls,
  type ProfileMaterialProposal,
} from "~/server/services/material-profile-material-batches";

const complete: ProfileMaterialProposal = {
  code: "BT-01",
  name: "Máy bơm Acme",
  unit: "cái",
  category: "Máy",
  specText: "IP68 220V",
  manufacturer: "Acme",
  originCountry: "Việt Nam",
  defaultUnitPrice: 1_000_000,
  currency: "VND",
  sourceUrl: "https://shop.test/pump",
  imageUrl: "",
  catalogPdfUrls: ["https://shop.test/catalog.pdf"],
  acceptedFields: [],
  acceptedProfileFields: [],
};

describe("material profile save batch policy", () => {
  it("builds a save proposal from only the active retained product", () => {
    const firstSource = {
      title: "Sản phẩm A",
      url: "https://shop.test/a",
      domain: "shop.test",
      snippet: "A",
    };
    const secondSource = {
      ...firstSource,
      title: "Sản phẩm B",
      url: "https://shop.test/b",
    };
    const product = {
      name: "Sản phẩm A",
      unit: "cái",
      category: null,
      specText: "Thông số A",
      manufacturer: null,
      originCountry: null,
      price: null,
      priceText: null,
      currency: "VND",
      sourceUrl: firstSource.url,
      sku: "A-01",
      model: null,
      shopCategory: null,
      catalogPdfUrls: [],
    };
    const first = mergeProfileCandidateCapture(
      {
        materialId: null,
        acceptedFields: new Set(),
        webLinkResults: [firstSource, secondSource],
      },
      firstSource,
      product,
    )!;
    const second = storeProfileCandidateCapture(first.decision, secondSource, {
      ...product,
      name: "Sản phẩm B",
      specText: "Thông số B",
      sourceUrl: secondSource.url,
      sku: "B-01",
    })!;
    const activeSecond = activateProfileCandidateCapture(
      second.decision,
      second.productKey,
    )!;
    const item = {
      productName: "Tên trên dòng",
      unit: "",
      specText: "",
      vendorHint: null,
      originHint: null,
      unitPrice: null,
      currency: "VND",
      originalDataJson: {},
    } as Parameters<typeof buildMaterialProfileProposal>[0];

    const proposal = buildMaterialProfileProposal(item, activeSecond);
    expect(proposal.name).toBe("Sản phẩm B");
    expect(proposal.code).toBe("B-01");
    expect(proposal.sourceUrl).toBe(secondSource.url);
  });

  it("allows optional enrichment fields to be missing", () => {
    expect(incompleteProfileMaterialFields(complete)).toEqual([]);
    expect(
      incompleteProfileMaterialFields({
        ...complete,
        manufacturer: "",
        originCountry: "",
        defaultUnitPrice: null,
        catalogPdfUrls: [],
      }),
    ).toEqual([]);
  });

  it("blocks records missing required material fields", () => {
    expect(
      incompleteProfileMaterialFields({
        ...complete,
        code: "",
        sourceUrl: "",
      }),
    ).toEqual(["mã vật tư", "URL nguồn"]);
  });

  it("uses the 85% fuzzy target threshold", () => {
    expect(
      profileMaterialTargetScore(complete, {
        name: complete.name,
        specText: complete.specText,
      }),
    ).toBe(1);
    expect(
      profileMaterialTargetScore(complete, {
        name: "Cáp điện",
        specText: "Cu/PVC",
      }),
    ).toBeLessThan(0.85);
  });

  it("picks the highest target score and uses the lowest row index for ties", () => {
    expect(
      pickProfileTargetWinner([
        { id: "later", targetScore: 0.9, originalRowIndex: 12 },
        { id: "lower", targetScore: 0.89, originalRowIndex: 1 },
        { id: "winner", targetScore: 0.9, originalRowIndex: 3 },
      ])?.id,
    ).toBe("winner");
  });

  it("unions and canonicalizes catalog URLs", () => {
    expect(
      unionProfileCatalogUrls(
        ["https://shop.test/catalog.pdf?b=2&a=1"],
        ["https://shop.test/catalog.pdf?a=1&b=2", "https://x.test/a.pdf"],
      ),
    ).toEqual([
      "https://shop.test/catalog.pdf?b=2&a=1",
      "https://x.test/a.pdf",
    ]);
  });

  it("blocks undo when a material or workspace-item version changed", () => {
    const committed = "2026-07-11T12:00:00.000Z";

    expect(isMaterialProfileUndoVersionCurrent(committed, committed)).toBe(
      true,
    );
    expect(
      isMaterialProfileUndoVersionCurrent(
        "2026-07-11T12:01:00.000Z",
        committed,
      ),
    ).toBe(false);
    expect(isMaterialProfileUndoVersionCurrent(null, committed)).toBe(false);
    expect(isMaterialProfileUndoVersionCurrent(committed, null)).toBe(false);
  });

  it("blocks undo when catalog links changed after commit", () => {
    const committed = [
      { link: { documentId: 3, linkSource: "scrape" } },
      { link: { documentId: 1, linkSource: "manual" } },
    ];

    expect(
      isMaterialProfileCatalogSnapshotCurrent(
        [...committed].reverse(),
        committed,
      ),
    ).toBe(true);
    expect(
      isMaterialProfileCatalogSnapshotCurrent(
        [...committed, { link: { documentId: 4, linkSource: "manual" } }],
        committed,
      ),
    ).toBe(false);
    expect(isMaterialProfileCatalogSnapshotCurrent([], null)).toBe(false);
  });
});
