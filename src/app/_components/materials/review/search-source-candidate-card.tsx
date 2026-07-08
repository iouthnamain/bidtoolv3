"use client";

import { ExternalLink, Globe, Loader2, Sparkles } from "lucide-react";

import {
  matchBand,
  matchBandLabel,
  matchScorePercent,
  type MatchBand,
} from "~/lib/materials/match-assessment";

function confidenceTone(band: MatchBand): {
  badge: string;
} {
  if (band === "high") {
    return { badge: "border-emerald-500 bg-emerald-50 text-emerald-700" };
  }
  return { badge: "border-amber-500 bg-amber-50 text-amber-800" };
}

function SourceTag({ source }: { source: "web" | "ai" }) {
  if (source === "web") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-sky-600 px-2 py-0.5 text-xs font-bold text-white">
        <Globe className="h-3 w-3" aria-hidden />
        Tìm web
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-violet-600 px-2 py-0.5 text-xs font-bold text-white">
      <Sparkles className="h-3 w-3" aria-hidden />
      Tìm AI
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
};

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
  const label = matchBandLabel(band);
  const pct = matchScorePercent(candidate.score);
  const hasConfidence = band != null && !isPending && !isError;
  const tone = band ? confidenceTone(band) : null;

  return (
    <div
      role="button"
      tabIndex={isPending ? -1 : 0}
      onClick={() => {
        if (isPending || isError) return;
        onChoose();
      }}
      onKeyDown={(event) => {
        if (isPending || isError) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onChoose();
        }
      }}
      aria-pressed={isSelected}
      aria-disabled={isPending || isError}
      className={`group relative flex w-full cursor-pointer flex-col gap-1 rounded border p-3 text-left transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:outline-none ${
        isPending || isError
          ? "cursor-default border-dashed border-slate-400 bg-slate-50 opacity-80"
          : isSelected
            ? "border-blue-500 bg-blue-50 ring-1 ring-blue-400"
            : "border-slate-500 bg-white shadow-sm hover:border-slate-600 hover:bg-slate-100"
      }`}
    >
      {candidate.isRecommended && hasConfidence ? (
        <span className="absolute -top-2 left-3 inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-bold text-white shadow-sm">
          Gợi ý tốt nhất
        </span>
      ) : null}

      <div className="flex items-start justify-between gap-2">
        <SourceTag source={candidate.source} />
        <div className="flex shrink-0 items-center gap-1">
          {hasConfidence && tone ? (
            <span
              className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-bold tabular-nums ${tone.badge}`}
              aria-label={`Độ khớp ${label} ${pct}%`}
            >
              {label} · {pct}%
            </span>
          ) : null}
          {hotkeyIndex && hotkeyIndex <= 9 ? (
            <span
              className="inline-flex h-5 w-5 items-center justify-center rounded border border-slate-500 bg-white text-xs font-bold text-slate-700 tabular-nums shadow-[var(--shadow-flat)]"
              aria-hidden
            >
              {hotkeyIndex}
            </span>
          ) : null}
        </div>
      </div>

      <div className="min-w-0">
        {isPending ? (
          <div className="flex items-center gap-2 py-2 text-sm text-slate-700">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {candidate.source === "web" ? "Đang tìm web…" : "Đang tìm AI…"}
          </div>
        ) : isError ? (
          <p className="py-1 text-sm text-red-700">
            {candidate.source === "web"
              ? "Không tìm được liên kết."
              : "Không trích xuất được."}
          </p>
        ) : (
          <>
            <p className="line-clamp-2 text-sm font-bold text-slate-900">
              {candidate.title}
            </p>
            {candidate.priceLabel ? (
              <p className="mt-0.5 text-xs font-bold text-amber-800 tabular-nums">
                {candidate.priceLabel}
              </p>
            ) : null}
            <p className="mt-0.5 line-clamp-1 text-xs text-slate-700">
              {candidate.subtitle}
            </p>
          </>
        )}
      </div>

      {hasConfidence && candidate.chips.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {candidate.chips.map((chip) => (
            <span
              key={chip}
              className="rounded border border-slate-400 bg-slate-50 px-1.5 py-0.5 text-xs font-medium text-slate-600"
            >
              {chip}
            </span>
          ))}
        </div>
      ) : null}

      {!isPending && !isError ? (
        <>
          <div className="flex items-center justify-between gap-2 border-t border-slate-400 pt-2">
            <span className="text-xs font-medium text-slate-700">
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
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
                className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline"
              >
                <ExternalLink className="h-3 w-3" aria-hidden />
                Nguồn
              </a>
            ) : null}
          </div>

          <span
            className={`pointer-events-none rounded px-3 py-1.5 text-center text-xs font-bold transition-colors ${
              isSelected
                ? "bg-blue-600 text-white"
                : "bg-slate-100 text-slate-700 group-hover:bg-slate-200"
            }`}
          >
            {isSelected ? "Đã chọn" : "Chọn kết quả này"}
          </span>
        </>
      ) : null}
    </div>
  );
}
