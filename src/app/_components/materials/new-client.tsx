"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { ArrowLeft, PackagePlus, Save } from "lucide-react";

import { Badge, Button } from "~/app/_components/ui";
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
  defaultDepreciation: string;
  defaultReusePct: string;
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
  defaultDepreciation: "1",
  defaultReusePct: "0",
};

const inputClass =
  "min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 transition-colors placeholder:text-slate-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-100 focus:outline-none sm:min-h-10";

const textareaClass =
  "min-h-32 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 transition-colors placeholder:text-slate-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-100 focus:outline-none";

function parseOptionalNumber(value: string) {
  if (!value.trim()) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseNumberOrDefault(value: string, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function parseIntegerOrDefault(value: string, fallback: number) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : fallback;
}

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

export function MaterialCreateClient() {
  const router = useRouter();
  const utils = api.useUtils();
  const [form, setForm] = useState(emptyForm);
  const [actionError, setActionError] = useState<string | null>(null);

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

  const submit = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (!canCreate) {
      return;
    }
    setActionError(null);
    createMaterial.mutate({
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
      defaultDepreciation: parseNumberOrDefault(form.defaultDepreciation, 1),
      defaultReusePct: Math.min(
        100,
        Math.max(0, parseIntegerOrDefault(form.defaultReusePct, 0)),
      ),
    });
  };

  return (
    <form className="space-y-4" onSubmit={submit}>
      <section className="panel p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link
              href="/materials"
              className="inline-flex min-h-10 items-center gap-1 rounded-md py-1.5 pr-2 text-xs font-semibold text-slate-500 transition-colors hover:text-slate-900 sm:min-h-0 sm:py-0"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
              Quay lại danh mục
            </Link>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold text-slate-950">
                Thêm sản phẩm / vật tư
              </h2>
              <Badge tone="info">Manual</Badge>
            </div>
            <p className="mt-1 text-sm text-slate-600">
              Tạo một bản ghi catalog đầy đủ để dùng lại khi nhập và chuẩn hóa
              vật tư.
            </p>
          </div>

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

        {actionError ? (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {actionError}
          </div>
        ) : null}
      </section>

      <section className="panel p-4">
        <div className="border-b border-slate-200 pb-3">
          <div className="flex items-center gap-2">
            <PackagePlus className="h-4 w-4 text-sky-700" aria-hidden />
            <h3 className="text-sm font-bold text-slate-950">
              Thông tin catalog
            </h3>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Các trường tên và ĐVT là bắt buộc; giá, nguồn và thông số có thể bổ
            sung sau trong trang chi tiết.
          </p>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <Field label="Mã vật tư">
            <input
              name="code"
              autoComplete="off"
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
          <Field label="ĐVT">
            <input
              name="unit"
              autoComplete="off"
              className={inputClass}
              value={form.unit}
              onChange={(event) =>
                setForm({ ...form, unit: event.target.value })
              }
            />
          </Field>
          <Field label="Nhóm">
            <input
              name="category"
              autoComplete="off"
              className={inputClass}
              value={form.category}
              onChange={(event) =>
                setForm({ ...form, category: event.target.value })
              }
            />
          </Field>
          <Field label="Nhà sản xuất / NCC">
            <input
              name="manufacturer"
              autoComplete="organization"
              className={inputClass}
              value={form.manufacturer}
              onChange={(event) =>
                setForm({ ...form, manufacturer: event.target.value })
              }
            />
          </Field>
          <Field label="Xuất xứ">
            <input
              name="originCountry"
              autoComplete="country-name"
              className={inputClass}
              value={form.originCountry}
              onChange={(event) =>
                setForm({ ...form, originCountry: event.target.value })
              }
            />
          </Field>
          <Field label="Đơn giá mặc định">
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
              className={inputClass}
              value={form.currency}
              onChange={(event) =>
                setForm({ ...form, currency: event.target.value })
              }
            />
          </Field>
          <Field label="Khấu hao mặc định">
            <input
              name="defaultDepreciation"
              autoComplete="off"
              className={inputClass}
              type="number"
              min={0}
              step={0.1}
              inputMode="decimal"
              value={form.defaultDepreciation}
              onChange={(event) =>
                setForm({ ...form, defaultDepreciation: event.target.value })
              }
            />
          </Field>
          <Field label="% sử dụng lại mặc định">
            <input
              name="defaultReusePct"
              autoComplete="off"
              className={inputClass}
              type="number"
              min={0}
              max={100}
              inputMode="numeric"
              value={form.defaultReusePct}
              onChange={(event) =>
                setForm({ ...form, defaultReusePct: event.target.value })
              }
            />
          </Field>
          <Field label="URL nguồn" className="md:col-span-2">
            <input
              name="sourceUrl"
              type="url"
              autoComplete="url"
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
