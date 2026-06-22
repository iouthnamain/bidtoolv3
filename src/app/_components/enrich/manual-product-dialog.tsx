"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";

import { Button } from "~/app/_components/ui";
import { useToast } from "~/app/_components/ui/toast";
import type { EnrichCandidate } from "~/app/_components/enrich/product-candidate-card";
import {
  candidateToFields,
  FIELD_LABELS,
  FILLABLE_FIELDS,
  NON_COLUMN_FIELDS,
  type FillableField,
} from "~/lib/materials/excel-enrich-fields";
import { parseOptionalNumber } from "~/lib/materials/format";
import { api } from "~/trpc/react";

const FORM_FIELDS = FILLABLE_FIELDS.filter(
  (field) => !NON_COLUMN_FIELDS.has(field),
);

function trimmedOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed;
}

export type ManualProductValues = {
  name: string;
} & Partial<Record<FillableField, string>>;

function seedValues(
  productName: string,
  sheetFields: Partial<Record<FillableField, string>>,
  candidate: EnrichCandidate | null,
): ManualProductValues {
  const candidateFields = candidate ? candidateToFields(candidate) : {};
  const values: ManualProductValues = {
    name: candidate?.name?.trim() ?? productName,
  };

  for (const field of FORM_FIELDS) {
    const fromCandidate = candidateFields[field]?.trim() ?? "";
    const fromSheet = sheetFields[field]?.trim() ?? "";
    values[field] = fromCandidate.length > 0 ? fromCandidate : fromSheet;
  }

  return values;
}

type ManualProductFormProps = {
  productName: string;
  sheetFields: Partial<Record<FillableField, string>>;
  selectedCandidate: EnrichCandidate | null;
  onApplyToRow: (values: ManualProductValues) => void;
  onSavedToCatalog: (materialId: number, values: ManualProductValues) => void;
};

export function ManualProductForm({
  productName,
  sheetFields,
  selectedCandidate,
  onApplyToRow,
  onSavedToCatalog,
}: ManualProductFormProps) {
  const toast = useToast();
  const [expanded, setExpanded] = useState(false);
  const [values, setValues] = useState<ManualProductValues>(() =>
    seedValues(productName, sheetFields, selectedCandidate),
  );

  const utils = api.useUtils();
  const upsertMaterial = api.material.upsertMaterial.useMutation();

  useEffect(() => {
    setValues(seedValues(productName, sheetFields, selectedCandidate));
  }, [productName, sheetFields, selectedCandidate]);

  const setField = (field: keyof ManualProductValues, value: string) => {
    setValues((prev) => ({ ...prev, [field]: value }));
  };

  const applyToRow = () => {
    const name = values.name.trim();
    if (!name) {
      toast.error("Tên vật tư không được để trống.");
      return;
    }
    onApplyToRow({ ...values, name });
    setExpanded(false);
    toast.success("Đã áp dụng cho dòng.");
  };

  const saveToCatalog = () => {
    const name = values.name.trim();
    const unit = values.unit?.trim() ?? "";
    if (!name) {
      toast.error("Tên vật tư không được để trống.");
      return;
    }
    if (!unit) {
      toast.error("ĐVT không được để trống.");
      return;
    }

    upsertMaterial.mutate(
      {
        id: selectedCandidate?.materialId,
        patch: {
          name,
          unit,
          code: trimmedOrUndefined(values.code),
          category: trimmedOrUndefined(values.category),
          specText: trimmedOrUndefined(values.specText),
          manufacturer: trimmedOrUndefined(values.manufacturer),
          originCountry: trimmedOrUndefined(values.originCountry),
          defaultUnitPrice: parseOptionalNumber(values.defaultUnitPrice ?? ""),
          sourceUrl: trimmedOrUndefined(values.sourceUrl),
          currency: "VND",
        },
      },
      {
        onSuccess: (material) => {
          if (!material) {
            toast.error("Không lưu được vật tư.");
            return;
          }
          void utils.material.enrichSearchMaterials.invalidate();
          onSavedToCatalog(material.id, { ...values, name });
          setExpanded(false);
          toast.success(
            selectedCandidate
              ? "Đã cập nhật vật tư."
              : "Đã lưu vào vật tư.",
          );
        },
        onError: (error) => {
          if (error.data?.code === "CONFLICT") {
            toast.error("Mã vật tư đã tồn tại.");
            return;
          }
          toast.error(error.message || "Không lưu được vật tư.");
        },
      },
    );
  };

  const isSaving = upsertMaterial.isPending;
  const title = selectedCandidate ? "Sửa vật tư" : "Thêm vật tư";

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50"
      >
        <span>Chỉnh sửa thủ công</span>
        {expanded ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
        )}
      </button>

      {expanded ? (
        <div className="space-y-3 border-t border-slate-200 px-3 py-3">
          <p className="text-xs text-slate-500">
            {title}: nhập đủ 8 trường để áp dụng cho dòng hoặc lưu vào vật tư.
          </p>

          <label className="block text-xs font-semibold text-slate-600">
            Tên vật tư
            <input
              type="text"
              value={values.name}
              onChange={(event) => setField("name", event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none"
            />
          </label>

          {FORM_FIELDS.map((field) => (
            <label
              key={field}
              className="block text-xs font-semibold text-slate-600"
            >
              {FIELD_LABELS[field]}
              <input
                type="text"
                value={values[field] ?? ""}
                onChange={(event) => setField(field, event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none"
              />
            </label>
          ))}

          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={applyToRow} disabled={isSaving}>
              Áp dụng cho dòng
            </Button>
            <Button onClick={saveToCatalog} disabled={isSaving}>
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Đang lưu…
                </>
              ) : (
                "Lưu vào vật tư"
              )}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
