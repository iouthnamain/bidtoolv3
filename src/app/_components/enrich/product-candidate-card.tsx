"use client";

import { ExternalLink, ImageOff, Sparkles } from "lucide-react";

import { matchReasonChips } from "~/lib/materials/excel-enrich-fields";
import { formatMoney } from "~/lib/materials/format";
import type { RouterOutputs } from "~/trpc/react";

export type EnrichCandidate =
  RouterOutputs["material"]["enrichMatchRows"]["results"][number]["candidates"][number];

function confidenceTone(score: number): {
  ring: string;
  text: string;
  label: string;
} {
  if (score >= 0.85) {
    return { ring: "bg-emerald-500", text: "text-emerald-700", label: "Cao" };
  }
  if (score >= 0.5) {
    return { ring: "bg-amber-500", text: "text-amber-700", label: "Vừa" };
  }
  return { ring: "bg-slate-400", text: "text-slate-600", label: "Thấp" };
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
  const pct = Math.round((candidate.score ?? 0) * 100);
  const tone = confidenceTone(candidate.score ?? 0);
  const chips = matchReasonChips(candidate.breakdown);
  const hasScore = candidate.score > 0;

  return (
    <button
      type="button"
      onClick={onChoose}
      aria-pressed={isSelected}
      className={`group relative flex w-full flex-col gap-3 rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 ${
        isSelected
          ? "border-sky-500 bg-sky-50 ring-1 ring-sky-400"
          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
      }`}
    >
      {isRecommended ? (
        <span className="absolute -top-2 left-3 inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white shadow-sm">
          <Sparkles className="h-3 w-3" aria-hidden />
          Gợi ý tốt nhất
        </span>
      ) : null}
      {hotkeyIndex && hotkeyIndex <= 9 ? (
        <span
          className="absolute top-2 right-2 inline-flex h-5 w-5 items-center justify-center rounded border border-slate-200 bg-white text-[10px] font-bold text-slate-500 tabular-nums"
          aria-hidden
        >
          {hotkeyIndex}
        </span>
      ) : null}

      <div className="flex gap-3">
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
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

        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-bold text-slate-900">
            {candidate.name}
          </p>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {candidate.code ? `${candidate.code} · ` : ""}
            {candidate.manufacturer ?? "NSX —"}
            {candidate.originCountry ? ` · ${candidate.originCountry}` : ""}
          </p>
          <p className="mt-0.5 text-xs font-semibold text-slate-700 tabular-nums">
            {candidate.unit ? `${candidate.unit} · ` : ""}
            {formatMoney(candidate.defaultUnitPrice, candidate.currency, "Chưa có giá")}
          </p>
        </div>
      </div>

      {hasScore ? (
        <div className="flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full rounded-full ${tone.ring}`}
              style={{ width: `${Math.max(4, pct)}%` }}
              role="meter"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Độ tin cậy ${pct}%`}
            />
          </div>
          <span className={`text-xs font-bold tabular-nums ${tone.text}`}>
            {pct}%
          </span>
        </div>
      ) : null}

      {chips.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {chips.map((chip) => (
            <span
              key={chip}
              className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-600"
            >
              {chip}
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
        <span className="text-[11px] font-medium text-slate-500">
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
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-600 hover:underline"
          >
            <ExternalLink className="h-3 w-3" aria-hidden />
            Nguồn
          </a>
        ) : null}
      </div>

      <span
        className={`pointer-events-none rounded-lg px-3 py-1.5 text-center text-xs font-bold transition-colors ${
          isSelected
            ? "bg-sky-600 text-white"
            : "bg-slate-100 text-slate-700 group-hover:bg-slate-200"
        }`}
      >
        {isSelected ? "Đã chọn" : "Chọn sản phẩm này"}
      </span>
    </button>
  );
}
