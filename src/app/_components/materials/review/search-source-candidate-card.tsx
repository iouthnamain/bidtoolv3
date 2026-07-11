"use client";

import type { ReactNode } from "react";
import {
  CheckCircle2,
  ExternalLink,
  Globe,
  Loader2,
  Sparkles,
} from "lucide-react";

import { Button } from "~/app/_components/ui";

import {
  matchBand,
  matchScorePercent,
  type MatchBand,
} from "~/lib/materials/match-assessment";

function confidenceTone(band: MatchBand | null): {
  badge: string;
} {
  if (band === "high") {
    return { badge: "border-emerald-200 bg-emerald-50 text-good" };
  }
  return { badge: "border-amber-200 bg-amber-50 text-warning" };
}

function SourceTag({ source }: { source: "web" | "ai" }) {
  if (source === "web") {
    return (
      <span className="text-ink-3 inline-flex min-w-0 items-center gap-1 text-xs font-semibold">
        <Globe className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Nguồn web
      </span>
    );
  }
  return (
    <span className="text-ink-3 inline-flex min-w-0 items-center gap-1 text-xs font-semibold">
      <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden />
      AI trích xuất
    </span>
  );
}

export type SearchSourceCandidate = {
  key: string;
  source: "web" | "ai";
  title: string;
  subtitle: string;
  fillCount: number;
  score: number;
  chips: string[];
  sourceUrl?: string;
  isRecommended?: boolean;
  status?: "pending" | "done" | "error";
  /** Formatted unit price when AI extracted a price. */
  priceLabel?: string;
  /** Whether price extraction found public evidence for this result. */
  priceStatus?: "available" | "not_found" | "unchecked";
  /** Whether this web source already has extracted product fields or a PDF. */
  isCaptured?: boolean;
};

function priceStateLabel(candidate: SearchSourceCandidate) {
  const priceLabel = candidate.priceLabel?.trim();
  if (priceLabel) {
    return priceLabel.startsWith("Giá:") ? priceLabel : `Giá: ${priceLabel}`;
  }

  if (
    candidate.priceStatus === "unchecked" ||
    (candidate.source === "web" && candidate.priceStatus == null)
  ) {
    return "Giá: Chưa kiểm tra";
  }

  return "Giá: Chưa thấy giá công khai";
}

