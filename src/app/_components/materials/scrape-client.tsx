"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  ArrowUpRight,
  CheckSquare,
  Clock3,
  ExternalLink,
  Eye,
  Link as LinkIcon,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Square,
  StopCircle,
  Trash2,
  Upload,
} from "lucide-react";

import { Badge, Button, ConfirmDialog, EmptyState } from "~/app/_components/ui";
import { MatchCompareDrawer } from "~/app/_components/materials/match-compare-drawer";
import { ScrapeProgressBar } from "~/app/_components/materials/scrape-progress-bar";
import { ScrapeJobsList } from "~/app/_components/materials/scrape-jobs-list";
import { ScrapeProductDetailDialog } from "~/app/_components/materials/scrape-product-detail-dialog";
import { ScrapeProductReviewCard } from "~/app/_components/materials/scrape-product-review-card";
import {
  ACTIVE_CLOCK_MS,
  canImportJob,
  DEFAULT_MAX_PAGES,
  DEFAULT_MAX_PRODUCTS,
  DEFAULT_PRODUCT_PAGE_SIZE,
  EMPTY_UUID,
  formatMoney,
  hostFromUrl,
  isImportJobActive,
  isJobActive,
  isNotFoundTRPCError,
  IMPORT_POLL_MS,
  JOB_LIST_POLL_MS,
  MAX_PAGE_LIMIT,
  MAX_PRODUCT_LIMIT,
  productKey,
  progressPercent,
  readStoredJobId,
  SCRAPE_JOBS_LIST_CAP,
  SCRAPE_POLL_MS,
  SHOP_JOB_CACHE_MS,
  SHOP_SCRAPE_FOCUSED_JOB_STORAGE_KEY,
  shortJobId,
  writeStoredJobId,
  type DetailEnrichmentMode,
  type ImportJob,
  type ScrapeJob,
  type ScrapeMethod,
  type ScrapeMode,
  type ScrapedProduct,
} from "~/app/_components/materials/scrape-job-utils";
import { useToast } from "~/app/_components/ui/toast";
import { sanitizeScrapedProductList } from "~/lib/materials/shop-promo-badges";
import {
  matchesQualityFilter,
  qualityFlags,
  SCRAPE_QUALITY_FLAG_LABELS,
  type ScrapeProductQualityFilter,
} from "~/lib/materials/scrape-product-quality";
import {
  SCRAPE_QUALITY_FILTER_OPTIONS,
  actionLabel,
  actionTone,
  clampNumber,
  detailEnrichmentHelp,
  detailEnrichmentLabel,
  emptyScrapedProduct,
  formatDuration,
  formatLimit,
  importStatusLabel,
  importStatusTone,
  productDisplayId,
  productInfoSummary,
  productMissingLabels,
  scrapeMethodHelp,
  scrapeMethodLabel,
  scrapeModeLabel,
  statusLabel,
  statusTone,
  stopReasonLabel,
} from "~/app/_components/materials/scrape-display";
import { api, type RouterOutputs } from "~/trpc/react";

type PendingScrapeJob = {
  url: string;
  scrapeMode: ScrapeMode;
  maxPages: number | null;
  maxProducts: number | null;
  method: ScrapeMethod;
  detailEnrichment: DetailEnrichmentMode;
  startedAt: number;
};

function normalizeImportPreviewSummary(
  summary:
    | (Partial<RouterOutputs["material"]["previewShopImportJob"]["summary"]> & {
        skipReview?: number;
      })
    | null
    | undefined,
): RouterOutputs["material"]["previewShopImportJob"]["summary"] {
  const create = Number(summary?.create ?? 0);
  const update =
    Number(summary?.update ?? 0) + Number(summary?.skipReview ?? 0);
  const skipNoName = Number(summary?.skipNoName ?? 0);
  const total = Number(summary?.total ?? create + update + skipNoName);

  return { create, update, skipNoName, total };
}

function ImportPreviewSummaryPanel({
  summary,
}: {
  summary:
    | (Partial<RouterOutputs["material"]["previewShopImportJob"]["summary"]> & {
        skipReview?: number;
      })
    | null
    | undefined;
}) {
  const normalized = normalizeImportPreviewSummary(summary);

  return (
    <div className="mt-4 space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <PreviewCountCard label="Tạo mới" value={normalized.create} tone="success" />
        <PreviewCountCard label="Cập nhật" value={normalized.update} tone="info" />
        <PreviewCountCard
          label="Thiếu tên"
          value={normalized.skipNoName}
          tone="neutral"
        />
      </div>
      <p className="text-xs text-slate-700">
        Tổng {normalized.total.toLocaleString("vi-VN")} sản phẩm trong lần nhập
        này. Các sản phẩm trùng catalog sẽ được ghép tự động khi nhập.
      </p>
    </div>
  );
}

function PreviewCountCard({
  label,
  value,
  tone,
}: {
  label: string;
  value?: number | null;
  tone: "success" | "info" | "warning" | "neutral";
}) {
  const displayValue = Number.isFinite(value) ? Number(value) : 0;
  const toneClass =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : tone === "info"
        ? "border-blue-200 bg-blue-50 text-blue-900"
        : tone === "warning"
          ? "border-amber-200 bg-amber-50 text-amber-900"
          : "border-slate-400 bg-slate-50 text-slate-700";

  return (
    <div className={`rounded border px-3 py-2 ${toneClass}`}>
      <p className="text-xs font-semibold uppercase tracking-wide opacity-80">
        {label}
      </p>
      <p className="mt-1 text-lg font-bold tabular-nums">
        {displayValue.toLocaleString("vi-VN")}
      </p>
    </div>
  );
}

