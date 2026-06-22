"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

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

const DIALOG_FIELDS = FILLABLE_FIELDS.filter(
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

type ManualProductDialogProps = {
  open: boolean;
  productName: string;
  sheetFields: Partial<Record<FillableField, string>>;
  selectedCandidate: EnrichCandidate | null;
  onClose: () => void;
  onApplyToRow: (values: ManualProductValues) => void;
  onSavedToCatalog: (materialId: number, values: ManualProductValues) => void;
};

function seedValues(
  productName: string,
  sheetFields: Partial<Record<FillableField, string>>,
  candidate: EnrichCandidate | null,
): ManualProductValues {
  const candidateFields = candidate ? candidateToFields(candidate) : {};
  const values: ManualProductValues = {
    name: candidate?.name?.trim() ?? productName,
  };

  for (const field of DIALOG_FIELDS) {
    const fromCandidate = candidateFields[field]?.trim() ?? "";
    const fromSheet = sheetFields[field]?.trim() ?? "";
    values[field] = fromCandidate.length > 0 ? fromCandidate : fromSheet;
  }

  return values;
}

export function ManualProductDialog({
  open,
  productName,
  sheetFields,
  selectedCandidate,
  onClose,
  onApplyToRow,
  onSavedToCatalog,
}: ManualProductDialogProps) {
  const toast = useToast();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [values, setValues] = useState<ManualProductValues>(() =>
    seedValues(productName, sheetFields, selectedCandidate),
  );

  const upsertMaterial = api.material.upsertMaterial.useMutation();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    if (open) {
      setValues(seedValues(productName, sheetFields, selectedCandidate));
    }
  }, [open, productName, sheetFields, selectedCandidate]);

  if (!open) {
    return null;
  }

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
    onClose();
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
          onSavedToCatalog(material.id, { ...values, name });
          onClose();
          toast.success(
            selectedCandidate ? "Đã cập nhật vật tư trong catalog." : "Đã lưu vào catalog.",
          );
        },
        onError: (error) => {
          if (error.data?.code === "CONFLICT") {
            toast.error("Mã vật tư đã tồn tại trong catalog.");
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
    <dialog
      ref={dialogRef}
      className="fixed top-1/2 left-1/2 z-50 m-0 flex max-h-[min(92dvh,900px)] w-[min(720px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-0 shadow-2xl backdrop:bg-slate-950/50"
      onCancel={(event) => {
        event.preventDefault();
        if (!isSaving) {
          onClose();
        }
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current && !isSaving) {
          onClose();
        }
      }}
    >
      <div className="border-b border-slate-200 px-5 py-4">
        <p className="text-xs font-bold tracking-[0.12em] text-slate-500 uppercase">
          {title}
        </p>
        <p className="mt-1 text-sm text-slate-600">
          Nhập đủ 8 trường để áp dụng cho dòng hoặc lưu vào catalog.
        </p>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
        <label className="block text-xs font-semibold text-slate-600">
          Tên vật tư
          <input
            type="text"
            value={values.name}
            onChange={(event) => setField("name", event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none"
          />
        </label>

        {DIALOG_FIELDS.map((field) => (
          <label key={field} className="block text-xs font-semibold text-slate-600">
            {FIELD_LABELS[field]}
            <input
              type="text"
              value={values[field] ?? ""}
              onChange={(event) => setField(field, event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none"
            />
          </label>
        ))}
      </div>

      <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-5 py-4">
        <Button variant="ghost" onClick={onClose} disabled={isSaving}>
          Hủy
        </Button>
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
            "Lưu vào catalog"
          )}
        </Button>
      </div>
    </dialog>
  );
}
