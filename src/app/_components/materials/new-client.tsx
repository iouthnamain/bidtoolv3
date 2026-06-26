"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { ArrowLeft, PackagePlus, Plus, Save } from "lucide-react";

import { Badge, Button } from "~/app/_components/ui";
import { useToast } from "~/app/_components/ui/toast";
import { parseOptionalNumber } from "~/lib/materials/format";
import { api } from "~/trpc/react";

type MaterialCreateFormState = {
  code: string;
  name: string;
  unit: string;
  category: string;
  specText: string;
  manufacturer: string;
  originCountry: string;
  defaultUnitPrice: string;
  currency: string;
  sourceUrl: string;
};

const emptyForm: MaterialCreateFormState = {
  code: "",
  name: "",
  unit: "",
  category: "",
  specText: "",
  manufacturer: "",
  originCountry: "",
  defaultUnitPrice: "",
  currency: "VND",
  sourceUrl: "",
};

const inputClass =
  "min-h-11 rounded border border-slate-400 bg-white px-3 py-2 text-sm text-slate-900 transition-colors placeholder:text-slate-600 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 focus:outline-none";

const textareaClass =
  "min-h-32 rounded border border-slate-400 bg-white px-3 py-2 text-sm text-slate-900 transition-colors placeholder:text-slate-600 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 focus:outline-none";

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      <span className="text-xs font-semibold tracking-[0.12em] text-slate-600 uppercase">
        {label}
      </span>
      {children}
    </label>
  );
}

