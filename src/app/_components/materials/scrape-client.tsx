"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  ArrowUpRight,
  Boxes,
  CheckSquare,
  Clock3,
  ExternalLink,
  FileSpreadsheet,
  Link as LinkIcon,
  Loader2,
  Plus,
  RotateCcw,
  Search,
  Square,
  StopCircle,
  Upload,
} from "lucide-react";

import { Badge, Button, EmptyState } from "~/app/_components/ui";
import { useToast } from "~/app/_components/ui/toast";
import { api, type RouterOutputs } from "~/trpc/react";

type ScrapeJob = RouterOutputs["material"]["getShopScrapeJob"];
type ScrapedProduct = ScrapeJob["products"][number];
type ImportJob = RouterOutputs["material"]["getShopImportJob"];
type ImportShopItem = ImportJob["items"][number];
type PendingScrapeJob = {
  url: string;
  maxPages: number;
  maxProducts: number;
  startedAt: number;
};

const SHOP_SCRAPE_JOB_STORAGE_KEY = "bidtool:shop-scrape-job:v1";
const SHOP_IMPORT_JOB_STORAGE_KEY = "bidtool:shop-import-job:v1";
const SCRAPE_POLL_MS = 1_500;
const IMPORT_POLL_MS = 1_000;
const ACTIVE_CLOCK_MS = 1_000;
const SHOP_JOB_CACHE_MS = 60 * 60_000;
const DEFAULT_MAX_PAGES = 25;
const DEFAULT_MAX_PRODUCTS = 500;
const MAX_PAGE_LIMIT = 100;
const MAX_PRODUCT_LIMIT = 2_000;

const actionTone: Record<
  ImportShopItem["action"],
  Parameters<typeof Badge>[0]["tone"]
> = {
  created: "success",
  updated: "info",
  skipped: "neutral",
  failed: "critical",
};

const actionLabel: Record<ImportShopItem["action"], string> = {
  created: "Tạo mới",
  updated: "Cập nhật",
  skipped: "Bỏ qua",
  failed: "Lỗi",
};

const statusLabel: Record<ScrapeJob["status"], string> = {
  queued: "Đang xếp hàng",
  running: "Đang scrape",
  completed: "Hoàn tất",
  failed: "Lỗi",
  cancelled: "Đã hủy",
};

const statusTone: Record<
  ScrapeJob["status"],
  Parameters<typeof Badge>[0]["tone"]
> = {
  queued: "neutral",
  running: "info",
  completed: "success",
  failed: "critical",
  cancelled: "warning",
};

const importStatusLabel: Record<ImportJob["status"], string> = {
  queued: "Đang xếp hàng",
  running: "Đang nhập",
  completed: "Hoàn tất",
  failed: "Lỗi",
  cancelled: "Đã hủy",
};

const importStatusTone: Record<
  ImportJob["status"],
  Parameters<typeof Badge>[0]["tone"]
> = {
  queued: "neutral",
  running: "info",
  completed: "success",
  failed: "critical",
  cancelled: "warning",
};

function hostFromUrl(value: string) {
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}

function formatMoney(value: number | null | undefined, currency = "VND") {
  if (value == null) {
    return "-";
  }
  return `${value.toLocaleString("vi-VN")} ${currency}`;
}