export function SearchSourceCandidateCard({
  candidate,
  isSelected,
  onChoose,
  onCapture,
  isCapturePending = false,
  isCaptureDisabled = false,
  captureStatusText,
  inlineLayer,
  hotkeyIndex,
}: {
  candidate: SearchSourceCandidate;
  isSelected: boolean;
  onChoose: () => void;
  onCapture?: () => void;
  isCapturePending?: boolean;
  isCaptureDisabled?: boolean;
  captureStatusText?: string;
  inlineLayer?: ReactNode;
  hotkeyIndex?: number;
}) {
  const isPending = candidate.status === "pending";
  const isError = candidate.status === "error";
  const band = matchBand(candidate.score);
  const pct = matchScorePercent(candidate.score);
  const isCompleted = !isPending && !isError;
  const tone = confidenceTone(band);
  const priceLabel = priceStateLabel(candidate);
  const isPdf = candidate.sourceUrl
    ? /\.pdf(?:$|[?#])/i.test(candidate.sourceUrl)
    : false;

  return (
    <div
      className={`group relative flex w-full min-w-0 cursor-pointer flex-col gap-1.5 rounded-[var(--radius-panel)] border px-2.5 py-2 text-left transition-colors duration-150 motion-reduce:transition-none ${
        isPending || isError
          ? "border-line-strong bg-surface-2 cursor-default border-dashed opacity-80"
          : isSelected
            ? "border-brand bg-brand/[0.06] ring-brand/20 ring-1"
            : "border-line bg-surface-1 hover:border-line-strong hover:bg-surface-2"
      }`}
    >
      <button
        type="button"
        aria-label={`Chọn ${candidate.source === "web" ? "nguồn web" : "kết quả AI"} ${candidate.title}`}
        aria-pressed={isSelected}
        aria-keyshortcuts={
          hotkeyIndex && hotkeyIndex <= 9 ? String(hotkeyIndex) : undefined
        }
        disabled={isPending || isError}
        onClick={onChoose}
        className="focus-visible:ring-ring absolute inset-0 z-10 cursor-pointer rounded-lg focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-default"
      />

      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <SourceTag source={candidate.source} />
          {candidate.isRecommended && band != null ? (
            <span className="text-good inline-flex items-center gap-1 text-xs font-semibold">
              <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Gợi ý tốt nhất
            </span>
          ) : null}
        </div>
        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1">
          {isCompleted ? (
            <span
              className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap tabular-nums ${tone.badge}`}
              aria-label={`Mức khớp ${pct}%`}
            >
              Mức khớp {pct}%
            </span>
          ) : null}
          {isSelected && isCompleted ? (
            <CheckCircle2
              className="text-brand h-4 w-4 shrink-0"
              aria-label="Đã chọn"
            />
          ) : null}
          {hotkeyIndex && hotkeyIndex <= 9 ? (
            <span
              className="border-line-strong bg-surface-1 text-ink-2 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs font-bold tabular-nums"
              aria-hidden
            >
              {hotkeyIndex}
            </span>
          ) : null}
        </div>
      </div>

      <div className="min-w-0">
        {isPending ? (
          <div
            role="status"
            aria-live="polite"
            className="text-ink-2 flex min-w-0 items-center gap-2 py-2 text-sm"
          >
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
            {candidate.source === "web" ? "Đang tìm web…" : "Đang tìm AI…"}
          </div>
        ) : isError ? (
          <p className="text-critical py-1 text-sm break-words">
            {candidate.source === "web"
              ? "Không tìm được liên kết."
              : "Không trích xuất được."}
          </p>
        ) : (
          <>
            <p className="text-ink-1 line-clamp-2 text-sm leading-5 font-semibold text-pretty break-words">
              {candidate.title}
            </p>
            {isCompleted ? (
              <p className="text-warning mt-0.5 text-xs font-semibold break-words tabular-nums">
                {priceLabel}
              </p>
            ) : null}
            <p className="text-ink-3 mt-0.5 line-clamp-1 text-xs break-words">
              {candidate.subtitle}
            </p>
          </>
        )}
      </div>

      {isCompleted && candidate.chips.length > 0 ? (
        <div className="flex min-w-0 flex-wrap gap-1">
          {candidate.chips.slice(0, 2).map((chip) => (
            <span
              key={chip}
              className="bg-surface-3 text-ink-3 max-w-full rounded px-1.5 py-0.5 text-xs font-medium break-words"
            >
              {chip}
            </span>
          ))}
          {candidate.chips.length > 2 ? (
            <span className="bg-surface-3 text-ink-3 rounded px-1.5 py-0.5 text-xs font-medium">
              +{candidate.chips.length - 2}
            </span>
          ) : null}
        </div>
      ) : null}

      {!isPending && !isError ? (
        <>
          <div className="border-line mt-auto flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-t pt-1.5">
            <span className="text-ink-3 min-w-0 flex-1 text-xs font-medium break-words">
              {candidate.fillCount > 0
                ? `Sẽ điền ${candidate.fillCount} trường trống`
                : candidate.source === "web"
                  ? "Liên kết tham khảo"
                  : "Không có trường trống để điền"}
            </span>
            {candidate.sourceUrl ? (
              <a
                href={candidate.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand focus-visible:ring-ring relative z-20 inline-flex min-h-10 shrink-0 items-center gap-1 text-xs font-semibold hover:underline focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
                Nguồn
              </a>
            ) : null}
          </div>

          {isSelected && candidate.source === "web" ? (
            candidate.isCaptured ? (
              <p
                role="status"
                className="text-good relative z-20 inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold"
              >
                <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
                {isPdf ? "Đã dùng catalog PDF" : "Đã scrape thông tin"}
              </p>
            ) : onCapture ? (
              <div
                role="status"
                aria-live="polite"
                aria-atomic="true"
                className="relative z-20"
              >
                <Button
                  variant="scrape"
                  size="sm"
                  className="w-full"
                  onClick={onCapture}
                  isLoading={isCapturePending}
                  disabled={isCaptureDisabled}
                >
                  {isCapturePending
                    ? isPdf
                      ? "Đang gắn PDF…"
                      : "Đang scrape…"
                    : isPdf
                      ? "Dùng catalog PDF"
                      : "Scrape nguồn này"}
                </Button>
                {isCapturePending && captureStatusText ? (
                  <p className="text-ink-3 mt-1 text-xs leading-4">
                    {captureStatusText}
                  </p>
                ) : null}
              </div>
            ) : null
          ) : null}
          {isSelected && candidate.source === "web" && inlineLayer ? (
            <div className="relative z-20 mt-1">{inlineLayer}</div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
