"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useCallback } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  ArrowLeft,
  BadgeDollarSign,
  CheckCircle2,
  ChevronDown,
  Clock,
  Copy,
  ExternalLink,
  Factory,
  FileText,
  Globe2,
  Link as LinkIcon,
  Lock,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Ruler,
  Save,
  Star,
  Tag,
  Trash2,
} from "lucide-react";

import { MaterialCatalogPdfSection } from "~/app/_components/materials/catalog-pdf-section";
import { Badge, Button, ConfirmDialog, EmptyState } from "~/app/_components/ui";
import { useToast } from "~/app/_components/ui/toast";
import {
  formatDateTime,
  formatMoney,
  parseOptionalNumber,
} from "~/lib/materials/format";
import { resolveMaterialImageUrl } from "~/lib/materials/image";
import {
  normalizeMaterialMetadata,
  type MaterialFieldLockKey,
  type MaterialPriceSource,
  type MaterialPriceSourceMode,
} from "~/lib/material-price-sources";
import { type RouterOutputs, api } from "~/trpc/react";

type Material = RouterOutputs["material"]["getById"];

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
  };
}

function formsEqual(a: MaterialFormState, b: MaterialFormState) {
  return JSON.stringify(a) === JSON.stringify(b);
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

function countMaterialSources(
  priceSources: MaterialPriceSource[],
  sourceUrl?: string | null,
) {
  const normalizedSourceUrl = sourceUrl?.trim();
  const hasStandaloneSourceUrl =
    Boolean(normalizedSourceUrl) &&
    !priceSources.some((source) => source.url.trim() === normalizedSourceUrl);

  return priceSources.length + (hasStandaloneSourceUrl ? 1 : 0);
}

const inputClass =
  "min-h-10 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 transition-colors placeholder:text-slate-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-100 focus:outline-none";

const textareaClass =
  "rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 transition-colors placeholder:text-slate-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-100 focus:outline-none";

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

function LockableField({
  label,
  fieldKey,
  locked,
  onToggleLock,
  children,
  className = "",
}: {
  label: string;
  fieldKey: MaterialFieldLockKey;
  locked: boolean;
  onToggleLock: (field: MaterialFieldLockKey, nextLocked: boolean) => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold tracking-[0.12em] text-slate-600 uppercase">
          {label}
        </span>
        <button
          type="button"
          className="inline-flex items-center rounded p-0.5 text-slate-400 transition hover:text-amber-600"
          title={
            locked
              ? "Đã khóa — không ghi đè khi scrape lại"
              : "Khóa trường này khi scrape lại"
          }
          aria-pressed={locked}
          aria-label={`${locked ? "Mở khóa" : "Khóa"} ${label}`}
          onClick={() => onToggleLock(fieldKey, !locked)}
        >
          <Lock className={`h-3.5 w-3.5 ${locked ? "text-amber-600" : ""}`} />
        </button>
      </div>
      {children}
    </div>
  );
}

function MaterialImagePreview({ material }: { material: Material }) {
  const imageUrl = resolveMaterialImageUrl(material);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [imageUrl]);

  const showPlaceholder = !imageUrl || failed;

  return (
    <div className="flex w-40 shrink-0 flex-col gap-1">
      <span className="text-xs font-semibold tracking-[0.12em] text-slate-600 uppercase">
        Ảnh sản phẩm
      </span>
      {showPlaceholder ? (
        <div className="flex h-48 w-full items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 text-center">
          <div className="flex flex-col items-center gap-2 px-3 text-slate-500">
            <Package className="h-8 w-8" aria-hidden />
            <span className="text-xs font-medium">Chưa có ảnh</span>
          </div>
        </div>
      ) : (
        <img
          src={imageUrl}
          alt=""
          referrerPolicy="no-referrer"
          loading="lazy"
          className="h-48 w-full max-w-xs rounded-md border border-slate-200 object-contain"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}

function SummaryTile({
  label,
  value,
  helper,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  helper?: ReactNode;
  icon: ReactNode;
  tone?: "neutral" | "sky" | "emerald" | "amber";
}) {
  const toneClass = {
    neutral: "border-slate-200 bg-white text-slate-500",
    sky: "border-sky-200 bg-sky-50 text-sky-700",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
  }[tone];

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-3">
      <div className="flex items-start gap-3">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border ${toneClass}`}
          aria-hidden
        >
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-[0.12em] text-slate-500 uppercase">
            {label}
          </p>
          <div className="mt-1 text-base leading-snug font-bold [overflow-wrap:anywhere] text-slate-950">
            {value}
          </div>
          {helper ? (
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              {helper}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
  icon,
}: {
  label: string;
  value: ReactNode;
  icon: ReactNode;
}) {
  const displayValue =
    value === null || value === undefined || value === "" ? "-" : value;

  return (
    <div className="flex items-start gap-2 rounded-md border border-slate-200 bg-white px-3 py-2">
      <span className="mt-0.5 text-slate-400" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0">
        <dt className="text-[11px] font-semibold tracking-[0.12em] text-slate-500 uppercase">
          {label}
        </dt>
        <dd className="mt-0.5 text-sm font-medium [overflow-wrap:anywhere] text-slate-900">
          {displayValue}
        </dd>
      </div>
    </div>
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
    <li className="rounded-lg border border-slate-200 bg-white px-4 py-3">
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
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
            <span>
              Giá:{" "}
              <span className="font-semibold text-slate-900">
                {sourcePriceLabel(source)}
              </span>
            </span>
            <span>
              Cập nhật:{" "}
              <span className="font-semibold text-slate-900">
                {formatDateTime(source.lastCheckedAt)}
              </span>
            </span>
          </div>
          {source.url ? (
            <a
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex max-w-full items-center gap-1 truncate text-xs font-medium text-sky-700 hover:underline"
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

export type MaterialDetailView = "overview" | "prices" | "documents" | "edit";

export function MaterialDetailClient({
  id,
  view = "overview",
}: {
  id: number;
  view?: MaterialDetailView;
}) {
  const router = useRouter();
  const utils = api.useUtils();
  const toast = useToast();
  const [form, setForm] = useState<MaterialFormState | null>(null);
  const [savedFormSnapshot, setSavedFormSnapshot] =
    useState<MaterialFormState | null>(null);
  const [priceSourceForm, setPriceSourceForm] =
    useState<PriceSourceFormState>(emptyPriceSourceForm);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteMaterialTarget, setDeleteMaterialTarget] =
    useState<Material | null>(null);
  const [deleteSourceTarget, setDeleteSourceTarget] =
    useState<MaterialPriceSource | null>(null);
  const [isPricesSectionOpen, setIsPricesSectionOpen] = useState(
    view === "prices",
  );
  const [isEditSectionOpen, setIsEditSectionOpen] = useState(view === "edit");
  const [fieldLocks, setFieldLocks] = useState<
    Partial<Record<MaterialFieldLockKey, boolean>>
  >({});

  const materialQuery = api.material.getById.useQuery({ id }, { retry: false });

  useEffect(() => {
    if (materialQuery.data) {
      const nextForm = formFromMaterial(materialQuery.data);
      setForm(nextForm);
      setSavedFormSnapshot(nextForm);
      setFieldLocks(
        normalizeMaterialMetadata(materialQuery.data.metadataJson).fieldLocks ??
          {},
      );
    }
  }, [materialQuery.data]);

  const isDirty =
    form != null &&
    savedFormSnapshot != null &&
    !formsEqual(form, savedFormSnapshot);

  useEffect(() => {
    if (!isDirty) {
      return;
    }
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  const updateMaterial = api.material.updateMaterial.useMutation({
    onSuccess: async (material) => {
      setActionError(null);
      setSuccessMessage("Đã lưu thay đổi vật tư.");
      toast.success("Đã lưu thay đổi vật tư.");
      await refreshMaterialQueries(material);
    },
    onError: (error) => {
      setSuccessMessage(null);
      setActionError(error.message || "Không thể lưu vật tư.");
    },
  });

  const setMaterialFieldLocks = api.material.setMaterialFieldLocks.useMutation({
    onSuccess: async (material) => {
      setFieldLocks(
        normalizeMaterialMetadata(material.metadataJson).fieldLocks ?? {},
      );
      utils.material.getById.setData({ id }, material);
      toast.success("Đã cập nhật khóa trường scrape.");
    },
    onError: (error) => {
      setActionError(error.message || "Không thể cập nhật khóa trường.");
    },
  });

  const toggleFieldLock = useCallback(
    (field: MaterialFieldLockKey, locked: boolean) => {
      setFieldLocks((current) => {
        const next = { ...current };
        if (locked) {
          next[field] = true;
        } else {
          delete next[field];
        }
        return next;
      });
      setMaterialFieldLocks.mutate({
        id,
        fieldLocks: { [field]: locked },
      });
    },
    [id, setMaterialFieldLocks],
  );

  const deleteMaterial = api.material.deleteMaterial.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.material.searchMaterials.invalidate(),
        utils.material.getMaterialSummary.invalidate(),
        utils.material.getMaterialFilterOptions.invalidate(),
      ]);
      router.push("/materials");
    },
    onError: (error) => {
      setDeleteMaterialTarget(null);
      setActionError(error.message || "Không thể xóa vật tư.");
    },
  });

  const duplicateMaterial = api.material.duplicateMaterial.useMutation({
    onSuccess: async (material) => {
      toast.success(`Đã nhân bản thành "${material.name}".`);
      await Promise.all([
        utils.material.searchMaterials.invalidate(),
        utils.material.getMaterialSummary.invalidate(),
        utils.material.getMaterialFilterOptions.invalidate(),
      ]);
      router.push(`/materials/${material.id}`);
    },
    onError: (error) => {
      setActionError(error.message || "Không thể nhân bản vật tư.");
    },
  });

  const refreshMaterialQueries = async (material?: Material | null) => {
    if (material) {
      const nextForm = formFromMaterial(material);
      setForm(nextForm);
      setSavedFormSnapshot(nextForm);
      utils.material.getById.setData({ id }, material);
    }
    await Promise.all([
      utils.material.searchMaterials.invalidate(),
      utils.material.getMaterialSummary.invalidate(),
      utils.material.getMaterialFilterOptions.invalidate(),
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
      setDeleteSourceTarget(null);
      setSuccessMessage("Đã xóa link sản phẩm / nguồn giá.");
      await refreshMaterialQueries(material);
    },
    onError: (error) => {
      setDeleteSourceTarget(null);
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
      setSuccessMessage("Đã áp dụng giá vào đơn giá.");
      await refreshMaterialQueries(material);
    },
    onError: (error) => {
      setSuccessMessage(null);
      setActionError(error.message || "Không thể áp dụng giá.");
    },
  });

  const canSave =
    !!form?.name.trim() && !!form.unit.trim() && !updateMaterial.isPending;

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

  const metadataRows = useMemo<Array<[string, string]>>(
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
  const sourceCount = countMaterialSources(priceSources, material?.sourceUrl);
  const latestCheckedSource = useMemo(
    () =>
      priceSources
        .filter((source) => source.lastCheckedAt)
        .sort(
          (a, b) =>
            new Date(b.lastCheckedAt ?? "").getTime() -
            new Date(a.lastCheckedAt ?? "").getTime(),
        )[0],
    [priceSources],
  );
  const readinessItems = useMemo(
    () =>
      material
        ? [
            {
              label: "Đơn giá",
              done: material.defaultUnitPrice != null,
            },
            {
              label: "Nguồn",
              done: sourceCount > 0,
            },
            {
              label: "Thông số",
              done: Boolean(material.specText.trim()),
            },
            {
              label: "NCC",
              done: Boolean(material.manufacturer?.trim()),
            },
            {
              label: "Xuất xứ",
              done: Boolean(material.originCountry?.trim()),
            },
          ]
        : [],
    [material, sourceCount],
  );
  const completedReadiness = readinessItems.filter((item) => item.done).length;
  const primarySourceLabel =
    primarySource?.label ?? (material?.sourceUrl ? "URL nguồn vật tư" : null);
  const primarySourcePrice = primarySource
    ? sourcePriceLabel(primarySource)
    : null;
  const hasImportantGaps =
    material != null && completedReadiness < readinessItems.length;
  const deletingSourceId = deletePriceSource.isPending
    ? deletePriceSource.variables?.sourceId
    : null;
  const refreshingSourceId = refreshPriceSource.isPending
    ? refreshPriceSource.variables?.sourceId
    : null;
  const applyingSourceId = applyPriceSourcePrice.isPending
    ? applyPriceSourcePrice.variables?.sourceId
    : null;
  const updatingSourceId = updatePriceSource.isPending
    ? updatePriceSource.variables?.sourceId
    : null;

  const save = useCallback(
    (event?: FormEvent<HTMLFormElement>) => {
      event?.preventDefault();
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
        },
      });
    },
    [canSave, form, id, updateMaterial],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") {
        return;
      }
      event.preventDefault();
      save();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [save]);

  const convertLegacySourceUrl = () => {
    const legacyUrl = form?.sourceUrl.trim();
    if (!legacyUrl) {
      return;
    }
    const alreadyLinked = priceSources.some(
      (source) => source.url.trim() === legacyUrl,
    );
    if (alreadyLinked) {
      toast.warning("URL này đã có trong nguồn giá.");
      return;
    }
    setPriceSourceForm({
      ...emptyPriceSourceForm,
      label: "URL nguồn vật tư",
      url: legacyUrl,
      mode: "linked",
      isPrimary: priceSources.length === 0,
    });
    setIsPricesSectionOpen(true);
    document
      .getElementById("material-prices")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
    toast.success("Đã điền URL vào form nguồn giá — bấm Thêm để lưu.");
  };

  const scrollToSection = (sectionId: string) => {
    if (sectionId === "material-prices") {
      router.push(`/materials/${id}/prices`);
      return;
    }
    if (sectionId === "material-edit") {
      router.push(`/materials/${id}/edit`);
    }
  };

  const addSource = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
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
    setDeleteSourceTarget(source);
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
    setDeleteMaterialTarget(material);
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
      <ConfirmDialog
        open={deleteMaterialTarget !== null}
        title={`Xóa vật tư "${deleteMaterialTarget?.name ?? ""}"?`}
        description="Vật tư sẽ bị ẩn khỏi danh mục hiện tại. Các dữ liệu đã nhập trước đó vẫn giữ nguyên giá trị đã lưu."
        confirmLabel="Xóa vật tư"
        variant="danger"
        isLoading={deleteMaterial.isPending}
        onConfirm={() => {
          if (!deleteMaterialTarget) return;
          setSuccessMessage(null);
          setActionError(null);
          deleteMaterial.mutate({ id: deleteMaterialTarget.id });
        }}
        onCancel={() => setDeleteMaterialTarget(null)}
      />
      <ConfirmDialog
        open={deleteSourceTarget !== null}
        title={`Xóa nguồn "${deleteSourceTarget?.label ?? ""}"?`}
        description="Nguồn giá này sẽ bị gỡ khỏi vật tư. Đơn giá hiện tại không tự thay đổi."
        confirmLabel="Xóa nguồn"
        variant="danger"
        isLoading={deleteSourceTarget?.id === deletingSourceId}
        onConfirm={() => {
          if (!deleteSourceTarget) return;
          setSuccessMessage(null);
          setActionError(null);
          deletePriceSource.mutate({
            materialId: id,
            sourceId: deleteSourceTarget.id,
          });
        }}
        onCancel={() => setDeleteSourceTarget(null)}
      />

      {view === "overview" ? (
      <section
        id="material-overview"
        className="panel scroll-mt-6 overflow-hidden"
      >
        <div className="border-b border-slate-200 bg-white px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 flex-1 gap-4">
              <MaterialImagePreview material={material} />
              <div className="min-w-0 flex-1">
              <Link
                href="/materials"
                className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 transition-colors hover:text-slate-900"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                Quay lại danh mục
              </Link>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <p className="text-xs font-semibold tracking-[0.14em] text-slate-500 uppercase">
                  Catalog vật tư
                </p>
                {material.code ? (
                  <Badge tone="info">{material.code}</Badge>
                ) : null}
                <Badge tone="success">{material.currency}</Badge>
              </div>
              <h2 className="mt-2 max-w-4xl text-2xl leading-tight font-bold [overflow-wrap:anywhere] text-slate-950">
                {material.name}
              </h2>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge
                  tone={
                    material.defaultUnitPrice == null ? "warning" : "success"
                  }
                >
                  {material.defaultUnitPrice == null ? "Thiếu giá" : "Có giá"}
                </Badge>
                <Badge tone={sourceCount === 0 ? "warning" : "info"}>
                  {sourceCount.toLocaleString("vi-VN")} nguồn
                </Badge>
                {material.category ? (
                  <Badge tone="neutral">{material.category}</Badge>
                ) : null}
              </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {material.sourceUrl ? (
                <a
                  href={material.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
                >
                  <ExternalLink className="h-4 w-4" aria-hidden />
                  Mở nguồn
                </a>
              ) : null}
              <Button
                variant="secondary"
                leftIcon={<Copy className="h-4 w-4" />}
                isLoading={duplicateMaterial.isPending}
                onClick={() => duplicateMaterial.mutate({ id })}
              >
                Nhân bản
              </Button>
              <Button
                variant="primary"
                leftIcon={<Save className="h-4 w-4" />}
                isLoading={updateMaterial.isPending}
                disabled={!canSave}
                onClick={() => save()}
              >
                Lưu
              </Button>
              <Button
                variant="danger"
                leftIcon={<Trash2 className="h-4 w-4" />}
                isLoading={deleteMaterial.isPending}
                onClick={remove}
              >
                Xóa
              </Button>
            </div>
          </div>
        </div>

        {successMessage ? (
          <div className="mx-5 mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {successMessage}
          </div>
        ) : null}
        {actionError ? (
          <div className="mx-5 mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {actionError}
          </div>
        ) : null}

        <div className="p-5">
          <dl className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <SummaryTile
              label="Đơn giá"
              value={formatMoney(
                material.defaultUnitPrice,
                material.currency,
                "Chưa có",
              )}
              helper={
                primarySourcePrice
                  ? `Nguồn chính: ${primarySourcePrice}`
                  : "Đơn giá dùng khi map vật tư"
              }
              icon={<BadgeDollarSign className="h-4 w-4" />}
              tone={material.defaultUnitPrice == null ? "amber" : "emerald"}
            />
            <SummaryTile
              label="Đơn vị"
              value={material.unit}
              helper={
                material.category?.trim() ? material.category : "Chưa phân nhóm"
              }
              icon={<Ruler className="h-4 w-4" />}
              tone="sky"
            />
            <SummaryTile
              label="Nhà sản xuất"
              value={
                material.manufacturer?.trim()
                  ? material.manufacturer
                  : "Chưa có"
              }
              helper={
                material.originCountry?.trim()
                  ? material.originCountry
                  : "Chưa có xuất xứ"
              }
              icon={<Factory className="h-4 w-4" />}
            />
            <SummaryTile
              label="Nguồn giá"
              value={primarySourceLabel ?? "Chưa có nguồn"}
              helper={
                latestCheckedSource?.lastCheckedAt
                  ? `Cập nhật ${formatDateTime(latestCheckedSource.lastCheckedAt)}`
                  : `${sourceCount.toLocaleString("vi-VN")} nguồn đã lưu`
              }
              icon={<LinkIcon className="h-4 w-4" />}
              tone={sourceCount === 0 ? "amber" : "sky"}
            />
          </dl>

          <div className="mt-4 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <article className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500">
                  <FileText className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold tracking-[0.12em] text-slate-500 uppercase">
                    Thông số kỹ thuật
                  </p>
                  <p className="mt-1 text-sm leading-6 [overflow-wrap:anywhere] text-slate-800">
                    {material.specText || "Chưa có thông số kỹ thuật."}
                  </p>
                </div>
              </div>
            </article>

            <article className="rounded-lg border border-slate-200 bg-white px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold tracking-[0.12em] text-slate-500 uppercase">
                    Mức sẵn sàng
                  </p>
                  <p className="mt-1 text-sm font-semibold text-slate-950">
                    {completedReadiness}/{readinessItems.length} thông tin quan
                    trọng
                  </p>
                </div>
                <Badge tone={hasImportantGaps ? "warning" : "success"}>
                  {hasImportantGaps ? "Cần bổ sung" : "Đủ dùng"}
                </Badge>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {readinessItems.map((item) => {
                  const targetSection =
                    item.label === "Đơn giá" || item.label === "Nguồn"
                      ? "material-prices"
                      : "material-edit";
                  return (
                    <button
                      key={item.label}
                      type="button"
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-semibold transition hover:ring-2 hover:ring-sky-200 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none ${
                        item.done
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-slate-200 bg-slate-50 text-slate-500"
                      }`}
                      onClick={() => scrollToSection(targetSection)}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </article>
          </div>
        </div>
      </section>
      ) : null}

      {view === "prices" ? (
      <section
        id="material-prices"
        className="panel scroll-mt-6 overflow-hidden"
      >
        <button
          type="button"
          className="flex w-full items-start justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-slate-50/80 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
          onClick={() => setIsPricesSectionOpen((open) => !open)}
          aria-expanded={isPricesSectionOpen}
          aria-controls="material-prices-content"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <LinkIcon className="h-4 w-4 text-emerald-700" aria-hidden />
              <h3 className="text-sm font-bold text-slate-950">
                Link sản phẩm và giá
              </h3>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Lưu link tham khảo, giá cố định, hoặc lấy giá mới từ trang sản
              phẩm rồi áp dụng vào đơn giá.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2 pt-0.5">
            <Badge tone="info" count={priceSources.length}>
              Nguồn
            </Badge>
            <ChevronDown
              className={`h-4 w-4 text-slate-500 transition-transform duration-200 ${
                isPricesSectionOpen ? "rotate-180" : ""
              }`}
              aria-hidden
            />
          </div>
        </button>

        {isPricesSectionOpen ? (
          <div
            id="material-prices-content"
            className="grid gap-4 border-t border-slate-200 p-5 xl:grid-cols-[0.85fr_1.15fr]"
          >
        <article className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="border-b border-slate-200 pb-3">
            <h4 className="text-sm font-bold text-slate-950">Thêm nguồn giá</h4>
            <p className="mt-1 text-xs text-slate-500">
              Điền link sản phẩm hoặc giá cố định để lưu vào catalog.
            </p>
          </div>

          <form className="mt-4 grid gap-3" onSubmit={addSource}>
            <Field label="Tên nguồn">
              <input
                name="priceSourceLabel"
                autoComplete="organization"
                className={inputClass}
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
                  name="priceSourceMode"
                  className={inputClass}
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
                  name="priceSourceCurrency"
                  autoComplete="off"
                  className={inputClass}
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
              {priceSourceForm.mode === "linked" ? (
                <input
                  name="priceSourceUrl"
                  type="url"
                  autoComplete="url"
                  className={inputClass}
                  placeholder="https://example.com/bao-gia…"
                  value={priceSourceForm.url}
                  onChange={(event) =>
                    setPriceSourceForm({
                      ...priceSourceForm,
                      url: event.target.value,
                    })
                  }
                />
              ) : (
                <p className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  Không cần URL khi dùng giá cố định.
                </p>
              )}
            </Field>

            {priceSourceForm.mode === "fixed" ? (
              <Field label="Giá cố định">
                <input
                  name="priceSourceFixedPrice"
                  className={inputClass}
                  type="number"
                  min={0}
                  inputMode="decimal"
                  placeholder="Nhập giá cố định"
                  value={priceSourceForm.fixedPrice}
                  onChange={(event) =>
                    setPriceSourceForm({
                      ...priceSourceForm,
                      fixedPrice: event.target.value,
                    })
                  }
                />
              </Field>
            ) : null}

            <Field label="Ghi chú">
              <textarea
                name="priceSourceNote"
                autoComplete="off"
                className={`${textareaClass} min-h-20`}
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
                name="priceSourcePrimary"
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
              type="submit"
              variant="primary"
              leftIcon={<Plus className="h-4 w-4" />}
              disabled={!canAddPriceSource}
              isLoading={addPriceSource.isPending}
            >
              Thêm link / nguồn giá
            </Button>
          </form>
        </article>

        <article className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="border-b border-slate-200 pb-3">
            <h4 className="text-sm font-bold text-slate-950">
              Nguồn giá đã lưu
            </h4>
            <p className="mt-1 text-xs text-slate-500">
              Giá link được dò từ nội dung trang; giá cố định có thể áp dụng
              ngay cho vật tư.
            </p>
          </div>

          {priceSources.length === 0 ? (
            <EmptyState
              className="mt-3"
              title="Chưa có link sản phẩm hoặc nguồn giá."
              description="Thêm link nhà cung cấp hoặc giá cố định để cập nhật đơn giá khi cần."
            />
          ) : (
            <ul className="mt-3 space-y-2">
              {priceSources.map((source) => (
                <PriceSourceCard
                  key={source.id}
                  source={source}
                  refreshPending={refreshingSourceId === source.id}
                  applyPending={applyingSourceId === source.id}
                  deletePending={deletingSourceId === source.id}
                  updatePending={updatingSourceId === source.id}
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
          </div>
        ) : null}
      </section>
      ) : null}

      {view === "documents" ? (
      <MaterialCatalogPdfSection materialId={id} defaultExpanded />
      ) : null}

      {view === "edit" ? (
      <section
        id="material-edit"
        className="panel scroll-mt-6 overflow-hidden"
      >
        <button
          type="button"
          className="flex w-full items-start justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-slate-50/80 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
          onClick={() => setIsEditSectionOpen((open) => !open)}
          aria-expanded={isEditSectionOpen}
          aria-controls="material-edit-content"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Pencil className="h-4 w-4 text-amber-700" aria-hidden />
              <h3 className="text-sm font-bold text-slate-950">
                Thông tin vật tư
              </h3>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Chỉnh sửa dữ liệu catalog dùng cho nhập liệu và chuẩn hóa vật
              tư.
            </p>
          </div>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-slate-500 transition-transform duration-200 ${
              isEditSectionOpen ? "rotate-180" : ""
            }`}
            aria-hidden
          />
        </button>

        {isEditSectionOpen ? (
          <div
            id="material-edit-content"
            className="grid gap-4 border-t border-slate-200 p-5 xl:grid-cols-[1.25fr_0.75fr]"
          >
        <article className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="border-b border-slate-200 pb-3">
            <h4 className="text-sm font-bold text-slate-950">Form chỉnh sửa</h4>
            <p className="mt-1 text-xs text-slate-500">
              Cập nhật mã, tên, đơn giá, thông số và metadata catalog. Biểu
              tượng khóa giúp giữ trường khi scrape/import lại.
            </p>
          </div>

          <form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={save}>
            <LockableField
              label="Mã vật tư"
              fieldKey="code"
              locked={Boolean(fieldLocks.code)}
              onToggleLock={toggleFieldLock}
            >
              <input
                name="code"
                autoComplete="off"
                className={inputClass}
                value={form.code}
                onChange={(event) =>
                  setForm({ ...form, code: event.target.value })
                }
              />
            </LockableField>
            <LockableField
              label="Tên vật tư"
              fieldKey="name"
              locked={Boolean(fieldLocks.name)}
              onToggleLock={toggleFieldLock}
            >
              <input
                name="name"
                autoComplete="off"
                className={inputClass}
                value={form.name}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
              />
            </LockableField>
            <LockableField
              label="ĐVT"
              fieldKey="unit"
              locked={Boolean(fieldLocks.unit)}
              onToggleLock={toggleFieldLock}
            >
              <input
                name="unit"
                autoComplete="off"
                className={inputClass}
                value={form.unit}
                onChange={(event) =>
                  setForm({ ...form, unit: event.target.value })
                }
              />
            </LockableField>
            <LockableField
              label="Nhóm"
              fieldKey="category"
              locked={Boolean(fieldLocks.category)}
              onToggleLock={toggleFieldLock}
            >
              <input
                name="category"
                autoComplete="off"
                className={inputClass}
                value={form.category}
                onChange={(event) =>
                  setForm({ ...form, category: event.target.value })
                }
              />
            </LockableField>
            <LockableField
              label="Nhà sản xuất / NCC"
              fieldKey="manufacturer"
              locked={Boolean(fieldLocks.manufacturer)}
              onToggleLock={toggleFieldLock}
            >
              <input
                name="manufacturer"
                autoComplete="organization"
                className={inputClass}
                value={form.manufacturer}
                onChange={(event) =>
                  setForm({ ...form, manufacturer: event.target.value })
                }
              />
            </LockableField>
            <LockableField
              label="Xuất xứ"
              fieldKey="originCountry"
              locked={Boolean(fieldLocks.originCountry)}
              onToggleLock={toggleFieldLock}
            >
              <input
                name="originCountry"
                autoComplete="country-name"
                className={inputClass}
                value={form.originCountry}
                onChange={(event) =>
                  setForm({ ...form, originCountry: event.target.value })
                }
              />
            </LockableField>
            <LockableField
              label="Đơn giá"
              fieldKey="defaultUnitPrice"
              locked={Boolean(fieldLocks.defaultUnitPrice)}
              onToggleLock={toggleFieldLock}
            >
              <input
                name="defaultUnitPrice"
                className={inputClass}
                type="number"
                min={0}
                inputMode="decimal"
                value={form.defaultUnitPrice}
                onChange={(event) =>
                  setForm({ ...form, defaultUnitPrice: event.target.value })
                }
              />
            </LockableField>
            <LockableField
              label="Tiền tệ"
              fieldKey="currency"
              locked={Boolean(fieldLocks.currency)}
              onToggleLock={toggleFieldLock}
            >
              <input
                name="currency"
                autoComplete="off"
                className={inputClass}
                value={form.currency}
                onChange={(event) =>
                  setForm({ ...form, currency: event.target.value })
                }
              />
            </LockableField>
            <LockableField
              label="URL nguồn (legacy)"
              fieldKey="sourceUrl"
              locked={Boolean(fieldLocks.sourceUrl)}
              onToggleLock={toggleFieldLock}
              className="md:col-span-2"
            >
              <input
                name="sourceUrl"
                type="url"
                autoComplete="url"
                className={inputClass}
                value={form.sourceUrl}
                onChange={(event) =>
                  setForm({ ...form, sourceUrl: event.target.value })
                }
              />
              <p className="mt-1 text-xs text-slate-500">
                Trường cũ, chỉ lưu link tham khảo. Nên dùng mục Nguồn giá để
                quản lý link, cập nhật và áp dụng giá.
              </p>
              {form.sourceUrl.trim() ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  onClick={convertLegacySourceUrl}
                >
                  Chuyển sang nguồn giá
                </Button>
              ) : null}
            </LockableField>
            <LockableField
              label="Thông số kỹ thuật"
              fieldKey="specText"
              locked={Boolean(fieldLocks.specText)}
              onToggleLock={toggleFieldLock}
              className="md:col-span-2"
            >
              <textarea
                name="specText"
                autoComplete="off"
                className={`${textareaClass} min-h-28`}
                value={form.specText}
                onChange={(event) =>
                  setForm({ ...form, specText: event.target.value })
                }
              />
            </LockableField>
          </form>
        </article>

        <aside className="space-y-4">
          <article className="rounded-lg border border-slate-200 bg-white p-5">
            <h3 className="text-sm font-bold text-slate-950">
              Thiết lập vật tư
            </h3>
            <dl className="mt-3 space-y-2">
              <DetailRow
                label="Mã catalog"
                value={
                  material.code?.trim() ? material.code : `#${material.id}`
                }
                icon={<Package className="h-4 w-4" />}
              />
              <DetailRow
                label="Nhóm"
                value={
                  material.category?.trim()
                    ? material.category
                    : "Chưa phân nhóm"
                }
                icon={<Tag className="h-4 w-4" />}
              />
              <DetailRow
                label="Xuất xứ"
                value={
                  material.originCountry?.trim()
                    ? material.originCountry
                    : "Chưa có"
                }
                icon={<Globe2 className="h-4 w-4" />}
              />
            </dl>
          </article>

          <article className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-slate-950">Ảnh sản phẩm</h3>
              <button
                type="button"
                className="inline-flex items-center rounded p-0.5 text-slate-400 transition hover:text-amber-600"
                title={
                  fieldLocks.imageUrl
                    ? "Đã khóa — không ghi đè khi scrape lại"
                    : "Khóa ảnh khi scrape lại"
                }
                aria-pressed={Boolean(fieldLocks.imageUrl)}
                aria-label="Khóa ảnh sản phẩm"
                onClick={() => toggleFieldLock("imageUrl", !fieldLocks.imageUrl)}
              >
                <Lock
                  className={`h-3.5 w-3.5 ${fieldLocks.imageUrl ? "text-amber-600" : ""}`}
                />
              </button>
            </div>
            <div className="mt-3">
              <MaterialImagePreview material={material} />
            </div>
          </article>

          <article className="rounded-lg border border-slate-200 bg-white p-5">
            <h3 className="text-sm font-bold text-slate-950">Metadata</h3>
            <dl className="mt-3 space-y-2">
              {metadataRows.map(([label, value]) => (
                <DetailRow
                  key={label}
                  label={label}
                  value={value}
                  icon={<Clock className="h-4 w-4" />}
                />
              ))}
            </dl>
          </article>
        </aside>
          </div>
        ) : null}
      </section>
      ) : null}

      {view === "edit" && isDirty ? (
        <div className="sticky bottom-4 z-20 mx-auto flex max-w-3xl items-center justify-between gap-3 rounded-xl border border-sky-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur">
          <p className="text-sm font-semibold text-slate-800">
            Có thay đổi chưa lưu
          </p>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (savedFormSnapshot) {
                  setForm(savedFormSnapshot);
                }
              }}
            >
              Hoàn tác
            </Button>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Save className="h-4 w-4" />}
              isLoading={updateMaterial.isPending}
              disabled={!canSave}
              onClick={() => save()}
            >
              Lưu thay đổi
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
