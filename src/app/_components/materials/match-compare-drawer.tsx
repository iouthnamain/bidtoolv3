"use client";

import { useEffect } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, Loader2, X } from "lucide-react";

import { Badge, Button, EmptyState } from "~/app/_components/ui";
import { api, type RouterInputs, type RouterOutputs } from "~/trpc/react";

type ScrapedProductInput = RouterInputs["material"]["matchScrapedProduct"]["product"];
type MatchCandidate =
  RouterOutputs["material"]["matchScrapedProduct"]["candidates"][number];

const BREAKDOWN_FIELDS: Array<{
  key: keyof MatchCandidate["breakdown"];
  label: string;
}> = [
  { key: "nameSimilarity", label: "Tên" },
  { key: "manufacturerMatch", label: "Nhà sản xuất" },
  { key: "originMatch", label: "Xuất xứ" },
  { key: "specMatch", label: "Thông số" },
  { key: "dimensionMatch", label: "Kích thước" },
  { key: "unitMatch", label: "Đơn vị" },
];

function scoreTone(score: number): "success" | "warning" | "critical" {
  if (score >= 0.8) return "success";
  if (score >= 0.6) return "warning";
  return "critical";
}

function barColor(value: number): string {
  if (value >= 0.8) return "bg-emerald-500";
  if (value >= 0.5) return "bg-amber-500";
  return "bg-rose-400";
}

export function MatchCompareDrawer({
  open,
  products,
  index,
  onNavigate,
  onClose,
}: {
  open: boolean;
  products: ScrapedProductInput[];
  index: number;
  onNavigate: (index: number) => void;
  onClose: () => void;
}) {
  const total = products.length;
  const safeIndex = Math.min(Math.max(index, 0), Math.max(total - 1, 0));
  const product = products[safeIndex] ?? null;
  const query = api.material.matchScrapedProduct.useQuery(
    { product: product!, limit: 8 },
    { enabled: open && product !== null, staleTime: 30_000 },
  );

  const goPrev = () => onNavigate(Math.max(safeIndex - 1, 0));
  const goNext = () => onNavigate(Math.min(safeIndex + 1, total - 1));

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") goPrev();
      if (e.key === "ArrowRight") goNext();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose, safeIndex, total]);

  if (!open || !product) return null;

  const candidates = query.data?.candidates ?? [];
  const hasMultiple = total > 1;

  return (
    <aside
      role="complementary"
      aria-label="Đối chiếu vật tư"
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-[-8px_0_24px_-12px_rgba(15,23,42,0.25)]"
    >
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 p-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="section-title">Đối chiếu vật tư catalog</p>
              {hasMultiple ? (
                <Badge tone="info">
                  {safeIndex + 1}/{total}
                </Badge>
              ) : null}
            </div>
            <h2 className="mt-1 truncate text-base font-bold text-balance text-slate-950">
              {product.name}
            </h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
              {product.unit ? <Badge tone="neutral">{product.unit}</Badge> : null}
              {product.manufacturer ? (
                <Badge tone="info">{product.manufacturer}</Badge>
              ) : null}
              {product.originCountry ? (
                <Badge tone="neutral">{product.originCountry}</Badge>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Đóng"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        {hasMultiple ? (
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={safeIndex === 0}
              leftIcon={<ChevronLeft className="h-3.5 w-3.5" />}
              onClick={goPrev}
            >
              Trước
            </Button>
            <span className="text-xs font-medium text-slate-500 tabular-nums">
              Sản phẩm {safeIndex + 1} / {total}
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={safeIndex === total - 1}
              rightIcon={<ChevronRight className="h-3.5 w-3.5" />}
              onClick={goNext}
            >
              Sau
            </Button>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {query.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Loader2 className="h-4 w-4 animate-spin" />
              Đang tìm vật tư tương tự…
            </div>
          ) : query.isError ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              Không thể đối chiếu: {query.error.message}
            </div>
          ) : candidates.length === 0 ? (
            <EmptyState
              title="Không tìm thấy vật tư tương tự"
              description="Không có vật tư catalog nào đủ giống để đối chiếu. Sản phẩm này có thể là vật tư mới."
            />
          ) : (
            <ul className="space-y-3">
              {candidates.map((candidate) => (
                <li
                  key={candidate.materialId}
                  className="rounded-lg border border-slate-200 p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">
                        {candidate.name}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {candidate.unit} · ID {candidate.materialId}
                      </p>
                    </div>
                    <Badge tone={scoreTone(candidate.score)}>
                      {(candidate.score * 100).toFixed(0)}%
                    </Badge>
                  </div>

                  <dl className="mt-2.5 space-y-1.5">
                    {BREAKDOWN_FIELDS.map((field) => {
                      const value = candidate.breakdown[field.key] ?? 0;
                      return (
                        <div
                          key={field.key}
                          className="flex items-center gap-2 text-xs"
                        >
                          <dt className="w-20 shrink-0 text-slate-500">
                            {field.label}
                          </dt>
                          <dd className="flex flex-1 items-center gap-2">
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                              <div
                                className={`h-full rounded-full ${barColor(value)}`}
                                style={{ width: `${Math.round(value * 100)}%` }}
                              />
                            </div>
                            <span className="w-8 shrink-0 text-right tabular-nums text-slate-600">
                              {(value * 100).toFixed(0)}
                            </span>
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </div>

        {product.sourceUrl ? (
          <footer className="border-t border-slate-200 p-3">
            <a
              href={product.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-sky-700 hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              Xem trang nguồn
            </a>
          </footer>
        ) : null}
    </aside>
  );
}
