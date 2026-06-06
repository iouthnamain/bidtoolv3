"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowLeft,
  BadgeDollarSign,
  CheckCircle2,
  ExternalLink,
  Link as LinkIcon,
  PackageCheck,
  Plus,
  RefreshCw,
  Save,
  Star,
  Trash2,
} from "lucide-react";

import { Badge, Button, EmptyState } from "~/app/_components/ui";
import {
  normalizeMaterialMetadata,
  type MaterialPriceSource,
  type MaterialPriceSourceMode,
} from "~/lib/material-price-sources";
import { type RouterOutputs, api } from "~/trpc/react";

type Material = RouterOutputs["material"]["getById"];
type UsageRow = RouterOutputs["material"]["getUsage"][number];

type MaterialFormState = {
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

type PriceSourceFormState = {
  label: string;
  url: string;
  mode: MaterialPriceSourceMode;
  fixedPrice: string;
  currency: string;
  note: string;
  isPrimary: boolean;
};

const emptyPriceSourceForm: PriceSourceFormState = {
  label: "",
  url: "",
  mode: "linked",
  fixedPrice: "",
  currency: "VND",
  note: "",
  isPrimary: false,
};

const workspaceStatusLabels: Record<UsageRow["workspaceStatus"], string> = {
  draft: "Bản nháp",
  imported: "Đã nhập tệp",
  mapped: "Đã ghép cột",
  reviewed: "Đang chuẩn hóa",
  matched: "Đã có evidence",
  exported: "Đã xuất tệp",
  catalog_generated: "Đã tạo danh mục",
  checked: "Đã kiểm tra",
  approved: "Đã duyệt cuối",
};

const workspaceStatusTone: Record<
  UsageRow["workspaceStatus"],
  "neutral" | "success" | "warning" | "critical" | "info"
> = {
  draft: "neutral",
  imported: "info",
  mapped: "info",
  reviewed: "warning",
  matched: "success",
  exported: "success",
  catalog_generated: "warning",
  checked: "warning",
  approved: "success",
};

function formFromMaterial(material: Material): MaterialFormState {
  return {
    code: material.code ?? "",
    name: material.name,
    unit: material.unit,
    category: material.category ?? "",
    specText: material.specText ?? "",
    manufacturer: material.manufacturer ?? "",
    originCountry: material.originCountry ?? "",
    defaultUnitPrice:
      material.defaultUnitPrice == null
        ? ""
        : String(material.defaultUnitPrice),
    currency: material.currency || "VND",
    sourceUrl: material.sourceUrl ?? "",
    defaultDepreciation: String(material.defaultDepreciation ?? 1),
    defaultReusePct: String(material.defaultReusePct ?? 0),
  };
}

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

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("vi-VN");
}

function formatMoney(value: number | null | undefined, currency = "VND") {
  if (value == null) {
    return "Chưa có";
  }
  return `${value.toLocaleString("vi-VN")} ${currency}`;
}

function sourceModeLabel(mode: MaterialPriceSourceMode) {
  return mode === "linked" ? "Theo link" : "Giá cố định";
}

function sourcePriceLabel(source: MaterialPriceSource) {
  if (source.mode === "fixed") {
    return formatMoney(source.fixedPrice, source.currency);
  }
  if (source.lastPrice != null) {
    return formatMoney(source.lastPrice, source.currency);
  }
  return source.lastPriceText ?? "Chưa lấy giá";
}

function sourceUsablePrice(source: MaterialPriceSource) {
  return source.mode === "fixed" ? source.fixedPrice : source.lastPrice;
}

function formatQuantity(value: number | null | undefined) {
  if (value == null) {
    return "-";
  }
  return value.toLocaleString("vi-VN");
}

