"use client";

import { ExternalLink, Globe, Loader2, Sparkles } from "lucide-react";

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
      Nguồn AI
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
  hotkeyIndex,
}: {
  candidate: SearchSourceCandidate;
  isSelected: boolean;
  onChoose: () => void;
  hotkeyIndex?: number;
}) {
  const isPending = candidate.status === "pending";
  const isError = candidate.status === "error";
  const band = matchBand(candidate.score);
  const pct = matchScorePercent(candidate.score);
  const isCompleted = !isPending && !isError;
  const tone = confidenceTone(band);
  const priceLabel = priceStateLabel(candidate);

  return (
    <div
      className={`group relative flex w-full min-w-0 cursor-pointer flex-col gap-2 rounded-lg border p-3 text-left transition-colors ${
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
              aria-label={`Độ tin cậy ${pct}%`}
            >
              Độ tin cậy {pct}%
            </span>
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
            <p className="text-ink-1 line-clamp-3 text-sm font-semibold break-words">
              {candidate.title}
            </p>
            {isCompleted ? (
              <p className="text-warning mt-1 text-xs font-semibold break-words tabular-nums">
                {priceLabel}
              </p>
            ) : null}
            <p className="text-ink-3 mt-1 line-clamp-2 text-xs break-words">
              {candidate.subtitle}
            </p>
          </>
        )}
      </div>

      {isCompleted && candidate.chips.length > 0 ? (
        <div className="flex min-w-0 flex-wrap gap-1">
          {candidate.chips.map((chip) => (
            <span
              key={chip}
              className="bg-surface-3 text-ink-3 max-w-full rounded px-1.5 py-0.5 text-xs font-medium break-words"
            >
              {chip}
            </span>
          ))}
        </div>
      ) : null}

      {!isPending && !isError ? (
        <>
          <div className="border-line flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-t pt-2">
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
                className="text-brand focus-visible:ring-ring relative z-20 inline-flex min-h-8 shrink-0 items-center gap-1 text-xs font-semibold hover:underline focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
                Nguồn
              </a>
            ) : null}
          </div>

          <span
            className={`pointer-events-none inline-flex min-h-9 w-full items-center justify-center rounded border px-3 py-1.5 text-center text-xs font-semibold transition-colors ${
              isSelected
                ? "border-brand bg-brand text-white"
                : "border-line bg-surface-2 text-ink-2 group-hover:border-line-strong group-hover:bg-surface-3"
            }`}
          >
            {isSelected ? "Đã chọn" : "Chọn kết quả này"}
          </span>
        </>
      ) : null}
    </div>
  );
}
