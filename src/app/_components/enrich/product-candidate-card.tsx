"use client";

import { ExternalLink, ImageOff, Sparkles } from "lucide-react";

import { formatMoney } from "~/lib/materials/format";
import {
  assessCatalogCandidate,
  matchScorePercent,
  type MatchBand,
} from "~/lib/materials/match-assessment";
import type { RouterOutputs } from "~/trpc/react";

export type EnrichCandidate =
  RouterOutputs["material"]["enrichMatchRows"]["results"][number]["candidates"][number];

function confidenceTone(band: MatchBand): {
  badge: string;
} {
  if (band === "high") {
    return { badge: "border-emerald-500 bg-emerald-50 text-emerald-700" };
  }
  return { badge: "border-amber-500 bg-amber-50 text-amber-800" };
}

export function ProductCandidateCard({
  candidate,
  isSelected,
  isRecommended,
  fillCount,
  onChoose,
  hotkeyIndex,
}: {
  candidate: EnrichCandidate;
  isSelected: boolean;
  isRecommended: boolean;
  /** Number of blank fields this candidate would fill. */
  fillCount: number;
  onChoose: () => void;
  /** 1-based index for the keyboard hint shown on the card (1–9). */
  hotkeyIndex?: number;
}) {
  const assessment = assessCatalogCandidate({
    score: candidate.score,
    breakdown: candidate.breakdown,
    fillCount,
  });
  const pct = matchScorePercent(assessment.score);
  const tone = assessment.band ? confidenceTone(assessment.band) : null;
  const chips = assessment.reasons;
  const hasConfidence = assessment.band != null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onChoose}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onChoose();
        }
      }}
      aria-pressed={isSelected}
      className={`group relative flex w-full cursor-pointer flex-col gap-1 rounded border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
        isSelected
          ? "border-blue-500 bg-blue-50 ring-1 ring-blue-400"
          : "border-slate-500 bg-white shadow-sm hover:border-slate-600 hover:bg-slate-100"
      }`}
    >
      {isRecommended && hasConfidence ? (
        <span className="absolute -top-2 left-3 inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-bold text-white shadow-sm">
          <Sparkles className="h-3 w-3" aria-hidden />
          Gợi ý tốt nhất
        </span>
      ) : null}
      <div className="absolute top-2 right-2 flex items-center gap-1">
        {hasConfidence && tone ? (
          <span
            className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-bold tabular-nums ${tone.badge}`}
            aria-label={`Độ tin cậy ${assessment.label} ${pct}%`}
          >
            {assessment.label} {pct}%
          </span>
        ) : null}
        {hotkeyIndex && hotkeyIndex <= 9 ? (
          <span
            className="inline-flex h-5 w-5 items-center justify-center rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] text-xs font-bold text-slate-700 tabular-nums"
            aria-hidden
          >
            {hotkeyIndex}
          </span>
        ) : null}
      </div>

      <div className="flex gap-1">
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded border border-slate-400 bg-slate-100">
          {candidate.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={candidate.imageUrl}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-slate-300">
              <ImageOff className="h-5 w-5" aria-hidden />
            </div>
          )}
        </div>

        <div
          className={`min-w-0 flex-1 ${
            hasConfidence || (hotkeyIndex && hotkeyIndex <= 9) ? "pr-24" : ""
          }`}
        >
          <p className="line-clamp-2 text-sm font-bold text-slate-900">
            {candidate.name}
          </p>
          <p className="mt-0.5 truncate text-xs text-slate-700">
            {candidate.code ? `${candidate.code} · ` : ""}
            {candidate.manufacturer ?? "NSX —"}
            {candidate.originCountry ? ` · ${candidate.originCountry}` : ""}
          </p>
          <p className="mt-0.5 text-xs tabular-nums">
            {candidate.unit ? (
              <span className="font-semibold text-slate-700">{candidate.unit} · </span>
            ) : null}
            <span
              className={
                candidate.defaultUnitPrice != null
                  ? "font-bold text-amber-800"
                  : "font-medium text-slate-500 italic"
              }
            >
              {formatMoney(candidate.defaultUnitPrice, candidate.currency, "Chưa có giá")}
            </span>
          </p>
        </div>
      </div>

      {hasConfidence && chips.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {chips.map((chip) => (
            <span
              key={chip}
              className="rounded border border-slate-400 bg-slate-50 px-1.5 py-0.5 text-xs font-medium text-slate-600"
            >
              {chip}
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2 border-t border-slate-400 pt-2">
        <span className="text-xs font-medium text-slate-700">
          {fillCount > 0
            ? `Sẽ điền ${fillCount} trường trống`
            : "Không có trường trống để điền"}
        </span>
        {candidate.sourceUrl ? (
          <a
            href={candidate.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
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
        {isSelected ? "Đã chọn" : "Chọn sản phẩm này"}
      </span>
    </div>
  );
}