export function MaterialScrapeClient({ jobId: routeJobId }: { jobId?: string } = {}) {
  const router = useRouter();
  const isJobPage = routeJobId != null;
  const [shopUrl, setShopUrl] = useState("");
  const [scrapeMode, setScrapeMode] = useState<ScrapeMode>("limited");
  const [scrapeMethod, setScrapeMethod] = useState<ScrapeMethod>("auto");
  const [detailEnrichment, setDetailEnrichment] =
    useState<DetailEnrichmentMode>("missing_fields");
  const [maxPages, setMaxPages] = useState(DEFAULT_MAX_PAGES);
  const [maxProducts, setMaxProducts] = useState(DEFAULT_MAX_PRODUCTS);
  const [focusedJobId, setFocusedJobId] = useState<string | null>(
    routeJobId ?? null,
  );
  const [startedJob, setStartedJob] = useState<ScrapeJob | null>(null);
  const [pendingScrapeJob, setPendingScrapeJob] =
    useState<PendingScrapeJob | null>(null);
  const [importJobId, setImportJobId] = useState<string | null>(null);
  const [startedImportJob, setStartedImportJob] = useState<ImportJob | null>(
    null,
  );
  const [finalizedScrapeJobId, setFinalizedScrapeJobId] = useState<
    string | null
  >(null);
  const [finalizedImportJobId, setFinalizedImportJobId] = useState<
    string | null
  >(null);
  const [selectedSourceUrls, setSelectedSourceUrls] = useState<Set<string>>(
    () => new Set(),
  );
  const [detailProductKey, setDetailProductKey] = useState<string | null>(null);
  const [detailDraft, setDetailDraft] = useState<ScrapedProduct | null>(null);
  const [detailOriginalSourceUrl, setDetailOriginalSourceUrl] = useState<
    string | null
  >(null);
  const [isCreatingProduct, setIsCreatingProduct] = useState(false);
  const [deleteProductTarget, setDeleteProductTarget] =
    useState<ScrapedProduct | null>(null);
  const [bulkDeleteSelectedOpen, setBulkDeleteSelectedOpen] = useState(false);
  const [compareProducts, setCompareProducts] = useState<ScrapedProduct[]>([]);
  const [compareIndex, setCompareIndex] = useState(0);
  const [stopJobTarget, setStopJobTarget] = useState<{
    id: string;
    url: string;
  } | null>(null);
  const [deleteJobTarget, setDeleteJobTarget] = useState<{
    id: string;
    url: string;
  } | null>(null);
  const [cancelImportOpen, setCancelImportOpen] = useState(false);
  const [importPreviewOpen, setImportPreviewOpen] = useState(false);
  const [importPreviewTarget, setImportPreviewTarget] = useState<{
    productSourceUrls?: string[];
  } | null>(null);
  const [importPreviewData, setImportPreviewData] =
    useState<RouterOutputs["material"]["previewShopImportJob"] | null>(null);
  const [importPreviewLoading, setImportPreviewLoading] = useState(false);
  const [qualityFilter, setQualityFilter] =
    useState<ScrapeProductQualityFilter>("all");
  const [hideMissingNameProducts, setHideMissingNameProducts] = useState(true);
  const [missingJobMessage, setMissingJobMessage] = useState<string | null>(
    null,
  );
  const [productPageIndex, setProductPageIndex] = useState(0);
  const [productPageSize, setProductPageSize] = useState(
    DEFAULT_PRODUCT_PAGE_SIZE,
  );
  const [clockMs, setClockMs] = useState(() => Date.now());
  const utils = api.useUtils();
  const toast = useToast();

  useEffect(() => {
    setMissingJobMessage(null);
    if (routeJobId != null) {
      setFocusedJobId(routeJobId);
    } else {
      const storedJobId = readStoredJobId(SHOP_SCRAPE_FOCUSED_JOB_STORAGE_KEY);
      setFocusedJobId(storedJobId);
    }
    writeStoredJobId("bidtool:shop-scrape-job:v1", null);
    writeStoredJobId("bidtool:shop-import-job:v1", null);
  }, [routeJobId]);

  useEffect(() => {
    writeStoredJobId(SHOP_SCRAPE_FOCUSED_JOB_STORAGE_KEY, focusedJobId);
  }, [focusedJobId]);

  const jobListQuery = api.material.listShopScrapeJobs.useQuery(
    { limit: SCRAPE_JOBS_LIST_CAP },
    {
    refetchInterval: (query) => {
      const jobs = query.state.data ?? [];
      return jobs.some(isJobActive) || pendingScrapeJob
        ? JOB_LIST_POLL_MS
        : false;
    },
    refetchOnWindowFocus: false,
    staleTime: 0,
    gcTime: SHOP_JOB_CACHE_MS,
  });

  const focusedListJob =
    jobListQuery.data?.find((job) => job.id === focusedJobId) ?? null;
  const progressSeedJob =
    (startedJob?.id === focusedJobId ? startedJob : null) ?? focusedListJob;
  const listSaysPollJobProgress =
    focusedJobId !== null &&
    (pendingScrapeJob !== null || isJobActive(progressSeedJob));

  const jobProgressQuery = api.material.getShopScrapeJobProgress.useQuery(
    { jobId: focusedJobId ?? EMPTY_UUID },
    {
      enabled: listSaysPollJobProgress,
      refetchInterval: listSaysPollJobProgress ? SCRAPE_POLL_MS : false,
      refetchOnWindowFocus: false,
      retry: false,
      staleTime: 0,
      gcTime: SHOP_JOB_CACHE_MS,
    },
  );
  const shouldPollJobProgress =
    focusedJobId !== null &&
    (pendingScrapeJob !== null ||
      (isJobActive(progressSeedJob) &&
        (jobProgressQuery.data?.id !== focusedJobId ||
          isJobActive(jobProgressQuery.data))));

  const jobQuery = api.material.getShopScrapeJob.useQuery(
    { jobId: focusedJobId ?? EMPTY_UUID },
    {
      enabled: focusedJobId !== null && !shouldPollJobProgress,
      refetchOnWindowFocus: false,
      retry: false,
      staleTime: 0,
      gcTime: SHOP_JOB_CACHE_MS,
    },
  );
  const importJobsQuery = api.material.listShopImportJobs.useQuery(
    { scrapeJobId: focusedJobId ?? EMPTY_UUID },
    {
      enabled: focusedJobId !== null,
      refetchInterval: (query) => {
        const jobs = query.state.data ?? [];
        return jobs.some(isImportJobActive) ? JOB_LIST_POLL_MS : false;
      },
      refetchOnWindowFocus: false,
      retry: false,
      staleTime: 0,
      gcTime: SHOP_JOB_CACHE_MS,
    },
  );
  const importProgressSeedJob =
    (startedImportJob?.id === importJobId ? startedImportJob : null) ??
    (importJobsQuery.data?.find((job) => job.id === importJobId) ?? null);
  const listSaysPollImportProgress =
    importJobId !== null && isImportJobActive(importProgressSeedJob);

  const importJobProgressQuery = api.material.getShopImportJobProgress.useQuery(
    { jobId: importJobId ?? EMPTY_UUID },
    {
      enabled: listSaysPollImportProgress,
      refetchInterval: listSaysPollImportProgress ? IMPORT_POLL_MS : false,
      refetchOnWindowFocus: false,
      retry: false,
      staleTime: 0,
      gcTime: SHOP_JOB_CACHE_MS,
    },
  );
  const shouldPollImportProgress =
    importJobId !== null &&
    isImportJobActive(importProgressSeedJob) &&
    (importJobProgressQuery.data?.id !== importJobId ||
      isImportJobActive(importJobProgressQuery.data));
  const importJobQuery = api.material.getShopImportJob.useQuery(
    { jobId: importJobId ?? EMPTY_UUID },
    {
      enabled: importJobId !== null && !shouldPollImportProgress,
      refetchOnWindowFocus: false,
      retry: false,
      staleTime: 0,
      gcTime: SHOP_JOB_CACHE_MS,
    },
  );
  const activeJob = useMemo(() => {
    const fullJob =
      jobQuery.data ?? (startedJob?.id === focusedJobId ? startedJob : null);
    const progressJob = jobProgressQuery.data;

    if (fullJob && !isJobActive(fullJob)) {
      return fullJob;
    }

    if (shouldPollJobProgress && progressJob) {
      return {
        ...progressJob,
        products: fullJob?.products ?? [],
        productsEditable: fullJob?.productsEditable ?? false,
      } as ScrapeJob;
    }

    return fullJob;
  }, [
    focusedJobId,
    jobProgressQuery.data,
    jobQuery.data,
    shouldPollJobProgress,
    startedJob,
  ]);
  const activeImportJob = useMemo(() => {
    const fullJob =
      importJobQuery.data ??
      (startedImportJob?.id === importJobId ? startedImportJob : null);
    const progressJob = importJobProgressQuery.data;

    if (fullJob && !isImportJobActive(fullJob)) {
      return fullJob;
    }

    if (shouldPollImportProgress && progressJob) {
      return {
        ...progressJob,
        items: fullJob?.items ?? [],
      } as ImportJob;
    }

    return fullJob;
  }, [
    importJobId,
    importJobProgressQuery.data,
    importJobQuery.data,
    shouldPollImportProgress,
    startedImportJob,
  ]);
  const jobRows = jobListQuery.data ?? [];
  const hasActiveListJob = jobRows.some(isJobActive);
  const isActive = isJobActive(activeJob);
  const isImportActive = isImportJobActive(activeImportJob);
  const isStartingScrape = !!pendingScrapeJob;
  const canStart = shopUrl.trim().length > 0 && !isStartingScrape;
  const selectedCount = selectedSourceUrls.size;
  const scrapeProducts = useMemo(
    () => sanitizeScrapedProductList(activeJob?.products ?? []),
    [activeJob?.products],
  );
  const filteredScrapeProducts = useMemo(
    () =>
      scrapeProducts.filter((product) =>
        matchesQualityFilter(product, qualityFilter, {
          hideMissingName: hideMissingNameProducts,
        }),
      ),
    [hideMissingNameProducts, qualityFilter, scrapeProducts],
  );
  const productPageCount = Math.max(
    1,
    Math.ceil(filteredScrapeProducts.length / productPageSize),
  );
  const pagedScrapeProducts = useMemo(() => {
    const start = productPageIndex * productPageSize;
    return filteredScrapeProducts.slice(start, start + productPageSize);
  }, [filteredScrapeProducts, productPageIndex, productPageSize]);
  const isPartialImportableJob =
    !!activeJob &&
    (activeJob.status === "failed" || activeJob.status === "cancelled") &&
    activeJob.productCount > 0 &&
    !activeJob.isExpired;
  const allProductKeys = useMemo(
    () => new Set(scrapeProducts.map(productKey)),
    [scrapeProducts],
  );
  const filteredProductKeys = useMemo(
    () => new Set(filteredScrapeProducts.map(productKey)),
    [filteredScrapeProducts],
  );
  const allSelected =
    filteredProductKeys.size > 0 &&
    Array.from(filteredProductKeys).every((key) => selectedSourceUrls.has(key));
  const canImportSelected =
    canImportJob(activeJob, scrapeProducts.length) &&
    selectedCount > 0 &&
    !isImportActive;
  const canImportAll =
    canImportJob(activeJob, scrapeProducts.length) && !isImportActive;
  const canEditScrapeProducts =
    !!activeJob && activeJob.productsEditable && !isImportActive;
  const canDeleteSelected = canEditScrapeProducts && selectedCount > 0;
  const detailProductIndex =
    activeJob && detailProductKey
      ? scrapeProducts.findIndex(
          (product) => productKey(product) === detailProductKey,
        )
      : -1;
  const scrapeJobPollingError =
    (jobProgressQuery.isError && !isNotFoundTRPCError(jobProgressQuery.error)
      ? (jobProgressQuery.error.message ?? "Không cập nhật được tiến độ scrape.")
      : null) ??
    (jobQuery.isError && !isNotFoundTRPCError(jobQuery.error)
      ? (jobQuery.error.message ?? "Không cập nhật được tiến độ scrape.")
      : null);
  const isJobDetailLoading =
    isJobPage &&
    missingJobMessage == null &&
    focusedJobId !== null &&
    !activeJob &&
    (jobQuery.isLoading || jobProgressQuery.isLoading);
  const importJobPollingError =
    (importJobProgressQuery.isError &&
    !isNotFoundTRPCError(importJobProgressQuery.error)
      ? (importJobProgressQuery.error.message ??
        "Không cập nhật được tiến độ nhập catalog.")
      : null) ??
    (importJobQuery.isError && !isNotFoundTRPCError(importJobQuery.error)
      ? (importJobQuery.error.message ??
        "Không cập nhật được tiến độ nhập catalog.")
      : null);

  useEffect(() => {
    if (!focusedJobId || shouldPollJobProgress) {
      return;
    }
    void jobQuery.refetch();
  }, [focusedJobId, shouldPollJobProgress, jobQuery]);

  useEffect(() => {
    if (!importJobId || shouldPollImportProgress) {
      return;
    }
    void importJobQuery.refetch();
  }, [importJobId, shouldPollImportProgress, importJobQuery]);

  useEffect(() => {
    setProductPageIndex(0);
  }, [qualityFilter, hideMissingNameProducts, activeJob?.id]);

  useEffect(() => {
    if (productPageIndex + 1 > productPageCount) {
      setProductPageIndex(Math.max(0, productPageCount - 1));
    }
  }, [productPageCount, productPageIndex]);

  useEffect(() => {
    const latestImportJob = importJobsQuery.data?.[0] ?? null;
    if (!latestImportJob) {
      if (startedImportJob?.scrapeJobId !== focusedJobId) {
        setImportJobId(null);
        setStartedImportJob(null);
      }
      return;
    }

    if (latestImportJob.scrapeJobId === focusedJobId) {
      const importJobIds = new Set(
        (importJobsQuery.data ?? []).map((job) => job.id),
      );
      setImportJobId((current) =>
        current && importJobIds.has(current) ? current : latestImportJob.id,
      );
    }
  }, [focusedJobId, importJobsQuery.data, startedImportJob]);

  useEffect(() => {
    if (
      !pendingScrapeJob &&
      !isActive &&
      !isImportActive &&
      !hasActiveListJob
    ) {
      return;
    }

    const timerId = window.setInterval(
      () => setClockMs(Date.now()),
      ACTIVE_CLOCK_MS,
    );
    return () => window.clearInterval(timerId);
  }, [pendingScrapeJob, isActive, isImportActive, hasActiveListJob]);

  useEffect(() => {
    setSelectedSourceUrls((previous) => {
      if (previous.size === 0) {
        return previous;
      }
      const next = new Set<string>();
      for (const key of previous) {
        if (allProductKeys.has(key)) {
          next.add(key);
        }
      }
      return next.size === previous.size ? previous : next;
    });
  }, [allProductKeys]);

  useEffect(() => {
    if (
      !focusedJobId ||
      !jobQuery.isError ||
      !isNotFoundTRPCError(jobQuery.error)
    ) {
      return;
    }

    const message = "Không tìm thấy job scrape shop hoặc job đã hết hạn.";
    if (isJobPage) {
      setMissingJobMessage(message);
      setFocusedJobId(null);
      setStartedJob(null);
      setPendingScrapeJob(null);
      setFinalizedScrapeJobId(null);
      setSelectedSourceUrls(new Set());
      return;
    }

    setFocusedJobId(null);
    setStartedJob(null);
    setPendingScrapeJob(null);
    setFinalizedScrapeJobId(null);
    setSelectedSourceUrls(new Set());
    toast.warning("Job scrape đã hết hạn trên server, đã xóa trạng thái cũ.");
  }, [focusedJobId, isJobPage, jobQuery.error, jobQuery.isError, toast]);

  useEffect(() => {
    const job = jobQuery.data;
    if (!focusedJobId || !job?.isExpired) {
      return;
    }

    const message = job.error ?? "Job scrape đã hết hạn trên server.";
    if (isJobPage) {
      setMissingJobMessage(message);
      setFocusedJobId(null);
      setStartedJob(null);
      setPendingScrapeJob(null);
      setFinalizedScrapeJobId(null);
      setSelectedSourceUrls(new Set());
      return;
    }

    setFocusedJobId(null);
    setStartedJob(null);
    setPendingScrapeJob(null);
    setFinalizedScrapeJobId(null);
    setSelectedSourceUrls(new Set());
    toast.warning(message);
  }, [focusedJobId, isJobPage, jobQuery.data, toast]);

  useEffect(() => {
    if (
      !importJobId ||
      !importJobQuery.isError ||
      !isNotFoundTRPCError(importJobQuery.error)
    ) {
      return;
    }

    setImportJobId(null);
    setStartedImportJob(null);
    setFinalizedImportJobId(null);
    toast.warning(
      "Job nhập catalog đã hết hạn trên server, đã xóa trạng thái cũ.",
    );
  }, [importJobId, importJobQuery.error, importJobQuery.isError, toast]);

  const startShopScrapeJob = api.material.startShopScrapeJob.useMutation({
    onSuccess: (job) => {
      setStartedJob(job);
      setFocusedJobId(job.id);
      setPendingScrapeJob(null);
      setStartedImportJob(null);
      setImportJobId(null);
      setFinalizedScrapeJobId(null);
      setFinalizedImportJobId(null);
      setSelectedSourceUrls(new Set());
      utils.material.getShopScrapeJob.setData({ jobId: job.id }, job);
      void utils.material.listShopScrapeJobs.invalidate();
      toast.success("Đã bắt đầu job scrape shop.");
    },
    onError: (error) => {
      setPendingScrapeJob(null);
      toast.error(error.message || "Không thể bắt đầu scrape shop.");
    },
  });

  const cancelShopScrapeJob = api.material.cancelShopScrapeJob.useMutation({
    onSuccess: (job) => {
      setStartedJob(job);
      utils.material.getShopScrapeJob.setData({ jobId: job.id }, job);
      void utils.material.listShopScrapeJobs.invalidate();
      toast.warning("Đã hủy job scrape shop.");
    },
    onError: (error) => {
      toast.error(error.message || "Không thể hủy job scrape shop.");
    },
  });

  const syncFocusedScrapeJob = (job: ScrapeJob) => {
    utils.material.getShopScrapeJob.setData({ jobId: job.id }, job);
    if (focusedJobId === job.id) {
      setStartedJob(job);
    }
    void utils.material.listShopScrapeJobs.invalidate();
  };

  const updateShopScrapeJobProduct =
    api.material.updateShopScrapeJobProduct.useMutation({
      onSuccess: (job) => {
        syncFocusedScrapeJob(job);
        if (detailOriginalSourceUrl) {
          setSelectedSourceUrls((previous) => {
            if (!previous.has(detailOriginalSourceUrl)) {
              return previous;
            }
            const next = new Set(previous);
            next.delete(detailOriginalSourceUrl);
            if (detailDraft) {
              next.add(detailDraft.sourceUrl);
            }
            return next;
          });
        }
        closeProductDetail();
        toast.success("Đã lưu sản phẩm scrape.");
      },
      onError: (error) => {
        toast.error(error.message || "Không thể lưu sản phẩm scrape.");
      },
    });

  const deleteShopScrapeJobProduct =
    api.material.deleteShopScrapeJobProduct.useMutation({
      onSuccess: (job) => {
        syncFocusedScrapeJob(job);
        if (deleteProductTarget) {
          setSelectedSourceUrls((previous) => {
            if (!previous.has(deleteProductTarget.sourceUrl)) {
              return previous;
            }
            const next = new Set(previous);
            next.delete(deleteProductTarget.sourceUrl);
            return next;
          });
        }
        setDeleteProductTarget(null);
        closeProductDetail();
        toast.success("Đã xóa sản phẩm khỏi job scrape.");
      },
      onError: (error) => {
        toast.error(error.message || "Không thể xóa sản phẩm scrape.");
      },
    });

  const deleteShopScrapeJobProducts =
    api.material.deleteShopScrapeJobProducts.useMutation({
      onSuccess: ({ job, removedCount }) => {
        syncFocusedScrapeJob(job);
        setSelectedSourceUrls(new Set());
        setBulkDeleteSelectedOpen(false);
        closeProductDetail();
        toast.success(
          `Đã xóa ${removedCount.toLocaleString("vi-VN")} sản phẩm khỏi preview.`,
        );
      },
      onError: (error) => {
        toast.error(error.message || "Không thể xóa các sản phẩm đã chọn.");
      },
    });

  const addShopScrapeJobProduct = api.material.addShopScrapeJobProduct.useMutation(
    {
      onSuccess: (job) => {
        syncFocusedScrapeJob(job);
        closeProductDetail();
        toast.success("Đã thêm sản phẩm vào job scrape.");
      },
      onError: (error) => {
        toast.error(error.message || "Không thể thêm sản phẩm scrape.");
      },
    },
  );

  const deleteShopScrapeJob = api.material.deleteShopScrapeJob.useMutation({
    onSuccess: (job) => {
      if (focusedJobId === job.id) {
        setFocusedJobId(null);
        setStartedJob(null);
        setImportJobId(null);
        setStartedImportJob(null);
        setSelectedSourceUrls(new Set());
      }
      void utils.material.listShopScrapeJobs.invalidate();
      toast.success("Đã xóa job khỏi danh sách.");
    },
    onError: (error) => {
      toast.error(error.message || "Không thể xóa job scrape shop.");
    },
  });

  const startShopImportJob = api.material.startShopImportJob.useMutation({
    onSuccess: (job) => {
      setStartedImportJob(job);
      setImportJobId(job.id);
      setFinalizedImportJobId(null);
      utils.material.getShopImportJob.setData({ jobId: job.id }, job);
      void utils.material.listShopImportJobs.invalidate();
      toast.success("Đã bắt đầu job nhập catalog.");
    },
    onError: (error) => {
      toast.error(error.message || "Không thể bắt đầu nhập catalog.");
    },
  });

  const cancelShopImportJob = api.material.cancelShopImportJob.useMutation({
    onSuccess: (job) => {
      setStartedImportJob(job);
      utils.material.getShopImportJob.setData({ jobId: job.id }, job);
      void utils.material.listShopImportJobs.invalidate();
      toast.warning("Đã hủy job nhập catalog.");
    },
    onError: (error) => {
      toast.error(error.message || "Không thể hủy job nhập catalog.");
    },
  });

  useEffect(() => {
    const job = activeImportJob;
    if (!job || isImportJobActive(job) || finalizedImportJobId === job.id) {
      return;
    }

    setFinalizedImportJobId(job.id);
    if (job.items.length > 0) {
      void Promise.all([
        utils.material.searchMaterials.invalidate(),
        utils.material.getMaterialSummary.invalidate(),
        utils.material.getMaterialFilterOptions.invalidate(),
      ]);
    }

    if (job.status === "completed") {
      toast.success(
        `Đã nhập ${job.created + job.updated} sản phẩm vào catalog.`,
      );
    } else if (job.status === "failed") {
      toast.error(job.error ?? "Job nhập catalog đã lỗi.");
    } else if (job.status === "cancelled") {
      toast.warning(
        `Đã dừng nhập catalog sau ${job.processed.toLocaleString(
          "vi-VN",
        )}/${job.total.toLocaleString("vi-VN")} sản phẩm.`,
      );
    }
    void utils.material.listShopImportJobs.invalidate();
  }, [activeImportJob, finalizedImportJobId, toast, utils.material]);

  useEffect(() => {
    const job = activeJob;
    if (
      !job ||
      job.isExpired ||
      isJobActive(job) ||
      finalizedScrapeJobId === job.id
    ) {
      return;
    }

    setFinalizedScrapeJobId(job.id);
    if (job.status === "completed") {
      toast.success(
        job.message ??
          `Đã scrape ${job.productCount.toLocaleString("vi-VN")} sản phẩm.`,
      );
    } else if (job.status === "failed") {
      toast.error(job.error ?? "Job scrape shop đã lỗi.");
    } else if (job.status === "cancelled") {
      toast.warning(job.message ?? "Job scrape shop đã bị hủy.");
    }
    void utils.material.listShopScrapeJobs.invalidate();
  }, [activeJob, finalizedScrapeJobId, toast, utils.material]);

  const startScrape = (url = shopUrl.trim()) => {
    const normalizedUrl = url.trim();
    if (!normalizedUrl || isStartingScrape) {
      return;
    }
    setShopUrl(normalizedUrl);
    setStartedJob(null);
    setFocusedJobId(null);
    setPendingScrapeJob({
      url: normalizedUrl,
      scrapeMode,
      maxPages: scrapeMode === "all" ? null : maxPages,
      maxProducts: scrapeMode === "all" ? null : maxProducts,
      method: scrapeMethod,
      detailEnrichment,
      startedAt: Date.now(),
    });
    setClockMs(Date.now());
    setStartedImportJob(null);
    setImportJobId(null);
    setFinalizedScrapeJobId(null);
    setFinalizedImportJobId(null);
    setSelectedSourceUrls(new Set());
    startShopScrapeJob.mutate({
      url: normalizedUrl,
      scrapeMode,
      maxPages: scrapeMode === "all" ? null : maxPages,
      maxProducts: scrapeMode === "all" ? null : maxProducts,
      method: scrapeMethod,
      detailEnrichment,
    });
  };

  const closeProductDetail = () => {
    setDetailProductKey(null);
    setDetailDraft(null);
    setDetailOriginalSourceUrl(null);
    setIsCreatingProduct(false);
  };

  const openProductDetail = (product: ScrapedProduct) => {
    setIsCreatingProduct(false);
    setDetailProductKey(productKey(product));
    setDetailOriginalSourceUrl(product.sourceUrl);
    setDetailDraft({ ...product });
  };

  const openCreateProductDetail = () => {
    if (!activeJob || !canEditScrapeProducts) {
      return;
    }
    const draft = emptyScrapedProduct(activeJob.url);
    setIsCreatingProduct(true);
    setDetailProductKey("__new__");
    setDetailOriginalSourceUrl(null);
    setDetailDraft(draft);
  };

  const saveProductDetail = () => {
    if (!activeJob || !detailDraft || !canEditScrapeProducts) {
      return;
    }
    if (isCreatingProduct || !detailOriginalSourceUrl) {
      addShopScrapeJobProduct.mutate({
        jobId: activeJob.id,
        product: detailDraft,
      });
      return;
    }
    updateShopScrapeJobProduct.mutate({
      jobId: activeJob.id,
      sourceUrl: detailOriginalSourceUrl,
      product: detailDraft,
    });
  };

  const focusScrapeJob = (jobId: string) => {
    if (!isJobPage) {
      router.push(`/materials/scrape/jobs/${jobId}`);
      return;
    }
    closeProductDetail();
    setFocusedJobId(jobId);
    setStartedJob(null);
    setSelectedSourceUrls(new Set());
  };

  const stopScrapeJob = (job: { id: string; url: string }) => {
    if (cancelShopScrapeJob.isPending) {
      return;
    }
    setStopJobTarget(job);
  };

  const deleteScrapeJob = (job: { id: string; url: string }) => {
    if (deleteShopScrapeJob.isPending) {
      return;
    }
    setDeleteJobTarget(job);
  };

  const confirmStopScrapeJob = () => {
    if (!stopJobTarget) {
      return;
    }
    focusScrapeJob(stopJobTarget.id);
    cancelShopScrapeJob.mutate({ jobId: stopJobTarget.id });
    setStopJobTarget(null);
  };

  const confirmDeleteScrapeJob = () => {
    if (!deleteJobTarget) {
      return;
    }
    deleteShopScrapeJob.mutate({ jobId: deleteJobTarget.id });
    setDeleteJobTarget(null);
  };

  const downloadScrapeCsv = async () => {
    if (!activeJob) {
      return;
    }
    try {
      const result = await utils.material.exportShopScrapeJobCsv.fetch({
        jobId: activeJob.id,
      });
      const blob = new Blob([result.csv], {
        type: "text/csv;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `scrape-${shortJobId(activeJob.id)}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success(
        `Đã tải CSV preview (${result.count.toLocaleString("vi-VN")} sản phẩm).`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Không thể xuất CSV preview scrape.",
      );
    }
  };

  const submitScrape = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (canStart) {
      startScrape();
    }
  };

  const isScrapeAll = scrapeMode === "all";
  const isAutoMethod = scrapeMethod === "auto";
  const showLimitFields = !isScrapeAll;

  const toggleProduct = (product: ScrapedProduct) => {
    const key = productKey(product);
    setSelectedSourceUrls((previous) => {
      const next = new Set(previous);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const selectAllProducts = () => {
    setSelectedSourceUrls((previous) => {
      const next = new Set(previous);
      if (allSelected) {
        for (const key of filteredProductKeys) {
          next.delete(key);
        }
      } else {
        for (const key of filteredProductKeys) {
          next.add(key);
        }
      }
      return next;
    });
  };

  const importAll = () => {
    if (!activeJob || !canImportAll) {
      return;
    }
    void requestImportPreview();
  };

  const importSelected = () => {
    if (!activeJob || !canImportSelected) {
      return;
    }
    void requestImportPreview(Array.from(selectedSourceUrls));
  };

  const requestImportPreview = async (productSourceUrls?: string[]) => {
    if (!activeJob) {
      return;
    }
    setImportPreviewLoading(true);
    try {
      const preview = await utils.material.previewShopImportJob.fetch({
        scrapeJobId: activeJob.id,
        productSourceUrls,
      });
      setImportPreviewData({
        ...preview,
        summary: normalizeImportPreviewSummary(preview.summary),
      });
      setImportPreviewTarget({ productSourceUrls });
      setImportPreviewOpen(true);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Không thể xem trước kết quả nhập catalog.",
      );
    } finally {
      setImportPreviewLoading(false);
    }
  };

  const confirmImportPreview = () => {
    if (!activeJob || !importPreviewTarget) {
      return;
    }
    startShopImportJob.mutate({
      scrapeJobId: activeJob.id,
      productSourceUrls: importPreviewTarget.productSourceUrls,
    });
    setImportPreviewOpen(false);
    setImportPreviewTarget(null);
    setImportPreviewData(null);
  };

  const resetJob = () => {
    if (isStartingScrape) {
      return;
    }
    closeProductDetail();
    if (isJobPage) {
      router.push("/materials/scrape");
      return;
    }
    setFocusedJobId(null);
    setStartedJob(null);
    setPendingScrapeJob(null);
    setImportJobId(null);
    setStartedImportJob(null);
    setFinalizedImportJobId(null);
    setFinalizedScrapeJobId(null);
    setSelectedSourceUrls(new Set());
  };

  const pagePercent = activeJob
    ? progressPercent(activeJob.pagesVisited.length, activeJob.maxPages)
    : null;
  const productPercent = activeJob
    ? progressPercent(activeJob.productCount, activeJob.maxProducts)
    : null;
  const importPercent = activeImportJob
    ? progressPercent(activeImportJob.processed, activeImportJob.total)
    : null;
  const activeJobStopReason = activeJob?.stopReason
    ? stopReasonLabel[activeJob.stopReason]
    : null;
  const activeJobMessage =
    activeJob?.message ?? activeJob?.error ?? activeJobStopReason;
  const importResult =
    activeImportJob &&
    !isImportJobActive(activeImportJob) &&
    activeImportJob.items.length > 0
      ? activeImportJob
      : null;
  const pendingScrapeDurationMs = pendingScrapeJob
    ? clockMs - pendingScrapeJob.startedAt
    : null;

  return (
    <div className="space-y-4">
      <ConfirmDialog
        open={stopJobTarget !== null}
        title={`Dừng job scrape ${stopJobTarget ? hostFromUrl(stopJobTarget.url) : ""}?`}
        description="Job sẽ dừng ngay. Các sản phẩm đã thu thập vẫn giữ trong preview."
        confirmLabel="Dừng job"
        variant="danger"
        isLoading={cancelShopScrapeJob.isPending}
        onConfirm={confirmStopScrapeJob}
        onCancel={() => setStopJobTarget(null)}
      />
      <ConfirmDialog
        open={deleteJobTarget !== null}
        title={`Xóa job scrape ${deleteJobTarget ? hostFromUrl(deleteJobTarget.url) : ""}?`}
        description="Job sẽ bị gỡ khỏi danh sách. Bản xem trước sản phẩm không còn khả dụng."
        confirmLabel="Xóa job"
        variant="danger"
        isLoading={deleteShopScrapeJob.isPending}
        onConfirm={confirmDeleteScrapeJob}
        onCancel={() => setDeleteJobTarget(null)}
      />
      <ConfirmDialog
        open={cancelImportOpen}
        title="Hủy job nhập catalog?"
        description="Tiến trình ghi DB sẽ dừng. Các dòng đã ghi vẫn giữ trong catalog."
        confirmLabel="Hủy nhập"
        variant="danger"
        isLoading={cancelShopImportJob.isPending}
        onConfirm={() => {
          if (!activeImportJob) {
            return;
          }
          cancelShopImportJob.mutate({ jobId: activeImportJob.id });
          setCancelImportOpen(false);
        }}
        onCancel={() => setCancelImportOpen(false)}
      />
      <ConfirmDialog
        open={importPreviewOpen}
        title="Xác nhận nhập catalog"
        description="Xem trước kết quả trước khi ghi vào catalog. Sản phẩm trùng catalog sẽ được ghép tự động."
        confirmLabel="Bắt đầu nhập"
        variant="primary"
        isLoading={startShopImportJob.isPending || importPreviewLoading}
        onConfirm={confirmImportPreview}
        onCancel={() => {
          setImportPreviewOpen(false);
          setImportPreviewTarget(null);
          setImportPreviewData(null);
        }}
      >
        {importPreviewData?.summary ? (
          <ImportPreviewSummaryPanel summary={importPreviewData.summary} />
        ) : null}
      </ConfirmDialog>
      {isJobPage ? (
        <section className="panel p-4">
          <Link
            href="/materials/scrape"
            className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900"
          >
            ← Quay lại danh sách job
          </Link>
        </section>
      ) : null}

      {!isJobPage ? (
      <>
      <section className="panel overflow-hidden">
        <div className="border-b border-slate-400 px-4 py-3">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-violet-700" aria-hidden />
            <h2 className="text-sm font-bold text-slate-950">Cấu hình job scrape</h2>
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-700">
            Job chạy nền trên server, theo pagination cùng domain và chỉ nhập
            vào catalog sau khi bạn duyệt sản phẩm.
          </p>
        </div>

        <form onSubmit={submitScrape} className="space-y-4 p-4">
          <label className="grid gap-1.5">
            <span className="text-xs font-semibold tracking-[0.12em] text-slate-600 uppercase">
              Shop URL
            </span>
            <span className="relative">
              <LinkIcon
                className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-600"
                aria-hidden
              />
              <input
                className="min-h-10 w-full rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] py-2 pr-3 pl-9 text-sm text-slate-900 placeholder:text-slate-600 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 focus:outline-none"
                placeholder="https://shop.example.com/category"
                spellCheck={false}
                value={shopUrl}
                disabled={isStartingScrape}
                onChange={(event) => setShopUrl(event.target.value)}
                aria-label="URL shop để scrape sản phẩm"
              />
            </span>
          </label>

          <div className="grid gap-2 lg:grid-cols-3">
            <fieldset className="grid gap-1.5">
              <legend className="text-xs font-semibold tracking-[0.12em] text-slate-600 uppercase">
                Phạm vi
              </legend>
              <div className="grid grid-cols-2 rounded border border-slate-400 bg-slate-50 p-0.5">
                {(["limited", "all"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={
                      scrapeMode === mode
                        ? "min-h-10 rounded bg-white px-2 text-xs font-bold text-blue-800 shadow-sm"
                        : "min-h-10 rounded px-2 text-xs font-semibold text-slate-600 hover:text-slate-900"
                    }
                    disabled={isStartingScrape}
                    onClick={() => setScrapeMode(mode)}
                    aria-pressed={scrapeMode === mode}
                  >
                    {scrapeModeLabel[mode]}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="grid gap-1.5">
              <span className="text-xs font-semibold tracking-[0.12em] text-slate-600 uppercase">
                Cách đọc
              </span>
              <select
                className="min-h-11 rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 focus:outline-none"
                value={scrapeMethod}
                disabled={isStartingScrape}
                onChange={(event) =>
                  setScrapeMethod(event.target.value as ScrapeMethod)
                }
                aria-label="Phương thức scrape sản phẩm"
              >
                {(["auto", "json_ld", "dom_cards"] as const).map((method) => (
                  <option key={method} value={method}>
                    {scrapeMethodLabel[method]}
                  </option>
                ))}
              </select>
              {!isAutoMethod ? (
                <span className="text-xs text-slate-700">
                  {scrapeMethodHelp[scrapeMethod]}
                </span>
              ) : null}
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-semibold tracking-[0.12em] text-slate-600 uppercase">
                Bổ sung thông tin
              </span>
              <select
                className="min-h-11 rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 focus:outline-none"
                value={detailEnrichment}
                disabled={isStartingScrape}
                onChange={(event) =>
                  setDetailEnrichment(
                    event.target.value as DetailEnrichmentMode,
                  )
                }
                aria-label="Bổ sung dữ liệu từ trang chi tiết sản phẩm"
              >
                {(["none", "missing_fields"] as const).map((mode) => (
                  <option key={mode} value={mode}>
                    {detailEnrichmentLabel[mode]}
                  </option>
                ))}
              </select>
              <span className="text-xs text-slate-700">
                {detailEnrichmentHelp[detailEnrichment]}
              </span>
            </label>
          </div>

          {showLimitFields ? (
            <div className="grid gap-2 sm:max-w-md sm:grid-cols-2">
              <label className="grid gap-1.5">
                <span className="text-xs font-semibold tracking-[0.12em] text-slate-600 uppercase">
                  Trang tối đa
                </span>
                <input
                  type="number"
                  name="maxPages"
                  min={1}
                  max={MAX_PAGE_LIMIT}
                  step={1}
                  inputMode="numeric"
                  autoComplete="off"
                  className="min-h-11 rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 focus:outline-none"
                  value={maxPages}
                  disabled={isStartingScrape}
                  onChange={(event) =>
                    setMaxPages(
                      clampNumber(
                        Number(event.target.value),
                        1,
                        MAX_PAGE_LIMIT,
                      ),
                    )
                  }
                  aria-label="Số trang tối đa cần scrape"
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-semibold tracking-[0.12em] text-slate-600 uppercase">
                  Sản phẩm tối đa
                </span>
                <input
                  type="number"
                  name="maxProducts"
                  min={1}
                  max={MAX_PRODUCT_LIMIT}
                  step={1}
                  inputMode="numeric"
                  autoComplete="off"
                  className="min-h-11 rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 focus:outline-none"
                  value={maxProducts}
                  disabled={isStartingScrape}
                  onChange={(event) =>
                    setMaxProducts(
                      clampNumber(
                        Number(event.target.value),
                        1,
                        MAX_PRODUCT_LIMIT,
                      ),
                    )
                  }
                  aria-label="Số sản phẩm tối đa cần scrape"
                />
              </label>
            </div>
          ) : null}

          <div className="space-y-3 border-t border-slate-400 pt-4">
            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                variant="primary"
                disabled={!canStart}
                isLoading={isStartingScrape}
                leftIcon={<Search className="h-4 w-4" />}
              >
                {isStartingScrape ? "Đang khởi động" : "Bắt đầu scrape"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={!isActive || !activeJob}
                isLoading={cancelShopScrapeJob.isPending}
                leftIcon={<StopCircle className="h-4 w-4" />}
                onClick={() => {
                  if (activeJob) {
                    stopScrapeJob(activeJob);
                  }
                }}
              >
                Dừng job
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={isStartingScrape}
                leftIcon={<RotateCcw className="h-4 w-4" />}
                onClick={resetJob}
              >
                Bỏ chọn job
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5 rounded bg-slate-50 px-3 py-2">
              <Badge tone="neutral">Theo pagination cùng domain</Badge>
              <Badge tone="neutral">Chặn ảnh / font / media</Badge>
              <Badge tone="neutral">Nhập sau khi duyệt</Badge>
              {detailEnrichment === "none" ? (
                <Badge tone="warning">NCC / xuất xứ có thể thiếu</Badge>
              ) : null}
              {isAutoMethod ? (
                <Badge tone="info">Tự động: JSON-LD + DOM cards</Badge>
              ) : null}
              {isScrapeAll ? (
                <Badge tone="info">
                  Scrape hết — áp giới hạn an toàn 100 trang / 2.000 sản phẩm
                </Badge>
              ) : null}
            </div>
          </div>
        </form>
      </section>

      <section className="panel p-4">
        <div className="flex flex-wrap items-start justify-between gap-1">
          <div>
            <p className="section-title">Danh sách job</p>
            <h2 className="mt-1 text-base font-bold text-slate-950">
              Nhiều scrape chạy song song
            </h2>
            <p className="mt-1 text-xs text-slate-700">
              Mỗi job giữ cấu hình scrape đã chọn, trạng thái chạy và preview
              sản phẩm. Chọn một job để xem và nhập catalog.
            </p>
          </div>
        </div>

        {jobRows.length > 0 ? (
          <ScrapeJobsList
            jobRows={jobRows}
            focusedJobId={focusedJobId}
            clockMs={clockMs}
            isFetching={jobListQuery.isFetching}
            onRefresh={() => void jobListQuery.refetch()}
            onFocusJob={focusScrapeJob}
            onStopJob={stopScrapeJob}
            onDeleteJob={deleteScrapeJob}
            stoppingJobId={
              cancelShopScrapeJob.isPending
                ? (cancelShopScrapeJob.variables?.jobId ?? null)
                : null
            }
            isDeletingJob={deleteShopScrapeJob.isPending}
          />
        ) : (
          <EmptyState
            className="mt-4"
            title="Chưa có job scrape."
            description="Nhập URL shop để tạo job mới. Danh sách này được đọc lại từ Postgres."
          />
        )}
      </section>
      </>
      ) : null}

      {!isJobPage ? null : (
        <>
      {scrapeJobPollingError ? (
        <section className="panel border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          <div className="flex flex-wrap items-center justify-between gap-1">
            <p>Không cập nhật được tiến độ scrape: {scrapeJobPollingError}</p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void jobQuery.refetch()}
            >
              Thử lại
            </Button>
          </div>
        </section>
      ) : null}

      {importJobPollingError ? (
        <section className="panel border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          <div className="flex flex-wrap items-center justify-between gap-1">
            <p>
              Không cập nhật được tiến độ nhập catalog: {importJobPollingError}
            </p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void importJobQuery.refetch()}
            >
              Thử lại
            </Button>
          </div>
        </section>
      ) : null}

      {missingJobMessage ? (
        <section className="panel border-amber-200 bg-amber-50 p-4">
          <div className="flex flex-wrap items-start justify-between gap-1">
            <div>
              <p className="section-title text-amber-800">Không mở được job</p>
              <h2 className="mt-1 text-base font-bold text-amber-950">
                Job scrape không còn khả dụng
              </h2>
              <p className="mt-1 text-sm leading-6 text-amber-900">
                {missingJobMessage} Quay lại danh sách để chọn job khác hoặc tạo
                job mới.
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => router.push("/materials/scrape")}
            >
              Quay lại danh sách
            </Button>
          </div>
        </section>
      ) : null}

      {isJobDetailLoading ? (
        <section className="panel p-4" aria-live="polite">
          <div className="flex items-start gap-1">
            <Loader2 className="mt-0.5 h-5 w-5 animate-spin text-blue-600" aria-hidden />
            <div>
              <p className="section-title">Đang mở job scrape</p>
              <h2 className="mt-1 text-base font-bold text-slate-950">
                Tải trạng thái và preview sản phẩm…
              </h2>
              <p className="mt-1 text-sm text-slate-700">
                Trang sẽ tự cập nhật khi lấy được dữ liệu từ server.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {pendingScrapeJob && !activeJob ? (
        <section className="panel p-4" aria-live="polite">
          <div className="flex flex-wrap items-start justify-between gap-1">
            <div>
              <p className="section-title">Tiến độ job</p>
              <h2 className="mt-1 text-base font-bold text-slate-950">
                {hostFromUrl(pendingScrapeJob.url)}
              </h2>
              <p className="mt-1 text-xs text-slate-700">
                Đang tạo job nền trên server
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge tone="info">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                Đang khởi động
              </Badge>
              <Badge tone="neutral">
                <Clock3 className="h-3 w-3" aria-hidden />
                {formatDuration(pendingScrapeDurationMs)}
              </Badge>
            </div>
          </div>

          <div className="mt-4 grid gap-1 lg:grid-cols-2">
            <div className="rounded border border-blue-200 bg-blue-50 p-3">
              <div className="flex items-center justify-between gap-1 text-xs font-semibold text-slate-700">
                <span>Trang</span>
                <span>{formatLimit(pendingScrapeJob.maxPages)}</span>
              </div>
              <ScrapeProgressBar
                label="Tiến độ tạo job scrape theo trang"
                percent={null}
                active
                tone="blue"
              />
            </div>
            <div className="rounded border border-emerald-200 bg-emerald-50 p-3">
              <div className="flex items-center justify-between gap-1 text-xs font-semibold text-slate-700">
                <span>Sản phẩm</span>
                <span>{formatLimit(pendingScrapeJob.maxProducts)}</span>
              </div>
              <ScrapeProgressBar
                label="Tiến độ tạo job scrape theo sản phẩm"
                percent={null}
                active
                tone="emerald"
              />
            </div>
          </div>

          <div className="mt-4 grid gap-2 text-xs text-slate-600 lg:grid-cols-4">
            <div className="rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] px-3 py-2">
              <span className="font-semibold text-slate-800">Phạm vi: </span>
              {scrapeModeLabel[pendingScrapeJob.scrapeMode]}
            </div>
            <div className="rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] px-3 py-2">
              <span className="font-semibold text-slate-800">Cách đọc: </span>
              {scrapeMethodLabel[pendingScrapeJob.method]}
            </div>
            <div className="rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] px-3 py-2">
              <span className="font-semibold text-slate-800">Bổ sung: </span>
              {detailEnrichmentLabel[pendingScrapeJob.detailEnrichment]}
            </div>
            <div className="rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] px-3 py-2">
              <span className="font-semibold text-slate-800">URL: </span>
              <span className="break-all">{pendingScrapeJob.url}</span>
            </div>
          </div>
        </section>
      ) : null}

      {activeJob ? (
        <section className="panel p-4" aria-live="polite">
          <div className="flex flex-wrap items-start justify-between gap-1">
            <div>
              <p className="section-title">Tiến độ job</p>
              <h2 className="mt-1 text-base font-bold text-slate-950">
                {hostFromUrl(activeJob.url)}
              </h2>
              <p className="mt-1 text-xs text-slate-700">
                Job ID: {activeJob.id}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge tone={statusTone[activeJob.status]}>
                {isActive ? (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                ) : null}
                {statusLabel[activeJob.status]}
              </Badge>
              <Badge tone="info" count={activeJob.productCount}>
                Sản phẩm
              </Badge>
              <Badge tone="neutral" count={activeJob.pagesVisited.length}>
                Trang đã đọc
              </Badge>
              <Badge tone="neutral">
                {scrapeMethodLabel[activeJob.method]}
              </Badge>
              <Badge
                tone={
                  activeJob.detailEnrichment === "missing_fields"
                    ? "info"
                    : "warning"
                }
              >
                {detailEnrichmentLabel[activeJob.detailEnrichment]}
              </Badge>
              <Badge tone="neutral">
                <Clock3 className="h-3 w-3" aria-hidden />
                {formatDuration(activeJob.durationMs)}
              </Badge>
            </div>
          </div>

          <div className="mt-4 grid gap-1 lg:grid-cols-2">
            <div className="rounded border border-slate-400 bg-slate-50 p-3">
              <div className="flex items-center justify-between gap-1 text-xs font-semibold text-slate-600">
                <span>Trang đã đọc</span>
                <span>
                  {activeJob.pagesVisited.length.toLocaleString("vi-VN")} /{" "}
                  {formatLimit(activeJob.maxPages)}
                </span>
              </div>
              <ScrapeProgressBar
                label="Tiến độ đọc trang của job scrape"
                percent={pagePercent}
                active={isActive}
                tone="blue"
              />
            </div>
            <div className="rounded border border-slate-400 bg-slate-50 p-3">
              <div className="flex items-center justify-between gap-1 text-xs font-semibold text-slate-600">
                <span>Sản phẩm tìm thấy</span>
                <span>
                  {activeJob.productCount.toLocaleString("vi-VN")} /{" "}
                  {formatLimit(activeJob.maxProducts)}
                </span>
              </div>
              <ScrapeProgressBar
                label="Tiến độ tìm sản phẩm của job scrape"
                percent={productPercent}
                active={isActive}
                tone="emerald"
              />
            </div>
          </div>

          <div className="mt-4 grid gap-2 text-xs text-slate-600 lg:grid-cols-2">
            <div className="rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] px-3 py-2">
              <span className="font-semibold text-slate-800">Đang đọc: </span>
              <span className="break-all">
                {activeJob.currentUrls.length > 0
                  ? activeJob.currentUrls.join(", ")
                  : "-"}
              </span>
            </div>
            <div className="rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] px-3 py-2">
              <span className="font-semibold text-slate-800">
                Queue còn lại:{" "}
              </span>
              {activeJob.queueLength.toLocaleString("vi-VN")}
            </div>
            <div className="rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] px-3 py-2">
              <span className="font-semibold text-slate-800">Phạm vi: </span>
              {scrapeModeLabel[activeJob.scrapeMode]}
            </div>
            <div className="rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] px-3 py-2">
              <span className="font-semibold text-slate-800">
                Cập nhật cuối:{" "}
              </span>
              {activeJob.lastProgressAt
                ? new Date(activeJob.lastProgressAt).toLocaleString("vi-VN")
                : "-"}
            </div>
          </div>

          {activeJobMessage ? (
            <div
              className={
                activeJob.status === "failed"
                  ? "mt-4 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-900"
                  : "mt-4 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-900"
              }
            >
              {activeJobStopReason ? (
                <span className="font-semibold">{activeJobStopReason}: </span>
              ) : null}
              {activeJobMessage}
            </div>
          ) : null}

          {isPartialImportableJob ? (
            <div className="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
              Job dừng sớm — vẫn có thể nhập{" "}
              {activeJob.productCount.toLocaleString("vi-VN")} sản phẩm đã thu
              thập sau khi duyệt preview.
            </div>
          ) : null}

          {activeJob.detailEnrichment === "none" ? (
            <div className="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
              Job này chỉ đọc trang danh mục. Nếu NCC, xuất xứ hoặc thông số bị
              thiếu, chạy lại với chế độ “Bổ sung thiếu” để đọc trang chi tiết
              sản phẩm.
            </div>
          ) : null}

          {activeJob.failedPages.length > 0 ? (
            <details className="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
              <summary className="cursor-pointer font-semibold">
                {activeJob.failedPages.length.toLocaleString("vi-VN")} trang không
                đọc được. Job vẫn giữ các sản phẩm đã tìm thấy.
              </summary>
              <ul className="mt-2 space-y-2">
                {activeJob.failedPages.slice(0, 10).map((page, index) => (
                  <li
                    key={`${page.url}-${index}`}
                    className="rounded border border-amber-200 bg-white/80 px-2 py-1.5"
                  >
                    <a
                      href={page.url}
                      target="_blank"
                      rel="noreferrer"
                      className="break-all font-semibold text-amber-950 hover:underline"
                    >
                      {page.url}
                    </a>
                    <p className="mt-1 break-words text-amber-800">
                      {page.message}
                    </p>
                  </li>
                ))}
              </ul>
              {activeJob.failedPages.length > 10 ? (
                <p className="mt-2 text-amber-800">
                  Còn{" "}
                  {(activeJob.failedPages.length - 10).toLocaleString("vi-VN")}{" "}
                  trang lỗi khác.
                </p>
              ) : null}
            </details>
          ) : null}

          {activeJob.maxPages != null &&
          activeJob.pagesVisited.length >= activeJob.maxPages &&
          activeJob.productCount === 0 ? (
            <div className="mt-4 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-900">
              Đã đọc {activeJob.pagesVisited.length.toLocaleString("vi-VN")} /{" "}
              {activeJob.maxPages.toLocaleString("vi-VN")} trang nhưng không
              trích xuất được sản phẩm nào.
              {activeJob.failedPages.length > 0
                ? " Kiểm tra danh sách trang lỗi bên trên."
                : " Thử tăng giới hạn trang, bật “Bổ sung thiếu”, hoặc kiểm tra URL shop."}
            </div>
          ) : null}
        </section>
      ) : null}

      {activeJob ? (
        <section id="material-scrape-products" className="panel p-4">
          <ConfirmDialog
            open={deleteProductTarget !== null}
            title={`Xóa "${deleteProductTarget?.name ?? ""}" khỏi job scrape?`}
            description="Sản phẩm sẽ bị gỡ khỏi danh sách preview và không được nhập vào catalog khi bạn chạy import."
            confirmLabel="Xóa sản phẩm"
            variant="danger"
            isLoading={
              deleteShopScrapeJobProduct.isPending ||
              deleteShopScrapeJobProducts.isPending
            }
            onConfirm={() => {
              if (!activeJob || !deleteProductTarget) {
                return;
              }
              deleteShopScrapeJobProduct.mutate({
                jobId: activeJob.id,
                sourceUrl: deleteProductTarget.sourceUrl,
              });
            }}
            onCancel={() => setDeleteProductTarget(null)}
          />
          <ConfirmDialog
            open={bulkDeleteSelectedOpen}
            title={`Xóa ${selectedCount.toLocaleString("vi-VN")} sản phẩm đã chọn?`}
            description="Các sản phẩm đã chọn sẽ bị gỡ khỏi preview và không được nhập vào catalog."
            confirmLabel="Xóa đã chọn"
            variant="danger"
            isLoading={deleteShopScrapeJobProducts.isPending}
            onConfirm={() => {
              if (!activeJob || selectedCount === 0) {
                return;
              }
              deleteShopScrapeJobProducts.mutate({
                jobId: activeJob.id,
                sourceUrls: Array.from(selectedSourceUrls),
              });
            }}
            onCancel={() => setBulkDeleteSelectedOpen(false)}
          />
          <ScrapeProductDetailDialog
            open={detailDraft !== null}
            job={activeJob}
            product={detailDraft}
            productIndex={isCreatingProduct ? null : detailProductIndex}
            originalSourceUrl={detailOriginalSourceUrl}
            canEdit={canEditScrapeProducts}
            isSaving={
              updateShopScrapeJobProduct.isPending ||
              addShopScrapeJobProduct.isPending
            }
            isDeleting={deleteShopScrapeJobProduct.isPending}
            onChange={setDetailDraft}
            onClose={closeProductDetail}
            onSave={saveProductDetail}
            onDelete={() => {
              if (detailDraft) {
                setDeleteProductTarget(detailDraft);
              }
            }}
          />

          <MatchCompareDrawer
            open={compareProducts.length > 0}
            products={compareProducts}
            index={compareIndex}
            onNavigate={setCompareIndex}
            onClose={() => {
              setCompareProducts([]);
              setCompareIndex(0);
            }}
          />

          <div className="flex flex-wrap items-start justify-between gap-1">
            <div>
              <p className="section-title">Duyệt sản phẩm scrape</p>
              <h2 className="mt-1 text-base font-bold text-slate-950">
                Job {shortJobId(activeJob.id)} · {hostFromUrl(activeJob.url)}
              </h2>
              <p className="mt-1 text-xs text-slate-700">
                {scrapeProducts.length.toLocaleString("vi-VN")} sản phẩm ·{" "}
                {scrapeModeLabel[activeJob.scrapeMode]} ·{" "}
                {scrapeMethodLabel[activeJob.method]} ·{" "}
                {detailEnrichmentLabel[activeJob.detailEnrichment]}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge tone="neutral">ID {activeJob.id}</Badge>
                <Badge tone={statusTone[activeJob.status]}>
                  {statusLabel[activeJob.status]}
                </Badge>
                <Badge tone="info" count={activeJob.productCount}>
                  Preview
                </Badge>
              </div>
              <p className="mt-2 text-xs text-slate-700">
                Bấm một dòng sản phẩm để xem chi tiết, chỉnh sửa hoặc xóa trước
                khi nhập catalog. Mã SP theo job:{" "}
                <span className="font-semibold text-slate-700">
                  {shortJobId(activeJob.id)}-###
                </span>
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={scrapeProducts.length === 0}
                leftIcon={<Search className="h-3.5 w-3.5" />}
                onClick={() => {
                  const selected = scrapeProducts.filter((p) =>
                    selectedSourceUrls.has(productKey(p)),
                  );
                  const list = selected.length > 0 ? selected : scrapeProducts;
                  setCompareProducts(list);
                  setCompareIndex(0);
                }}
              >
                {selectedCount > 0
                  ? `Đối chiếu đã chọn (${selectedCount.toLocaleString("vi-VN")})`
                  : "Đối chiếu vật tư"}
              </Button>
              {canEditScrapeProducts ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  leftIcon={<Plus className="h-3.5 w-3.5" />}
                  onClick={openCreateProductDetail}
                >
                  Thêm sản phẩm
                </Button>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={scrapeProducts.length === 0}
                leftIcon={<Upload className="h-3.5 w-3.5" />}
                onClick={() => void downloadScrapeCsv()}
              >
                Tải CSV preview
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={filteredScrapeProducts.length === 0 || isImportActive}
                leftIcon={
                  allSelected ? (
                    <CheckSquare className="h-3.5 w-3.5" />
                  ) : (
                    <Square className="h-3.5 w-3.5" />
                  )
                }
                onClick={selectAllProducts}
              >
                {allSelected ? "Bỏ chọn sau lọc" : "Chọn sau lọc"}
              </Button>
              {canEditScrapeProducts ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={!canDeleteSelected || deleteShopScrapeJobProducts.isPending}
                  isLoading={deleteShopScrapeJobProducts.isPending}
                  leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                  onClick={() => setBulkDeleteSelectedOpen(true)}
                >
                  Xóa đã chọn ({selectedCount.toLocaleString("vi-VN")})
                </Button>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={!canImportSelected || importPreviewLoading}
                isLoading={
                  importPreviewLoading ||
                  (startShopImportJob.isPending &&
                    startShopImportJob.variables?.productSourceUrls !== undefined)
                }
                leftIcon={<Upload className="h-3.5 w-3.5" />}
                onClick={importSelected}
              >
                Nhập đã chọn ({selectedCount.toLocaleString("vi-VN")})
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={!canImportAll || importPreviewLoading}
                isLoading={
                  importPreviewLoading ||
                  (startShopImportJob.isPending &&
                    startShopImportJob.variables?.productSourceUrls === undefined)
                }
                leftIcon={<Upload className="h-3.5 w-3.5" />}
                onClick={importAll}
              >
                Nhập tất cả
              </Button>
            </div>
          </div>

          <div className="mt-4">
            <div
              className={
                isImportActive
                  ? "rounded border border-blue-200 bg-blue-50 p-3"
                  : "rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] p-3"
              }
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-bold tracking-wide text-slate-700 uppercase">
                    Quá trình nhập catalog
                  </p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">
                    {activeImportJob
                      ? `${activeImportJob.processed.toLocaleString(
                          "vi-VN",
                        )} / ${activeImportJob.total.toLocaleString("vi-VN")}`
                      : `${selectedCount.toLocaleString(
                          "vi-VN",
                        )} đã chọn / ${scrapeProducts.length.toLocaleString(
                          "vi-VN",
                        )} có thể nhập`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {activeImportJob ? (
                    <Badge tone={importStatusTone[activeImportJob.status]}>
                      {isImportActive ? (
                        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                      ) : null}
                      {importStatusLabel[activeImportJob.status]}
                    </Badge>
                  ) : (
                    <Badge tone="neutral">Chưa chạy</Badge>
                  )}
                  {isImportActive && activeImportJob ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      isLoading={cancelShopImportJob.isPending}
                      leftIcon={<StopCircle className="h-3.5 w-3.5" />}
                      onClick={() => setCancelImportOpen(true)}
                    >
                      Hủy nhập
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between gap-1 text-xs font-semibold text-slate-600">
                <span>Tiến độ ghi DB</span>
                <span>{activeImportJob ? `${importPercent ?? 0}%` : "0%"}</span>
              </div>
              <ScrapeProgressBar
                label="Tiến độ nhập catalog"
                percent={importPercent}
                active={isImportActive}
                tone="blue"
              />

              {activeImportJob ? (
                <>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge tone="success" count={activeImportJob.created}>
                      Tạo mới
                    </Badge>
                    <Badge tone="info" count={activeImportJob.updated}>
                      Cập nhật
                    </Badge>
                    <Badge tone="neutral" count={activeImportJob.skipped}>
                      Bỏ qua
                    </Badge>
                    <Badge
                      tone={activeImportJob.failed > 0 ? "critical" : "neutral"}
                      count={activeImportJob.failed}
                    >
                      Lỗi
                    </Badge>
                    <Badge tone="neutral">
                      <Clock3 className="h-3 w-3" aria-hidden />
                      {formatDuration(activeImportJob.durationMs)}
                    </Badge>
                  </div>
                  <p className="mt-2 truncate text-xs text-slate-600">
                    Mục hiện tại: {activeImportJob.currentProductName ?? "-"}
                  </p>
                  {activeImportJob.error ? (
                    <p className="mt-2 rounded border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs text-rose-900">
                      {activeImportJob.error}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="mt-2 text-xs text-slate-700">
                  Sẵn sàng ghi catalog sau khi chọn sản phẩm.
                </p>
              )}
            </div>
          </div>

          {scrapeProducts.length > 0 || activeJob.productCount > 0 ? (
            <>
            <div className="mt-4 flex flex-wrap items-end justify-between gap-1 rounded border border-slate-400 bg-slate-50 p-3">
              <div className="flex flex-wrap gap-2">
                {SCRAPE_QUALITY_FILTER_OPTIONS.map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    className={
                      qualityFilter === filter
                        ? "rounded-full border border-blue-400 bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-900"
                        : "rounded-full border border-slate-500 bg-white shadow-[var(--shadow-flat)] px-3 py-1 text-xs font-semibold text-slate-600 hover:border-blue-200"
                    }
                    onClick={() =>
                      setQualityFilter((current) =>
                        current === filter ? "all" : filter,
                      )
                    }
                    aria-pressed={qualityFilter === filter}
                  >
                    {SCRAPE_QUALITY_FLAG_LABELS[filter]}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-400 accent-blue-600"
                  checked={hideMissingNameProducts}
                  onChange={(event) =>
                    setHideMissingNameProducts(event.target.checked)
                  }
                />
                Ẩn sản phẩm thiếu tên
              </label>
            </div>

            {isActive && scrapeProducts.length === 0 && activeJob.productCount > 0 ? (
              <p className="mt-3 text-xs text-slate-700">
                Đang thu thập {activeJob.productCount.toLocaleString("vi-VN")}{" "}
                sản phẩm — bảng preview sẽ hiện đầy đủ khi job dừng.
              </p>
            ) : null}

          {scrapeProducts.length > 0 ? (
            <>
            <div className="mt-4 grid gap-1 lg:hidden">
              {pagedScrapeProducts.map((item, index) => {
                const key = productKey(item);
                const selected = selectedSourceUrls.has(key);
                const missingLabels = productMissingLabels(item);
                const rowQualityFlags = qualityFlags(item);
                const infoSummary = productInfoSummary(item);
                const globalIndex = productPageIndex * productPageSize + index;

                return (
                  <ScrapeProductReviewCard
                    key={`${key}-${index}-card`}
                    name={item.name}
                    displayId={productDisplayId(activeJob.id, globalIndex)}
                    selected={selected}
                    disabled={isImportActive}
                    infoSummary={infoSummary}
                    priceText={formatMoney(item.price, item.currency)}
                    unit={item.unit ?? "-"}
                    manufacturer={item.manufacturer ?? "-"}
                    originCountry={item.originCountry ?? "-"}
                    missingLabels={missingLabels}
                    suspiciousName={rowQualityFlags.includes("suspiciousName")}
                    missingPrice={rowQualityFlags.includes("missingPrice")}
                    catalogPdfCount={item.catalogPdfUrls.length}
                    sourceUrl={item.sourceUrl}
                    canEdit={canEditScrapeProducts}
                    isDeleting={deleteShopScrapeJobProduct.isPending}
                    onToggle={() => toggleProduct(item)}
                    onOpen={() => openProductDetail(item)}
                    onDelete={() => setDeleteProductTarget(item)}
                  />
                );
              })}
            </div>

            <div className="mt-4 hidden overflow-x-auto rounded border border-slate-400 lg:block">
              <table className="w-full min-w-[60rem] table-fixed divide-y divide-slate-200 text-sm break-words">
                <thead className="bg-slate-50 text-left text-xs font-bold text-slate-700 uppercase">
                  <tr>
                    <th className="w-10 px-3 py-2"> </th>
                    <th className="px-3 py-2">Mã SP</th>
                    <th className="px-3 py-2">Sản phẩm</th>
                    <th className="px-3 py-2">Đơn giá</th>
                    <th className="px-3 py-2">Đơn vị</th>
                    <th className="px-3 py-2">Nhóm</th>
                    <th className="px-3 py-2">NCC</th>
                    <th className="px-3 py-2">Xuất xứ</th>
                    <th className="px-3 py-2">Thông số</th>
                    <th className="px-3 py-2">Độ đầy đủ</th>
                    <th className="px-3 py-2">Nguồn</th>
                    <th className="px-3 py-2 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {pagedScrapeProducts.map((item, index) => {
                    const key = productKey(item);
                    const selected = selectedSourceUrls.has(key);
                    const missingLabels = productMissingLabels(item);
                    const infoSummary = productInfoSummary(item);
                    const rowQualityFlags = qualityFlags(item);
                    const globalIndex = productPageIndex * productPageSize + index;

                    const isDetailOpen = detailProductKey === key;

                    return (
                      <tr
                        key={`${key}-${index}`}
                        tabIndex={0}
                        aria-selected={isDetailOpen}
                        className={`cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none focus-visible:ring-inset ${
                          isDetailOpen
                            ? "bg-blue-100/80"
                            : selected
                              ? "bg-blue-50/70 hover:bg-blue-50"
                              : "hover:bg-slate-100"
                        }`}
                        onClick={() => openProductDetail(item)}
                        onKeyDown={(event) => {
                          if (event.currentTarget !== event.target) {
                            return;
                          }
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            openProductDetail(item);
                          }
                        }}
                      >
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            className="h-4 w-4 cursor-pointer rounded border-slate-400 accent-blue-600"
                            checked={selected}
                            disabled={isImportActive}
                            onClick={(event) => event.stopPropagation()}
                            onChange={() => toggleProduct(item)}
                            aria-label={`Chọn ${item.name}`}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <span className="font-mono text-xs font-bold text-slate-700">
                            {productDisplayId(activeJob.id, globalIndex)}
                          </span>
                        </td>
                        <td className="max-w-sm px-3 py-2 font-semibold text-slate-950">
                          <span className="line-clamp-2">{item.name}</span>
                          <span className="mt-1 block text-xs font-medium text-slate-700">
                            {infoSummary || "Không có SKU / model / trạng thái"}
                          </span>
                          <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-blue-700">
                            <Eye className="h-3 w-3" aria-hidden />
                            Xem chi tiết
                          </span>
                        </td>
                        <td className="px-3 py-2 font-semibold text-slate-900 tabular-nums">
                          {formatMoney(item.price, item.currency)}
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          {item.unit ?? "unknown"}
                        </td>
                        <td className="max-w-44 px-3 py-2 text-slate-600">
                          <span className="line-clamp-2">
                            {item.category ?? item.shopCategory ?? "-"}
                          </span>
                        </td>
                        <td className="max-w-44 px-3 py-2 text-slate-600">
                          <span className="line-clamp-2">
                            {item.manufacturer ?? "-"}
                          </span>
                        </td>
                        <td className="max-w-36 px-3 py-2 text-slate-600">
                          <span className="line-clamp-2">
                            {item.originCountry ?? "-"}
                          </span>
                        </td>
                        <td className="max-w-md px-3 py-2 text-slate-600">
                          <span className="line-clamp-3">
                            {item.specText || "-"}
                          </span>
                        </td>
                        <td className="max-w-56 px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {missingLabels.length === 0 &&
                            rowQualityFlags.length === 0 ? (
                              <Badge tone="success">Đủ thông tin</Badge>
                            ) : (
                              <>
                                {missingLabels.map((label) => (
                                  <Badge key={label} tone="warning">
                                    {label}
                                  </Badge>
                                ))}
                                {rowQualityFlags.includes("suspiciousName") ? (
                                  <Badge tone="critical">Tên nghi vấn</Badge>
                                ) : null}
                                {rowQualityFlags.includes("missingPrice") ? (
                                  <Badge tone="warning">Thiếu giá</Badge>
                                ) : null}
                              </>
                            )}
                            {item.catalogPdfUrls.length > 0 ? (
                              <Badge tone="info">
                                {item.catalogPdfUrls.length} catalog PDF
                              </Badge>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-600">
                          <a
                            href={item.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex h-8 w-8 items-center justify-center rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] text-slate-600 transition-colors hover:bg-slate-100 hover:text-blue-700 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
                            onClick={(event) => event.stopPropagation()}
                            aria-label={`Mở trang nguồn của ${item.name}`}
                            title={item.sourceUrl}
                          >
                            <ExternalLink
                              className="h-3.5 w-3.5 shrink-0"
                              aria-hidden
                            />
                          </a>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              className="inline-flex h-8 w-8 items-center justify-center rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] text-slate-700 transition-colors hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
                              onClick={(event) => {
                                event.stopPropagation();
                                openProductDetail(item);
                              }}
                              aria-label={`Xem chi tiết ${item.name}`}
                              title="Xem chi tiết"
                            >
                              <Eye className="h-3.5 w-3.5" aria-hidden />
                            </button>
                            {canEditScrapeProducts ? (
                              <>
                                <button
                                  type="button"
                                  className="inline-flex h-8 w-8 items-center justify-center rounded border border-amber-200 bg-white text-amber-800 transition-colors hover:bg-amber-50 focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:outline-none"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    openProductDetail(item);
                                  }}
                                  aria-label={`Sửa ${item.name}`}
                                  title="Sửa sản phẩm"
                                >
                                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                                </button>
                                <button
                                  type="button"
                                  className="inline-flex h-8 w-8 items-center justify-center rounded border border-rose-200 bg-white text-rose-700 transition-colors hover:bg-rose-50 focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:outline-none disabled:opacity-60"
                                  disabled={deleteShopScrapeJobProduct.isPending}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setDeleteProductTarget(item);
                                  }}
                                  aria-label={`Xóa ${item.name} khỏi job`}
                                  title="Xóa khỏi preview — không nhập DB"
                                >
                                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                                </button>
                              </>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            </>
          ) : null}

            {filteredScrapeProducts.length > 0 ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-1 text-xs text-slate-600">
                <p>
                  Hiển thị{" "}
                  {(productPageIndex * productPageSize + 1).toLocaleString(
                    "vi-VN",
                  )}
                  –
                  {Math.min(
                    (productPageIndex + 1) * productPageSize,
                    filteredScrapeProducts.length,
                  ).toLocaleString("vi-VN")}{" "}
                  / {filteredScrapeProducts.length.toLocaleString("vi-VN")} sau
                  lọc
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2">
                    <span>Dòng/trang</span>
                    <select
                      className="rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] px-2 py-1"
                      value={productPageSize}
                      aria-label="Số sản phẩm mỗi trang"
                      onChange={(event) => {
                        setProductPageSize(Number(event.target.value));
                        setProductPageIndex(0);
                      }}
                    >
                      {[25, 50, 100].map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={productPageIndex === 0}
                    onClick={() =>
                      setProductPageIndex((current) => Math.max(0, current - 1))
                    }
                  >
                    Trang trước
                  </Button>
                  <span>
                    Trang {productPageIndex + 1} / {productPageCount}
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={productPageIndex + 1 >= productPageCount}
                    onClick={() =>
                      setProductPageIndex((current) =>
                        Math.min(productPageCount - 1, current + 1),
                      )
                    }
                  >
                    Trang sau
                  </Button>
                </div>
              </div>
            ) : scrapeProducts.length > 0 ? (
              <EmptyState
                className="mt-4"
                title="Không có sản phẩm khớp bộ lọc."
                description="Thử bỏ bộ lọc chất lượng hoặc tắt ẩn sản phẩm thiếu tên."
              />
            ) : null}
            </>
          ) : null}
        </section>
      ) : null}

      {importResult ? (
        <section className="panel p-4">
          <div className="flex flex-wrap items-start justify-between gap-1">
            <div>
              <p className="section-title">Kết quả nhập</p>
              <h2 className="mt-1 text-base font-bold text-slate-950">
                Đã ghi vào catalog vật tư
              </h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge tone="success" count={importResult.created}>
                Tạo mới
              </Badge>
              <Badge tone="info" count={importResult.updated}>
                Cập nhật
              </Badge>
              <Badge tone="neutral" count={importResult.skipped}>
                Bỏ qua
              </Badge>
              <Badge
                tone={importResult.failed > 0 ? "critical" : "neutral"}
                count={importResult.failed}
              >
                Lỗi
              </Badge>
              <Badge tone="neutral">
                <Clock3 className="h-3 w-3" aria-hidden />
                {formatDuration(importResult.durationMs)}
              </Badge>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto rounded border border-slate-400">
            <table className="w-full min-w-[34rem] table-fixed divide-y divide-slate-200 text-sm break-words">
              <thead className="bg-slate-50 text-left text-xs font-bold text-slate-700 uppercase">
                <tr>
                  <th className="px-3 py-2">Sản phẩm</th>
                  <th className="px-3 py-2">Trạng thái</th>
                  <th className="px-3 py-2">Nguồn</th>
                  <th className="px-3 py-2 text-right">Mở</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {importResult.items.map((item, index) => (
                  <tr key={`${item.sourceUrl}-${item.name}-${index}`}>
                    <td className="max-w-sm px-3 py-2 font-semibold text-slate-950">
                      <span className="line-clamp-2">{item.name}</span>
                      {item.message ? (
                        <span className="mt-1 block text-xs font-medium text-slate-700">
                          {item.message}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={actionTone[item.action]}>
                        {actionLabel[item.action]}
                      </Badge>
                    </td>
                    <td className="max-w-xs px-3 py-2 text-xs text-slate-600">
                      <a
                        href={item.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="line-clamp-2 hover:text-blue-700 hover:underline"
                      >
                        {item.sourceUrl}
                      </a>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {item.materialId ? (
                        <Link
                          href={`/materials/${item.materialId}`}
                          className="inline-flex h-8 w-8 items-center justify-center rounded border border-slate-500 bg-white text-slate-600 shadow-[var(--shadow-flat)] hover:border-slate-600 hover:bg-slate-100 hover:text-blue-700"
                          aria-label={`Mở vật tư ${item.name}`}
                        >
                          <ArrowUpRight className="h-4 w-4" aria-hidden />
                        </Link>
                      ) : (
                        <span className="text-xs text-slate-600">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
        </>
      )}
    </div>
  );
}
