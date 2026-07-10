import { describe, expect, it } from "vitest";

import {
  MATERIAL_PROFILE_CLEAN_EXPORT_COLUMNS,
  MATERIAL_PROFILE_REQUIRED_IDENTITY_FIELDS,
  createMaterialProfileGeneratedCode,
  createMaterialProfileProductFingerprint,
  createMaterialProfileSourceFingerprint,
  toMaterialProfileCleanExportRow,
  validateMaterialProfileInput,
  validateMaterialProfileResolution,
} from "~/lib/materials/profile-input-contract";

const CLEAN_EXPORT_HEADERS = [
  "Mã vật tư",
  "Tên vật tư",
  "ĐVT",
  "Thông số kỹ thuật",
  "Nhà sản xuất",
  "Xuất xứ",
  "Đơn giá",
  "Nguồn",
  "URL catalog",
  "Độ tin cậy",
  "Trạng thái",
];

function validInput(overrides = {}) {
  return {
    name: "Dây điện đơn mềm VCm 0.5mm2",
    unit: "m",
    specText: "VCm 0.5 mm², ruột đồng mềm",
    rowIndex: 12,
    sourceValues: {
      "Số lượng": "100",
      "Nhóm vật tư": "Dây cáp điện",
      NCC: "CADIVI",
    },
    ...overrides,
  };
}

function completeCandidate(overrides = {}) {
  return {
    code: "CADIVI-VCM-05",
    name: "Dây điện đơn mềm VCm 0.5mm2",
    unit: "m",
    specText: "VCm 0.5 mm², ruột đồng mềm",
    manufacturer: "CADIVI",
    originCountry: "Việt Nam",
    unitPrice: 5000,
    source: "Catalog CADIVI",
    sourceUrl: "https://cadivi.vn/day-dien-vcm-05",
    catalogUrl: "https://cadivi.vn/catalog/vcm-05.pdf",
    evidenceUrls: ["https://cadivi.vn/catalog/vcm-05.pdf"],
    confidence: 0.93,
    provenance: "catalog",
    ...overrides,
  };
}

describe("material profile input contract", () => {
  it("uses the three required profile-only identity fields and preserves optional source context", () => {
    expect(MATERIAL_PROFILE_REQUIRED_IDENTITY_FIELDS).toEqual([
      "Tên vật tư",
      "ĐVT",
      "Thông số kỹ thuật",
    ]);

    expect(
      validateMaterialProfileInput(validInput({ sourceValues: undefined })),
    ).toMatchObject({
      valid: true,
      missingFields: [],
    });
    expect(
      validateMaterialProfileInput(
        validInput({ name: "  ", unit: "", specText: "\n" }),
      ),
    ).toMatchObject({
      valid: false,
      missingFields: ["Tên vật tư", "ĐVT", "Thông số kỹ thuật"],
    });
  });

  it("makes source-row fingerprints deterministic across harmless formatting while retaining row identity", () => {
    const original = validInput();
    const formattedAgain = validInput({
      name: "  dây điện đơn mềm vcm 0.5mm2  ",
      unit: " M ",
      specText: "VCm 0.5 mm²,  ruột đồng mềm",
      sourceValues: { "Số lượng": "999", "Nhóm vật tư": "Khác" },
    });

    expect(createMaterialProfileSourceFingerprint(original)).toBe(
      createMaterialProfileSourceFingerprint(formattedAgain),
    );
    expect(
      createMaterialProfileSourceFingerprint(validInput({ rowIndex: 13 })),
    ).not.toBe(createMaterialProfileSourceFingerprint(original));
    expect(createMaterialProfileProductFingerprint(formattedAgain)).toBe(
      createMaterialProfileProductFingerprint(original),
    );
  });

  it("automatically promotes only a complete, compatible, evidenced and confident result", () => {
    expect(
      validateMaterialProfileResolution({
        input: validInput(),
        candidate: completeCandidate(),
      }),
    ).toMatchObject({
      complete: true,
      promotable: true,
      status: "saved",
      reasons: [],
    });

    const lowConfidence = validateMaterialProfileResolution({
      input: validInput(),
      candidate: completeCandidate({ confidence: 0.84 }),
    });
    expect(lowConfidence).toMatchObject({
      complete: true,
      promotable: false,
      status: "needs_verification",
    });
    expect(lowConfidence.reasons.length).toBeGreaterThan(0);

    expect(
      validateMaterialProfileResolution({
        input: validInput(),
        candidate: completeCandidate({ catalogUrl: "", originCountry: "" }),
      }),
    ).toMatchObject({
      complete: false,
      promotable: false,
      status: "needs_verification",
    });

    expect(
      validateMaterialProfileResolution({
        input: validInput(),
        candidate: completeCandidate({ unit: "kg" }),
      }),
    ).toMatchObject({
      promotable: false,
      status: "needs_verification",
    });

    expect(
      validateMaterialProfileResolution({
        input: validInput(),
        candidate: completeCandidate({ catalogUrl: "catalog-vcm-05.pdf" }),
      }),
    ).toMatchObject({
      promotable: false,
      status: "needs_verification",
    });
  });

  it("assigns a stable generated code with generated provenance only to valid code-less results", () => {
    const input = validInput();
    const generated = createMaterialProfileGeneratedCode(input);
    expect(generated).toMatch(/^BT-/);
    expect(createMaterialProfileGeneratedCode(input)).toBe(generated);
    expect(
      createMaterialProfileGeneratedCode(validInput({ rowIndex: 99 })),
    ).toBe(generated);

    const resolved = validateMaterialProfileResolution({
      input,
      candidate: completeCandidate({ code: undefined, provenance: undefined }),
    });
    expect(resolved.candidate).toMatchObject({
      code: generated,
      provenance: "generated",
      codeProvenance: "generated",
    });
    expect(resolved.promotable).toBe(true);

    const invalid = validateMaterialProfileResolution({
      input: validInput({ specText: "" }),
      candidate: completeCandidate({ code: undefined }),
    });
    expect(invalid).toMatchObject({
      promotable: false,
      status: "needs_verification",
    });
    expect(invalid.candidate.code ?? "").not.toMatch(/^BT-/);
  });

  it("emits exactly the eleven canonical export columns and uses the catalog URL, never a filename", () => {
    expect(MATERIAL_PROFILE_CLEAN_EXPORT_COLUMNS).toEqual(CLEAN_EXPORT_HEADERS);

    const input = validInput();
    const candidate = completeCandidate({
      catalogUrl: "https://cadivi.vn/catalog/vcm-05.pdf",
      sourceUrl: "https://cadivi.vn/day-dien-vcm-05",
    });
    const resolution = validateMaterialProfileResolution({ input, candidate });
    const row = toMaterialProfileCleanExportRow({
      input,
      candidate,
      resolution,
    });

    expect(Object.keys(row)).toEqual(CLEAN_EXPORT_HEADERS);
    expect(row).toMatchObject({
      "Mã vật tư": "CADIVI-VCM-05",
      "Tên vật tư": "Dây điện đơn mềm VCm 0.5mm2",
      ĐVT: "m",
      "Thông số kỹ thuật": "VCm 0.5 mm², ruột đồng mềm",
      "Nhà sản xuất": "CADIVI",
      "Xuất xứ": "Việt Nam",
      "Đơn giá": 5000,
      Nguồn: "Catalog CADIVI",
      "URL catalog": "https://cadivi.vn/catalog/vcm-05.pdf",
      "Trạng thái": "Đã lưu",
    });
    expect(row["URL catalog"]).not.toBe("vcm-05.pdf");
  });
});