function SuggestedInput({
  label,
  name,
  value,
  onChange,
  options,
  placeholder,
  autoComplete,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  autoComplete?: string;
}) {
  const listId = `${name}-suggestions`;

  return (
    <Field label={label}>
      <input
        name={name}
        autoComplete={autoComplete}
        className={inputClass}
        list={listId}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <datalist id={listId}>
        {options.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
    </Field>
  );
}

function buildCreatePayload(form: MaterialCreateFormState) {
  return {
    code: form.code || undefined,
    name: form.name.trim(),
    unit: form.unit.trim(),
    category: form.category || undefined,
    specText: form.specText,
    manufacturer: form.manufacturer || undefined,
    originCountry: form.originCountry || undefined,
    defaultUnitPrice: parseOptionalNumber(form.defaultUnitPrice),
    currency: form.currency || "VND",
    sourceUrl: form.sourceUrl || undefined,
  };
}

export function MaterialCreateClient() {
  const router = useRouter();
  const utils = api.useUtils();
  const toast = useToast();
  const [form, setForm] = useState(emptyForm);
  const [actionError, setActionError] = useState<string | null>(null);
  const continueAddingRef = useRef(false);
  const filterOptionsQuery = api.material.getMaterialFilterOptions.useQuery(
    undefined,
    { staleTime: 5 * 60_000 },
  );

  const createMaterial = api.material.createMaterial.useMutation({
    onSuccess: async (material) => {
      if (!material) {
        setActionError("Đã lưu nhưng không nhận được ID vật tư.");
        return;
      }
      utils.material.getById.setData({ id: material.id }, material);
      await Promise.all([
        utils.material.searchMaterials.invalidate(),
        utils.material.getMaterialSummary.invalidate(),
        utils.material.getMaterialFilterOptions.invalidate(),
      ]);

      if (continueAddingRef.current) {
        continueAddingRef.current = false;
        setForm(emptyForm);
        setActionError(null);
        toast.success(`Đã thêm "${material.name}". Tiếp tục nhập vật tư mới.`);
        return;
      }

      router.push(`/materials/${material.id}`);
    },
    onError: (error) => {
      setActionError(error.message || "Không thể tạo vật tư.");
    },
  });

  const canCreate =
    form.name.trim().length > 0 &&
    form.unit.trim().length > 0 &&
    !createMaterial.isPending;

  const submit = (
    event?: FormEvent<HTMLFormElement>,
    options?: { continueAdding?: boolean },
  ) => {
    event?.preventDefault();
    if (!canCreate) {
      return;
    }
    setActionError(null);
    continueAddingRef.current = options?.continueAdding === true;
    createMaterial.mutate(buildCreatePayload(form));
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => submit(event)}
    >
      <section className="panel p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <Link
              href="/materials"
              className="inline-flex min-h-10 items-center gap-1 rounded py-1.5 pr-2 text-xs font-semibold text-slate-700 transition-colors hover:text-slate-900 sm:py-0"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
              Quay lại danh mục
            </Link>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold text-balance text-slate-950">
                Thêm sản phẩm / vật tư
              </h2>
              <Badge tone="info">Manual</Badge>
            </div>
            <p className="mt-1 text-sm text-slate-600">
              Tạo một bản ghi catalog đầy đủ để dùng lại khi nhập và chuẩn hóa
              vật tư.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              leftIcon={<Plus className="h-4 w-4" />}
              disabled={!canCreate}
              isLoading={createMaterial.isPending}
              onClick={() => submit(undefined, { continueAdding: true })}
            >
              Lưu và thêm tiếp
            </Button>
            <Button
              type="submit"
              variant="primary"
              leftIcon={<Save className="h-4 w-4" />}
              disabled={!canCreate}
              isLoading={createMaterial.isPending}
            >
              Lưu và mở chi tiết
            </Button>
          </div>
        </div>

        {actionError ? (
          <div className="mt-4 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {actionError}
          </div>
        ) : null}
      </section>

      <section className="panel p-4">
        <div className="border-b border-slate-400 pb-3">
          <div className="flex items-center gap-2">
            <PackagePlus className="h-4 w-4 text-blue-700" aria-hidden />
            <h3 className="text-sm font-bold text-slate-950">
              Thông tin catalog
            </h3>
          </div>
          <p className="mt-1 text-xs text-slate-700">
            Các trường tên và ĐVT là bắt buộc; giá, nguồn và thông số có thể bổ
            sung sau trong trang chi tiết.
          </p>
        </div>

        <div className="mt-4 grid gap-1 md:grid-cols-2">
          <Field label="Mã vật tư">
            <input
              name="code"
              autoComplete="off"
              spellCheck={false}
              className={inputClass}
              value={form.code}
              onChange={(event) =>
                setForm({ ...form, code: event.target.value })
              }
            />
          </Field>
          <Field label="Tên vật tư">
            <input
              name="name"
              autoComplete="off"
              className={inputClass}
              value={form.name}
              onChange={(event) =>
                setForm({ ...form, name: event.target.value })
              }
            />
          </Field>
          <SuggestedInput
            label="ĐVT"
            name="unit"
            value={form.unit}
            onChange={(unit) => setForm({ ...form, unit })}
            options={filterOptionsQuery.data?.units ?? []}
            placeholder="Cái, Mét, Bộ…"
          />
          <SuggestedInput
            label="Nhóm"
            name="category"
            value={form.category}
            onChange={(category) => setForm({ ...form, category })}
            options={filterOptionsQuery.data?.categories ?? []}
            placeholder="Nhóm vật tư…"
          />
          <SuggestedInput
            label="Nhà sản xuất / NCC"
            name="manufacturer"
            value={form.manufacturer}
            onChange={(manufacturer) => setForm({ ...form, manufacturer })}
            options={filterOptionsQuery.data?.manufacturers ?? []}
            placeholder="Nhà cung cấp…"
            autoComplete="organization"
          />
          <SuggestedInput
            label="Xuất xứ"
            name="originCountry"
            value={form.originCountry}
            onChange={(originCountry) =>
              setForm({ ...form, originCountry })
            }
            options={filterOptionsQuery.data?.origins ?? []}
            placeholder="VN, CN, JP…"
            autoComplete="country-name"
          />
          <Field label="Đơn giá">
            <input
              name="defaultUnitPrice"
              autoComplete="off"
              className={inputClass}
              type="number"
              min={0}
              inputMode="decimal"
              value={form.defaultUnitPrice}
              onChange={(event) =>
                setForm({ ...form, defaultUnitPrice: event.target.value })
              }
            />
          </Field>
          <Field label="Tiền tệ">
            <input
              name="currency"
              autoComplete="off"
              spellCheck={false}
              className={inputClass}
              value={form.currency}
              onChange={(event) =>
                setForm({ ...form, currency: event.target.value })
              }
            />
          </Field>
          <Field label="URL nguồn" className="md:col-span-2">
            <input
              name="sourceUrl"
              type="url"
              autoComplete="url"
              spellCheck={false}
              className={inputClass}
              placeholder="https://example.com/bao-gia…"
              value={form.sourceUrl}
              onChange={(event) =>
                setForm({ ...form, sourceUrl: event.target.value })
              }
            />
          </Field>
          <Field label="Thông số kỹ thuật" className="md:col-span-2">
            <textarea
              name="specText"
              autoComplete="off"
              className={textareaClass}
              value={form.specText}
              onChange={(event) =>
                setForm({ ...form, specText: event.target.value })
              }
            />
          </Field>
        </div>
      </section>
    </form>
  );
}