function termLabel(term: string) {
  if (term === "term_1") {
    return "Học kỳ I";
  }
  if (term === "term_2") {
    return "Học kỳ II";
  }
  return term || "-";
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

function UsageCard({ item }: { item: UsageRow }) {
  const buyQty = Number(item.qtyTotal ?? 0) - Number(item.qtyInStock ?? 0);
  const hasStockOverflow =
    item.qtyTotal != null &&
    item.qtyInStock != null &&
    Number(item.qtyInStock) > Number(item.qtyTotal);

  return (
    <li className="rounded-lg border border-slate-200 bg-white px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/excel-workspace/${item.workspaceId}?step=rows`}
              className="text-sm font-bold text-slate-950 hover:text-sky-700 hover:underline"
            >
              {item.workspaceName}
            </Link>
            <Badge tone={workspaceStatusTone[item.workspaceStatus]}>
              {workspaceStatusLabels[item.workspaceStatus]}
            </Badge>
            <Badge tone={item.includedInExport ? "success" : "neutral"}>
              {item.includedInExport ? "Đưa vào xuất" : "Đã loại khỏi xuất"}
            </Badge>
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            {item.productName} • {termLabel(item.term)} • cập nhật{" "}
            {formatDateTime(item.updatedAt)}
          </p>
        </div>
      </div>

      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-5">
        <div className="rounded-md bg-slate-50 px-2 py-1.5">
          <dt className="text-slate-400">ĐVT</dt>
          <dd className="mt-0.5 font-semibold text-slate-700">{item.unit}</dd>
        </div>
        <div className="rounded-md bg-slate-50 px-2 py-1.5">
          <dt className="text-slate-400">SL tổng</dt>
          <dd className="mt-0.5 font-semibold text-slate-700">
            {formatQuantity(item.qtyTotal)}
          </dd>
        </div>
        <div className="rounded-md bg-slate-50 px-2 py-1.5">
          <dt className="text-slate-400">SL tồn</dt>
          <dd className="mt-0.5 font-semibold text-slate-700">
            {formatQuantity(item.qtyInStock)}
          </dd>
        </div>
        <div
          className={`rounded-md px-2 py-1.5 ${
            hasStockOverflow ? "bg-rose-50" : "bg-slate-50"
          }`}
        >
          <dt className={hasStockOverflow ? "text-rose-500" : "text-slate-400"}>
            Thực mua
          </dt>
          <dd
            className={`mt-0.5 font-semibold ${
              hasStockOverflow ? "text-rose-700" : "text-slate-700"
            }`}
          >
            {buyQty.toLocaleString("vi-VN")}
          </dd>
        </div>
        <div className="rounded-md bg-slate-50 px-2 py-1.5">
          <dt className="text-slate-400">Đơn giá</dt>
          <dd className="mt-0.5 font-semibold text-slate-700">
            {formatMoney(item.unitPrice)}
          </dd>
        </div>
      </dl>
    </li>
  );
}

function PriceSourceCard({
  source,
  refreshPending,
  applyPending,
  deletePending,
  updatePending,
  onRefresh,
  onRefreshAndApply,
  onApply,
  onDelete,
  onMakePrimary,
}: {
  source: MaterialPriceSource;
  refreshPending: boolean;
  applyPending: boolean;
  deletePending: boolean;
  updatePending: boolean;
  onRefresh: () => void;
  onRefreshAndApply: () => void;
  onApply: () => void;
  onDelete: () => void;
  onMakePrimary: () => void;
}) {
  const hasUsablePrice = sourceUsablePrice(source) != null;
  const canRefresh = source.mode === "linked" && !!source.url;

  return (
    <li className="rounded-lg border border-slate-200 bg-white px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 text-sm font-bold [overflow-wrap:anywhere] text-slate-950">
              {source.label}
            </p>
            <Badge tone={source.mode === "linked" ? "info" : "success"}>
              {sourceModeLabel(source.mode)}
            </Badge>
            {source.isPrimary ? (
              <Badge tone="warning">
                <Star className="h-3 w-3 fill-current" aria-hidden />
                Chính
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            Giá:{" "}
            <span className="font-semibold text-slate-900">
              {sourcePriceLabel(source)}
            </span>
            {source.lastCheckedAt ? (
              <> • cập nhật {formatDateTime(source.lastCheckedAt)}</>
            ) : null}
          </p>
          {source.url ? (
            <a
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex max-w-full items-center gap-1 truncate text-xs font-medium text-sky-700 hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="truncate">{source.url}</span>
            </a>
          ) : null}
          {source.note ? (
            <p className="mt-1 text-xs leading-5 text-slate-500">
              {source.note}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {source.mode === "linked" ? (
          <>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
              disabled={!canRefresh}
              isLoading={refreshPending}
              onClick={onRefresh}
            >
              Cập nhật từ link
            </Button>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<BadgeDollarSign className="h-3.5 w-3.5" />}
              disabled={!canRefresh}
              isLoading={refreshPending}
              onClick={onRefreshAndApply}
            >
              Cập nhật & áp dụng
            </Button>
          </>
        ) : null}
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<CheckCircle2 className="h-3.5 w-3.5" />}
          disabled={!hasUsablePrice}
          isLoading={applyPending}
          onClick={onApply}
        >
          Áp dụng giá
        </Button>
        {!source.isPrimary ? (
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<Star className="h-3.5 w-3.5" />}
            isLoading={updatePending}
            onClick={onMakePrimary}
          >
            Đặt chính
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<Trash2 className="h-3.5 w-3.5" />}
          isLoading={deletePending}
          onClick={onDelete}
        >
          Xóa link
        </Button>
      </div>
    </li>
  );
}

export function MaterialDetailClient({ id }: { id: number }) {
  const router = useRouter();
  const utils = api.useUtils();
  const [form, setForm] = useState<MaterialFormState | null>(null);
  const [priceSourceForm, setPriceSourceForm] =
    useState<PriceSourceFormState>(emptyPriceSourceForm);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const materialQuery = api.material.getById.useQuery({ id }, { retry: false });
  const usageQuery = api.material.getUsage.useQuery(
    { materialId: id, limit: 20 },
    { retry: false },
  );

  useEffect(() => {
    if (materialQuery.data) {
      setForm(formFromMaterial(materialQuery.data));
    }
  }, [materialQuery.data]);

  const updateMaterial = api.material.updateMaterial.useMutation({
    onSuccess: async (material) => {
      setActionError(null);
      setSuccessMessage("Đã lưu thay đổi vật tư.");
      setForm(formFromMaterial(material));
      await Promise.all([
        utils.material.getById.invalidate({ id }),
        utils.material.searchMaterials.invalidate(),
      ]);
    },
    onError: (error) => {
      setSuccessMessage(null);
      setActionError(error.message || "Không thể lưu vật tư.");
    },
  });

  const deleteMaterial = api.material.deleteMaterial.useMutation({
    onSuccess: async () => {
      await utils.material.searchMaterials.invalidate();
      router.push("/materials");
    },
    onError: (error) => {
      setActionError(error.message || "Không thể xóa vật tư.");
    },
  });

  const refreshMaterialQueries = async (material?: Material | null) => {
    if (material) {
      setForm(formFromMaterial(material));
    }
    await Promise.all([
      utils.material.getById.invalidate({ id }),
      utils.material.searchMaterials.invalidate(),
    ]);
  };

  const addPriceSource = api.material.addPriceSource.useMutation({
    onSuccess: async ({ material }) => {
      setActionError(null);
      setSuccessMessage("Đã thêm link sản phẩm / nguồn giá.");
      setPriceSourceForm(emptyPriceSourceForm);
      await refreshMaterialQueries(material);
    },
    onError: (error) => {
      setSuccessMessage(null);
      setActionError(error.message || "Không thể thêm nguồn giá.");
    },
  });

  const updatePriceSource = api.material.updatePriceSource.useMutation({
    onSuccess: async ({ material }) => {
      setActionError(null);
      setSuccessMessage("Đã cập nhật link sản phẩm / nguồn giá.");
      await refreshMaterialQueries(material);
    },
    onError: (error) => {
      setSuccessMessage(null);
      setActionError(error.message || "Không thể cập nhật nguồn giá.");
    },
  });

  const deletePriceSource = api.material.deletePriceSource.useMutation({
    onSuccess: async (material) => {
      setActionError(null);
      setSuccessMessage("Đã xóa link sản phẩm / nguồn giá.");
      await refreshMaterialQueries(material);
    },
    onError: (error) => {
      setSuccessMessage(null);
      setActionError(error.message || "Không thể xóa nguồn giá.");
    },
  });

  const refreshPriceSource = api.material.refreshPriceSource.useMutation({
    onSuccess: async ({ material }) => {
      setActionError(null);
      setSuccessMessage("Đã cập nhật giá từ link sản phẩm.");
      await refreshMaterialQueries(material);
    },
    onError: (error) => {
      setSuccessMessage(null);
      setActionError(error.message || "Không thể cập nhật giá từ link.");
    },
  });

  const applyPriceSourcePrice = api.material.applyPriceSourcePrice.useMutation({
    onSuccess: async (material) => {
      setActionError(null);
      setSuccessMessage("Đã áp dụng giá vào đơn giá mặc định.");
      await refreshMaterialQueries(material);
    },
    onError: (error) => {
      setSuccessMessage(null);
      setActionError(error.message || "Không thể áp dụng giá.");
    },
  });

  const canSave =
    !!form?.name.trim() && !!form.unit.trim() && !updateMaterial.isPending;

  const usageRows = usageQuery.data ?? [];
  const material = materialQuery.data;
  const priceSources = useMemo(
    () =>
      material
        ? normalizeMaterialMetadata(material.metadataJson).priceSources
        : [],
    [material],
  );
  const primarySource = priceSources.find((source) => source.isPrimary);
  const parsedSourceFixedPrice = parseOptionalNumber(
    priceSourceForm.fixedPrice,
  );
  const canAddPriceSource =
    priceSourceForm.label.trim().length > 0 &&
    (priceSourceForm.mode === "linked"
      ? priceSourceForm.url.trim().length > 0
      : parsedSourceFixedPrice != null) &&
    !addPriceSource.isPending;

  const metadataRows = useMemo(
    () =>
      material
        ? [
            ["Ngày tạo", formatDateTime(material.createdAt)],
            ["Cập nhật", formatDateTime(material.updatedAt)],
            ["ID", `#${material.id}`],
          ]
        : [],
    [material],
  );

  const save = () => {
    if (!form || !canSave) {
      return;
    }
    setSuccessMessage(null);
    setActionError(null);
    updateMaterial.mutate({
      id,
      patch: {
        code: form.code || "",
        name: form.name.trim(),
        unit: form.unit.trim(),
        category: form.category || "",
        specText: form.specText,
        manufacturer: form.manufacturer || "",
        originCountry: form.originCountry || "",
        defaultUnitPrice: parseOptionalNumber(form.defaultUnitPrice),
        currency: form.currency || "VND",
        sourceUrl: form.sourceUrl || "",
        defaultDepreciation: parseNumberOrDefault(form.defaultDepreciation, 1),
        defaultReusePct: Math.min(
          100,
          Math.max(0, parseIntegerOrDefault(form.defaultReusePct, 0)),
        ),
      },
    });
  };

  const addSource = () => {
    if (!canAddPriceSource) {
      return;
    }
    setSuccessMessage(null);
    setActionError(null);
    addPriceSource.mutate({
      materialId: id,
      source: {
        label: priceSourceForm.label.trim(),
        url: priceSourceForm.url.trim(),
        mode: priceSourceForm.mode,
        fixedPrice:
          priceSourceForm.mode === "fixed" ? parsedSourceFixedPrice : null,
        currency: priceSourceForm.currency.trim() || "VND",
        note: priceSourceForm.note.trim(),
        isPrimary: priceSourceForm.isPrimary,
      },
    });
  };

  const deleteSource = (source: MaterialPriceSource) => {
    const confirmed = window.confirm("Xóa link giá này khỏi vật tư?");
    if (!confirmed) {
      return;
    }
    setSuccessMessage(null);
    setActionError(null);
    deletePriceSource.mutate({ materialId: id, sourceId: source.id });
  };

  const makePrimarySource = (source: MaterialPriceSource) => {
    setSuccessMessage(null);
    setActionError(null);
    updatePriceSource.mutate({
      materialId: id,
      sourceId: source.id,
      patch: { isPrimary: true },
    });
  };

  const remove = () => {
    if (!material) {
      return;
    }
    const confirmed = window.confirm(
      "Xóa vật tư này khỏi danh mục? Các dòng workspace đã liên kết sẽ giữ dữ liệu hiện tại nhưng không còn dùng vật tư này làm catalog active.",
    );
    if (!confirmed) {
      return;
    }
    deleteMaterial.mutate({ id: material.id });
  };

  if (materialQuery.isLoading) {
    return (
      <div className="panel p-5 text-sm text-slate-600">
        Đang tải chi tiết vật tư…
      </div>
    );
  }

  if (materialQuery.isError || !material) {
    return (
      <EmptyState
        title="Không tìm thấy vật tư"
        description={
          materialQuery.error?.message ??
          "Vật tư có thể đã bị xóa hoặc không còn trong danh mục."
        }
        cta={
          <Link
            href="/materials"
            className="inline-flex items-center rounded-lg bg-sky-700 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-800"
          >
            Quay lại danh mục
          </Link>
        }
      />
    );
  }

  if (!form) {
    return (
      <div className="panel p-5 text-sm text-slate-600">
        Đang tải chi tiết vật tư…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section id="material-overview" className="panel scroll-mt-6 p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <Link
              href="/materials"
              className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 transition-colors hover:text-slate-900"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
              Quay lại danh mục
            </Link>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <h2 className="min-w-0 text-xl font-bold [overflow-wrap:anywhere] text-slate-950">
                {material.name}
              </h2>
              {material.code ? (
                <Badge tone="info">{material.code}</Badge>
              ) : null}
              {material.category ? (
                <Badge tone="neutral">{material.category}</Badge>
              ) : null}
              <Badge tone="success">{material.currency}</Badge>
            </div>
            <p className="mt-1 text-sm text-slate-600">
              {material.specText || "Chưa có thông số kỹ thuật."}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {material.sourceUrl ? (
              <a
                href={material.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
              >
                <ExternalLink className="h-4 w-4" aria-hidden />
                Mở nguồn
              </a>
            ) : null}
            <Button
              variant="primary"
              leftIcon={<Save className="h-4 w-4" />}
              isLoading={updateMaterial.isPending}
              disabled={!canSave}
              onClick={save}
            >
              Lưu thay đổi
            </Button>
            <Button
              variant="danger"
              leftIcon={<Trash2 className="h-4 w-4" />}
              isLoading={deleteMaterial.isPending}
              onClick={remove}
            >
              Xóa vật tư
            </Button>
          </div>
        </div>

        {successMessage ? (
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {successMessage}
          </div>
        ) : null}
        {actionError ? (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {actionError}
          </div>
        ) : null}

        <dl className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-3">
            <dt className="text-xs font-semibold text-slate-500">
              Đơn giá catalog
            </dt>
            <dd className="mt-1 text-lg font-bold text-slate-950">
              {formatMoney(material.defaultUnitPrice, material.currency)}
            </dd>
          </div>
          <div className="rounded-lg border border-sky-200 bg-sky-50/70 px-3 py-3">
            <dt className="text-xs font-semibold text-sky-700">Nguồn chính</dt>
            <dd className="mt-1 truncate text-sm font-bold text-sky-950">
              {primarySource?.label ?? material.sourceUrl ?? "Chưa có"}
            </dd>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-3">
            <dt className="text-xs font-semibold text-emerald-700">Link giá</dt>
            <dd className="mt-1 text-lg font-bold text-emerald-950">
              {priceSources.length.toLocaleString("vi-VN")}
            </dd>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
            <dt className="text-xs font-semibold text-slate-500">
              Workspace dùng
            </dt>
            <dd className="mt-1 text-lg font-bold text-slate-950">
              {usageRows.length.toLocaleString("vi-VN")}
            </dd>
          </div>
        </dl>
      </section>

      <section
        id="material-prices"
        className="grid scroll-mt-6 gap-4 xl:grid-cols-[0.85fr_1.15fr]"
      >
        <article className="panel p-4">
          <div className="border-b border-slate-200 pb-3">
            <div className="flex items-center gap-2">
              <LinkIcon className="h-4 w-4 text-sky-700" aria-hidden />
              <h3 className="text-sm font-bold text-slate-950">
                Link sản phẩm và giá
              </h3>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Lưu link tham khảo, giá cố định, hoặc lấy giá mới từ trang sản
              phẩm rồi áp dụng vào đơn giá mặc định.
            </p>
          </div>

          <div className="mt-4 grid gap-3">
            <Field label="Tên nguồn">
              <input
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="Nhà cung cấp, sàn TMĐT, báo giá…"
                value={priceSourceForm.label}
                onChange={(event) =>
                  setPriceSourceForm({
                    ...priceSourceForm,
                    label: event.target.value,
                  })
                }
              />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Kiểu giá">
                <select
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={priceSourceForm.mode}
                  onChange={(event) =>
                    setPriceSourceForm({
                      ...priceSourceForm,
                      mode: event.target.value as MaterialPriceSourceMode,
                    })
                  }
                >
                  <option value="linked">Theo link sản phẩm</option>
                  <option value="fixed">Giá cố định</option>
                </select>
              </Field>
              <Field label="Tiền tệ">
                <input
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={priceSourceForm.currency}
                  onChange={(event) =>
                    setPriceSourceForm({
                      ...priceSourceForm,
                      currency: event.target.value,
                    })
                  }
                />
              </Field>
            </div>

            <Field label="URL sản phẩm">
              <input
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="https://example.com/bao-gia…"
                value={priceSourceForm.url}
                onChange={(event) =>
                  setPriceSourceForm({
                    ...priceSourceForm,
                    url: event.target.value,
                  })
                }
              />
            </Field>

            <Field label="Giá cố định">
              <input
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                type="number"
                min={0}
                placeholder="Để trống nếu chỉ theo link"
                value={priceSourceForm.fixedPrice}
                onChange={(event) =>
                  setPriceSourceForm({
                    ...priceSourceForm,
                    fixedPrice: event.target.value,
                  })
                }
              />
            </Field>

            <Field label="Ghi chú">
              <textarea
                className="min-h-20 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={priceSourceForm.note}
                onChange={(event) =>
                  setPriceSourceForm({
                    ...priceSourceForm,
                    note: event.target.value,
                  })
                }
              />
            </Field>

            <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-sky-700"
                checked={priceSourceForm.isPrimary}
                onChange={(event) =>
                  setPriceSourceForm({
                    ...priceSourceForm,
                    isPrimary: event.target.checked,
                  })
                }
              />
              Dùng làm nguồn chính
            </label>

            <Button
              variant="primary"
              leftIcon={<Plus className="h-4 w-4" />}
              disabled={!canAddPriceSource}
              isLoading={addPriceSource.isPending}
              onClick={addSource}
            >
              Thêm link / nguồn giá
            </Button>
          </div>
        </article>

        <article className="panel p-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
            <div>
              <h3 className="text-sm font-bold text-slate-950">
                Nguồn giá đã lưu
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                Giá link được dò từ nội dung trang; giá cố định có thể áp dụng
                ngay cho vật tư.
              </p>
            </div>
            <Badge tone="info" count={priceSources.length}>
              Nguồn
            </Badge>
          </div>

          {priceSources.length === 0 ? (
            <EmptyState
              className="mt-3"
              title="Chưa có link sản phẩm hoặc nguồn giá."
              description="Thêm link nhà cung cấp hoặc giá cố định để cập nhật đơn giá catalog khi cần."
            />
          ) : (
            <ul className="mt-3 space-y-2">
              {priceSources.map((source) => (
                <PriceSourceCard
                  key={source.id}
                  source={source}
                  refreshPending={refreshPriceSource.isPending}
                  applyPending={applyPriceSourcePrice.isPending}
                  deletePending={deletePriceSource.isPending}
                  updatePending={updatePriceSource.isPending}
                  onRefresh={() => {
                    setSuccessMessage(null);
                    setActionError(null);
                    refreshPriceSource.mutate({
                      materialId: id,
                      sourceId: source.id,
                      updateDefaultPrice: false,
                    });
                  }}
                  onRefreshAndApply={() => {
                    setSuccessMessage(null);
                    setActionError(null);
                    refreshPriceSource.mutate({
                      materialId: id,
                      sourceId: source.id,
                      updateDefaultPrice: true,
                    });
                  }}
                  onApply={() => {
                    setSuccessMessage(null);
                    setActionError(null);
                    applyPriceSourcePrice.mutate({
                      materialId: id,
                      sourceId: source.id,
                    });
                  }}
                  onDelete={() => deleteSource(source)}
                  onMakePrimary={() => makePrimarySource(source)}
                />
              ))}
            </ul>
          )}
        </article>
      </section>

      <section
        id="material-edit"
        className="grid scroll-mt-6 gap-4 xl:grid-cols-[1.25fr_0.75fr]"
      >
        <article className="panel p-4">
          <div className="border-b border-slate-200 pb-3">
            <h3 className="text-sm font-bold text-slate-950">
              Thông tin vật tư
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Chỉnh sửa dữ liệu catalog dùng cho Excel Workspace.
            </p>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Field label="Mã vật tư">
              <input
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={form.code}
                onChange={(event) =>
                  setForm({ ...form, code: event.target.value })
                }
              />
            </Field>
            <Field label="Tên vật tư">
              <input
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={form.name}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
              />
            </Field>
            <Field label="ĐVT">
              <input
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={form.unit}
                onChange={(event) =>
                  setForm({ ...form, unit: event.target.value })
                }
              />
            </Field>
            <Field label="Nhóm">
              <input
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={form.category}
                onChange={(event) =>
                  setForm({ ...form, category: event.target.value })
                }
              />
            </Field>
            <Field label="Nhà sản xuất / NCC">
              <input
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={form.manufacturer}
                onChange={(event) =>
                  setForm({ ...form, manufacturer: event.target.value })
                }
              />
            </Field>
            <Field label="Xuất xứ">
              <input
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={form.originCountry}
                onChange={(event) =>
                  setForm({ ...form, originCountry: event.target.value })
                }
              />
            </Field>
            <Field label="Đơn giá mặc định">
              <input
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                type="number"
                min={0}
                value={form.defaultUnitPrice}
                onChange={(event) =>
                  setForm({ ...form, defaultUnitPrice: event.target.value })
                }
              />
            </Field>
            <Field label="Tiền tệ">
              <input
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={form.currency}
                onChange={(event) =>
                  setForm({ ...form, currency: event.target.value })
                }
              />
            </Field>
            <Field label="Khấu hao mặc định">
              <input
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                type="number"
                min={0}
                step={0.1}
                value={form.defaultDepreciation}
                onChange={(event) =>
                  setForm({
                    ...form,
                    defaultDepreciation: event.target.value,
                  })
                }
              />
            </Field>
            <Field label="% sử dụng lại mặc định">
              <input
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                type="number"
                min={0}
                max={100}
                value={form.defaultReusePct}
                onChange={(event) =>
                  setForm({ ...form, defaultReusePct: event.target.value })
                }
              />
            </Field>
            <Field label="URL nguồn" className="md:col-span-2">
              <input
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={form.sourceUrl}
                onChange={(event) =>
                  setForm({ ...form, sourceUrl: event.target.value })
                }
              />
            </Field>
            <Field label="Thông số kỹ thuật" className="md:col-span-2">
              <textarea
                className="min-h-28 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={form.specText}
                onChange={(event) =>
                  setForm({ ...form, specText: event.target.value })
                }
              />
            </Field>
          </div>
        </article>

        <aside className="space-y-4">
          <article className="panel p-4">
            <h3 className="text-sm font-bold text-slate-950">Thiết lập THVT</h3>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
                <dt className="text-slate-500">Khấu hao</dt>
                <dd className="font-semibold text-slate-900">
                  {material.defaultDepreciation}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
                <dt className="text-slate-500">Sử dụng lại</dt>
                <dd className="font-semibold text-slate-900">
                  {material.defaultReusePct}%
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
                <dt className="text-slate-500">Tiền tệ</dt>
                <dd className="font-semibold text-slate-900">
                  {material.currency}
                </dd>
              </div>
            </dl>
          </article>

          <article className="panel p-4">
            <h3 className="text-sm font-bold text-slate-950">Metadata</h3>
            <dl className="mt-3 space-y-2 text-xs">
              {metadataRows.map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2"
                >
                  <dt className="text-slate-500">{label}</dt>
                  <dd className="font-semibold text-slate-800">{value}</dd>
                </div>
              ))}
            </dl>
          </article>
        </aside>
      </section>

      <section className="panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
          <div>
            <h3 className="text-sm font-bold text-slate-950">
              Đang dùng trong workspace
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Các dòng Excel Workspace đang liên kết với vật tư này.
            </p>
          </div>
          <Badge tone="info" count={usageRows.length}>
            <PackageCheck className="h-3.5 w-3.5" aria-hidden />
            Usage
          </Badge>
        </div>

        {usageQuery.isLoading ? (
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-600">
            Đang tải lịch sử sử dụng…
          </div>
        ) : usageQuery.isError ? (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
            Không tải được usage: {usageQuery.error.message}
          </div>
        ) : usageRows.length === 0 ? (
          <EmptyState
            className="mt-3"
            title="Vật tư này chưa được liên kết với workspace nào."
            description="Khi liên kết vật tư trong Excel Workspace, các dòng sử dụng sẽ xuất hiện tại đây."
          />
        ) : (
          <ul className="mt-3 space-y-2">
            {usageRows.map((item) => (
              <UsageCard key={item.itemId} item={item} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