function formatDuration(ms: number | null | undefined) {
  if (ms == null) {
    return "-";
  }
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toLocaleString("vi-VN", {
      maximumFractionDigits: 1,
    })}s`;
  }
  return `${Math.floor(seconds / 60).toLocaleString("vi-VN")}m ${Math.round(
    seconds % 60,
  ).toLocaleString("vi-VN")}s`;
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

function readStoredJobId(storageKey: string) {
  try {
    return window.localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

function writeStoredJobId(storageKey: string, jobId: string | null) {
  try {
    if (jobId) {
      window.localStorage.setItem(storageKey, jobId);
    } else {
      window.localStorage.removeItem(storageKey);
    }
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
}

function productKey(product: ScrapedProduct) {
  return product.sourceUrl;
}

function progressPercent(value: number, total: number) {
  if (total <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((value / total) * 100));
}

function isJobActive(job: ScrapeJob | null | undefined) {
  return job?.status === "queued" || job?.status === "running";
}

function isImportJobActive(job: ImportJob | null | undefined) {
  return job?.status === "queued" || job?.status === "running";
}

function canImportJob(job: ScrapeJob | null | undefined) {
  return (
    !!job &&
    !isJobActive(job) &&
    job.status !== "failed" &&
    job.products.length > 0
  );
}

function isNotFoundTRPCError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const data =
    "data" in error && error.data && typeof error.data === "object"
      ? error.data
      : null;
  const code =
    data && "code" in data && typeof data.code === "string" ? data.code : null;
  const message =
    "message" in error && typeof error.message === "string"
      ? error.message
      : "";

  return code === "NOT_FOUND" || message.includes("Không tìm thấy job");
}

export function MaterialScrapeClient() {
  const [shopUrl, setShopUrl] = useState("");
  const [maxPages, setMaxPages] = useState(DEFAULT_MAX_PAGES);
  const [maxProducts, setMaxProducts] = useState(DEFAULT_MAX_PRODUCTS);
  const [jobId, setJobId] = useState<string | null>(null);
  const [startedJob, setStartedJob] = useState<ScrapeJob | null>(null);
  const [pendingScrapeJob, setPendingScrapeJob] =
    useState<PendingScrapeJob | null>(null);
  const [importJobId, setImportJobId] = useState<string | null>(null);
  const [startedImportJob, setStartedImportJob] = useState<ImportJob | null>(
    null,
  );
  const [finalizedImportJobId, setFinalizedImportJobId] = useState<
    string | null
  >(null);
  const [selectedSourceUrls, setSelectedSourceUrls] = useState<Set<string>>(
    () => new Set(),
  );
  const [clockMs, setClockMs] = useState(() => Date.now());
  const utils = api.useUtils();
  const toast = useToast();

  useEffect(() => {
    const storedJobId = readStoredJobId(SHOP_SCRAPE_JOB_STORAGE_KEY);
    if (storedJobId) {
      setJobId(storedJobId);
    }
    const storedImportJobId = readStoredJobId(SHOP_IMPORT_JOB_STORAGE_KEY);
    if (storedImportJobId) {
      setImportJobId(storedImportJobId);
    }
  }, []);

  useEffect(() => {
    writeStoredJobId(SHOP_SCRAPE_JOB_STORAGE_KEY, jobId);
  }, [jobId]);

  useEffect(() => {
    writeStoredJobId(SHOP_IMPORT_JOB_STORAGE_KEY, importJobId);
  }, [importJobId]);

  const jobQuery = api.material.getShopScrapeJob.useQuery(
    { jobId: jobId ?? "" },
    {
      enabled: jobId !== null,
      refetchInterval: (query) => {
        const job = query.state.data;
        return isJobActive(job) ? SCRAPE_POLL_MS : false;
      },
      refetchOnWindowFocus: false,
      retry: false,
      staleTime: 0,
      gcTime: SHOP_JOB_CACHE_MS,
    },
  );
  const importJobQuery = api.material.getShopImportJob.useQuery(
    { jobId: importJobId ?? "" },
    {
      enabled: importJobId !== null,
      refetchInterval: (query) => {
        const job = query.state.data;
        return isImportJobActive(job) ? IMPORT_POLL_MS : false;
      },
      refetchOnWindowFocus: false,
      retry: false,
      staleTime: 0,
      gcTime: SHOP_JOB_CACHE_MS,
    },
  );
  const activeJob = jobQuery.data ?? startedJob;
  const activeImportJob = importJobQuery.data ?? startedImportJob;
  const isActive = isJobActive(activeJob);
  const isImportActive = isImportJobActive(activeImportJob);
  const isStartingScrape = !!pendingScrapeJob;
  const canStart =
    shopUrl.trim().length > 0 &&
    !isStartingScrape &&
    !isActive &&
    !isImportActive;
  const selectedCount = selectedSourceUrls.size;
  const allProductKeys = useMemo(
    () => new Set(activeJob?.products.map(productKey) ?? []),
    [activeJob?.products],
  );
  const allSelected =
    allProductKeys.size > 0 &&
    Array.from(allProductKeys).every((key) => selectedSourceUrls.has(key));
  const canImportSelected =
    canImportJob(activeJob) && selectedCount > 0 && !isImportActive;
  const canImportAll = canImportJob(activeJob) && !isImportActive;
  const scrapeJobPollingError =
    jobQuery.isError && !isNotFoundTRPCError(jobQuery.error)
      ? (jobQuery.error.message ?? "Không cập nhật được tiến độ scrape.")
      : null;
  const importJobPollingError =
    importJobQuery.isError && !isNotFoundTRPCError(importJobQuery.error)
      ? (importJobQuery.error.message ??
        "Không cập nhật được tiến độ nhập catalog.")
      : null;

  useEffect(() => {
    if (!pendingScrapeJob && !isActive && !isImportActive) {
      return;
    }

    const timerId = window.setInterval(
      () => setClockMs(Date.now()),
      ACTIVE_CLOCK_MS,
    );
    return () => window.clearInterval(timerId);
  }, [pendingScrapeJob, isActive, isImportActive]);

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
    if (!jobId || !jobQuery.isError || !isNotFoundTRPCError(jobQuery.error)) {
      return;
    }

    setJobId(null);
    setStartedJob(null);
    setPendingScrapeJob(null);
    setSelectedSourceUrls(new Set());
    toast.warning("Job scrape đã hết hạn trên server, đã xóa trạng thái cũ.");
  }, [jobId, jobQuery.error, jobQuery.isError, toast]);

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
      setJobId(job.id);
      setPendingScrapeJob(null);
      setStartedImportJob(null);
      setImportJobId(null);
      setFinalizedImportJobId(null);
      setSelectedSourceUrls(new Set());
      utils.material.getShopScrapeJob.setData({ jobId: job.id }, job);
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
      toast.warning("Đã hủy job scrape shop.");
    },
    onError: (error) => {
      toast.error(error.message || "Không thể hủy job scrape shop.");
    },
  });

  const startShopImportJob = api.material.startShopImportJob.useMutation({
    onSuccess: (job) => {
      setStartedImportJob(job);
      setImportJobId(job.id);
      setFinalizedImportJobId(null);
      utils.material.getShopImportJob.setData({ jobId: job.id }, job);
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
  }, [activeImportJob, finalizedImportJobId, toast, utils.material]);

  const startScrape = (url = shopUrl.trim()) => {
    const normalizedUrl = url.trim();
    if (!normalizedUrl || isStartingScrape || isActive || isImportActive) {
      return;
    }
    setShopUrl(normalizedUrl);
    setStartedJob(null);
    setJobId(null);
    setPendingScrapeJob({
      url: normalizedUrl,
      maxPages,
      maxProducts,
      startedAt: Date.now(),
    });
    setClockMs(Date.now());
    setStartedImportJob(null);
    setImportJobId(null);
    setFinalizedImportJobId(null);
    setSelectedSourceUrls(new Set());
    startShopScrapeJob.mutate({
      url: normalizedUrl,
      maxPages,
      maxProducts,
    });
  };

  const submitScrape = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (canStart) {
      startScrape();
    }
  };

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
    setSelectedSourceUrls(
      allSelected ? new Set() : new Set(activeJob?.products.map(productKey)),
    );
  };

  const importAll = () => {
    if (!activeJob || !canImportAll) {
      return;
    }
    startShopImportJob.mutate({ jobId: activeJob.id });
  };

  const importSelected = () => {
    if (!activeJob || !canImportSelected) {
      return;
    }
    startShopImportJob.mutate({
      jobId: activeJob.id,
      sourceUrls: Array.from(selectedSourceUrls),
    });
  };

  const resetJob = () => {
    if (isStartingScrape || isImportActive) {
      return;
    }
    setJobId(null);
    setStartedJob(null);
    setPendingScrapeJob(null);
    setImportJobId(null);
    setStartedImportJob(null);
    setFinalizedImportJobId(null);
    setSelectedSourceUrls(new Set());
  };

  const pagePercent = activeJob
    ? progressPercent(activeJob.pagesVisited.length, activeJob.maxPages)
    : 0;
  const productPercent = activeJob
    ? progressPercent(activeJob.productCount, activeJob.maxProducts)
    : 0;
  const importPercent = activeImportJob
    ? progressPercent(activeImportJob.processed, activeImportJob.total)
    : 0;
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
      <section className="panel p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="section-title">Scrape shop</p>
            <h2 className="mt-1 text-base font-bold text-slate-950">
              Chạy job scrape nhiều trang rồi nhập vào catalog
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Job chạy nền trên server, tự theo link trang sau cùng domain, cập
              nhật tiến độ liên tục và chỉ nhập vào DB khi bạn chọn sản phẩm cần
              thêm.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/materials"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Boxes className="h-4 w-4" aria-hidden />
              Danh mục
            </Link>
            <Link
              href="/materials/import"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <FileSpreadsheet className="h-4 w-4" aria-hidden />
              Nhập sheet
            </Link>
            <Link
              href="/materials/new"
              className="inline-flex items-center gap-1.5 rounded-lg bg-sky-700 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-800"
            >
              <Plus className="h-4 w-4" aria-hidden />
              Thêm thủ công
            </Link>
          </div>
        </div>

        <form onSubmit={submitScrape} className="mt-5 space-y-3">
          <label className="grid gap-1.5">
            <span className="text-xs font-bold text-slate-700">Shop URL</span>
            <span className="relative">
              <LinkIcon
                className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden
              />
              <input
                className="min-h-10 w-full rounded-lg border border-slate-300 bg-white py-2 pr-3 pl-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-100 focus:outline-none"
                placeholder="https://shop.example.com/category"
                value={shopUrl}
                disabled={isStartingScrape || isActive}
                onChange={(event) => setShopUrl(event.target.value)}
                aria-label="URL shop để scrape sản phẩm"
              />
            </span>
          </label>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[8rem_11rem] lg:items-end">
            <label className="grid gap-1.5">
              <span className="text-xs font-bold text-slate-700">
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
                className="min-h-9 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:ring-2 focus:ring-sky-100 focus:outline-none"
                value={maxPages}
                disabled={isStartingScrape || isActive}
                onChange={(event) =>
                  setMaxPages(
                    clampNumber(Number(event.target.value), 1, MAX_PAGE_LIMIT),
                  )
                }
                aria-label="Số trang tối đa cần scrape"
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-bold text-slate-700">
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
                className="min-h-9 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:ring-2 focus:ring-sky-100 focus:outline-none"
                value={maxProducts}
                disabled={isStartingScrape || isActive}
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

          <div className="flex flex-wrap items-center gap-2">
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
                  cancelShopScrapeJob.mutate({ jobId: activeJob.id });
                }
              }}
            >
              Hủy job
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={
                isStartingScrape || (isActive && !!activeJob) || isImportActive
              }
              leftIcon={<RotateCcw className="h-4 w-4" />}
              onClick={resetJob}
            >
              Xóa trạng thái
            </Button>
            <Badge tone="neutral">Theo pagination cùng domain</Badge>
            <Badge tone="neutral">Chặn ảnh / font / media</Badge>
            <Badge tone="neutral">Nhập sau khi duyệt</Badge>
          </div>
        </form>
      </section>

      {scrapeJobPollingError ? (
        <section className="panel border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          <div className="flex flex-wrap items-center justify-between gap-3">
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
          <div className="flex flex-wrap items-center justify-between gap-3">
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

      {pendingScrapeJob && !activeJob ? (
        <section className="panel p-4 sm:p-5" aria-live="polite">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="section-title">Tiến độ job</p>
              <h2 className="mt-1 text-base font-bold text-slate-950">
                {hostFromUrl(pendingScrapeJob.url)}
              </h2>
              <p className="mt-1 text-xs text-slate-500">
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

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <div className="rounded-lg border border-sky-200 bg-sky-50 p-3">
              <div className="flex items-center justify-between gap-3 text-xs font-semibold text-slate-700">
                <span>Trang tối đa</span>
                <span>{pendingScrapeJob.maxPages.toLocaleString("vi-VN")}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white">
                <div className="h-full w-1/2 animate-pulse rounded-full bg-sky-600" />
              </div>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <div className="flex items-center justify-between gap-3 text-xs font-semibold text-slate-700">
                <span>Sản phẩm tối đa</span>
                <span>
                  {pendingScrapeJob.maxProducts.toLocaleString("vi-VN")}
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white">
                <div className="h-full w-1/2 animate-pulse rounded-full bg-emerald-600" />
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs leading-5 text-slate-600">
            <span className="font-semibold text-slate-800">URL: </span>
            {pendingScrapeJob.url}
          </div>
        </section>
      ) : null}

      {activeJob ? (
        <section className="panel p-4 sm:p-5" aria-live="polite">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="section-title">Tiến độ job</p>
              <h2 className="mt-1 text-base font-bold text-slate-950">
                {hostFromUrl(activeJob.url)}
              </h2>
              <p className="mt-1 text-xs text-slate-500">
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
                <Clock3 className="h-3 w-3" aria-hidden />
                {formatDuration(activeJob.durationMs)}
              </Badge>
            </div>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between gap-3 text-xs font-semibold text-slate-600">
                <span>Trang đã đọc</span>
                <span>
                  {activeJob.pagesVisited.length.toLocaleString("vi-VN")} /{" "}
                  {activeJob.maxPages.toLocaleString("vi-VN")}
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white">
                <div
                  className="h-full rounded-full bg-sky-600"
                  style={{ width: `${pagePercent}%` }}
                />
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between gap-3 text-xs font-semibold text-slate-600">
                <span>Sản phẩm tìm thấy</span>
                <span>
                  {activeJob.productCount.toLocaleString("vi-VN")} /{" "}
                  {activeJob.maxProducts.toLocaleString("vi-VN")}
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white">
                <div
                  className="h-full rounded-full bg-emerald-600"
                  style={{ width: `${productPercent}%` }}
                />
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-2 text-xs text-slate-600 lg:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <span className="font-semibold text-slate-800">Đang đọc: </span>
              {activeJob.currentUrl ?? "-"}
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <span className="font-semibold text-slate-800">
                Queue còn lại:{" "}
              </span>
              {activeJob.queueLength.toLocaleString("vi-VN")}
            </div>
          </div>

          {activeJob.error ? (
            <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-900">
              {activeJob.error}
            </div>
          ) : null}

          {activeJob.failedPages.length > 0 ? (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
              {activeJob.failedPages.length.toLocaleString("vi-VN")} trang không
              đọc được. Job vẫn giữ các sản phẩm đã tìm thấy.
            </div>
          ) : null}
        </section>
      ) : null}

      {activeJob ? (
        <section className="panel p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="section-title">Sản phẩm scrape</p>
              <h2 className="mt-1 text-base font-bold text-slate-950">
                Chọn sản phẩm để nhập catalog
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                {activeJob.products.length.toLocaleString("vi-VN")} sản phẩm đã
                sẵn sàng trong job hiện tại.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={activeJob.products.length === 0 || isImportActive}
                leftIcon={
                  allSelected ? (
                    <CheckSquare className="h-3.5 w-3.5" />
                  ) : (
                    <Square className="h-3.5 w-3.5" />
                  )
                }
                onClick={selectAllProducts}
              >
                {allSelected ? "Bỏ chọn tất cả" : "Chọn tất cả"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={!canImportSelected}
                isLoading={
                  startShopImportJob.isPending &&
                  startShopImportJob.variables?.sourceUrls !== undefined
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
                disabled={!canImportAll}
                isLoading={
                  startShopImportJob.isPending &&
                  startShopImportJob.variables?.sourceUrls === undefined
                }
                leftIcon={<Upload className="h-3.5 w-3.5" />}
                onClick={importAll}
              >
                Nhập tất cả
              </Button>
            </div>
          </div>

          <div className="mt-4 grid gap-3 xl:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-bold tracking-wide text-slate-500 uppercase">
                    Quá trình scrape
                  </p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">
                    {activeJob.productCount.toLocaleString("vi-VN")} sản phẩm từ{" "}
                    {activeJob.pagesVisited.length.toLocaleString("vi-VN")}{" "}
                    trang
                  </p>
                </div>
                <Badge tone={statusTone[activeJob.status]}>
                  {isActive ? (
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                  ) : null}
                  {statusLabel[activeJob.status]}
                </Badge>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3 text-xs font-semibold text-slate-600">
                <span>Sản phẩm scrape</span>
                <span>
                  {activeJob.productCount.toLocaleString("vi-VN")} /{" "}
                  {activeJob.maxProducts.toLocaleString("vi-VN")}
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white">
                <div
                  className="h-full rounded-full bg-emerald-600"
                  style={{ width: `${productPercent}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Đã đọc {activeJob.pagesVisited.length.toLocaleString("vi-VN")} /{" "}
                {activeJob.maxPages.toLocaleString("vi-VN")} trang trong{" "}
                {formatDuration(activeJob.durationMs)}.
              </p>
            </div>

            <div
              className={
                isImportActive
                  ? "rounded-lg border border-sky-200 bg-sky-50 p-3"
                  : "rounded-lg border border-slate-200 bg-white p-3"
              }
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-bold tracking-wide text-slate-500 uppercase">
                    Quá trình nhập catalog
                  </p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">
                    {activeImportJob
                      ? `${activeImportJob.processed.toLocaleString(
                          "vi-VN",
                        )} / ${activeImportJob.total.toLocaleString("vi-VN")}`
                      : `${selectedCount.toLocaleString(
                          "vi-VN",
                        )} đã chọn / ${activeJob.products.length.toLocaleString(
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
                      onClick={() =>
                        cancelShopImportJob.mutate({
                          jobId: activeImportJob.id,
                        })
                      }
                    >
                      Hủy nhập
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between gap-3 text-xs font-semibold text-slate-600">
                <span>Tiến độ ghi DB</span>
                <span>{activeImportJob ? `${importPercent}%` : "0%"}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-sky-600"
                  style={{ width: `${importPercent}%` }}
                />
              </div>

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
                    <p className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs text-rose-900">
                      {activeImportJob.error}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="mt-2 text-xs text-slate-500">
                  Sẵn sàng ghi catalog sau khi chọn sản phẩm.
                </p>
              )}
            </div>
          </div>

          {activeJob.products.length > 0 ? (
            <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-[980px] divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-bold text-slate-500 uppercase">
                  <tr>
                    <th className="w-10 px-3 py-2"> </th>
                    <th className="px-3 py-2">Sản phẩm</th>
                    <th className="px-3 py-2">Giá</th>
                    <th className="px-3 py-2">Đơn vị</th>
                    <th className="px-3 py-2">Nguồn</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {activeJob.products.map((item, index) => {
                    const key = productKey(item);
                    const selected = selectedSourceUrls.has(key);

                    return (
                      <tr
                        key={`${key}-${index}`}
                        className={
                          selected ? "bg-sky-50/70" : "hover:bg-slate-50"
                        }
                      >
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-sky-600"
                            checked={selected}
                            disabled={isImportActive}
                            onChange={() => toggleProduct(item)}
                            aria-label={`Chọn ${item.name}`}
                          />
                        </td>
                        <td className="max-w-sm px-3 py-2 font-semibold text-slate-950">
                          <span className="line-clamp-2">{item.name}</span>
                          <span className="mt-1 block text-xs font-medium text-slate-500">
                            {[
                              item.sku ? `SKU ${item.sku}` : null,
                              item.category,
                            ]
                              .filter(Boolean)
                              .join(" • ") || "Không có SKU / nhóm"}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-semibold text-slate-900 tabular-nums">
                          {formatMoney(item.price, item.currency)}
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          {item.unit ?? "unknown"}
                        </td>
                        <td className="max-w-xs px-3 py-2 text-xs text-slate-600">
                          <a
                            href={item.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex max-w-full items-center gap-1 hover:text-sky-700 hover:underline"
                          >
                            <span className="truncate">{item.sourceUrl}</span>
                            <ExternalLink
                              className="h-3.5 w-3.5 shrink-0"
                              aria-hidden
                            />
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              className="mt-4"
              title={
                isActive
                  ? "Đang đọc shop, chưa có sản phẩm."
                  : "Job này chưa tìm thấy sản phẩm."
              }
              description="Nếu shop có nhiều JavaScript hoặc chặn crawler, hãy thử URL danh mục cụ thể hơn hoặc tăng giới hạn trang."
            />
          )}
        </section>
      ) : null}

      {importResult ? (
        <section className="panel p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
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

          <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-bold text-slate-500 uppercase">
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
                        <span className="mt-1 block text-xs font-medium text-slate-500">
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
                        className="line-clamp-2 hover:text-sky-700 hover:underline"
                      >
                        {item.sourceUrl}
                      </a>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {item.materialId ? (
                        <Link
                          href={`/materials/${item.materialId}`}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-sky-700"
                          aria-label={`Mở vật tư ${item.name}`}
                        >
                          <ArrowUpRight className="h-4 w-4" aria-hidden />
                        </Link>
                      ) : (
                        <span className="text-xs text-slate-400">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
