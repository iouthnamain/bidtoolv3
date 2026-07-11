"use client";

import { CheckCircle2, ExternalLink, ImageOff, Sparkles } from "lucide-react";

import { formatMoney } from "~/lib/materials/format";
import {
  assessCatalogCandidate,
  matchScorePercent,
  type MatchBand,
} from "~/lib/materials/match-assessment";
import type { RouterOutputs } from "~/trpc/react";

export type EnrichCandidate =
  RouterOutputs["material"]["enrichMatchRows"]["results"][number]["candidates"][number];

function confidenceTone(band: MatchBand | null): {
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
  priceStatus,
}: {
  candidate: EnrichCandidate;
  isSelected: boolean;
  isRecommended: boolean;
  /** Number of blank fields this candidate would fill. */
  fillCount: number;
  onChoose: () => void;
  /** 1-based index for the keyboard hint shown on the card (1–9). */
  hotkeyIndex?: number;
  /** Allows callers with external price extraction to distinguish unchecked data. */
  priceStatus?: "available" | "not_found" | "unchecked";
}) {
  const assessment = assessCatalogCandidate({
    score: candidate.score,
    breakdown: candidate.breakdown,
    fillCount,
  });
  const pct = matchScorePercent(assessment.score);
  const tone = confidenceTone(assessment.band);
  const chips = assessment.reasons;
  const hasPrice = candidate.defaultUnitPrice != null;
  const resolvedPriceStatus =
    priceStatus ?? (hasPrice ? "available" : "not_found");
  const priceLabel = hasPrice
    ? `Giá: ${formatMoney(candidate.defaultUnitPrice, candidate.currency)}`
    : resolvedPriceStatus === "unchecked"
      ? "Giá: Chưa kiểm tra"
      : "Giá: Chưa thấy giá công khai";

  return (
    <div
      className={`group relative flex w-full min-w-0 cursor-pointer flex-col gap-1.5 rounded-[var(--radius-panel)] border px-2.5 py-2 text-left transition-colors duration-150 motion-reduce:transition-none ${
        isSelected
          ? "border-brand bg-brand/[0.06] ring-brand/20 ring-1"
          : "border-line bg-surface-1 hover:border-line-strong hover:bg-surface-2"
      }`}
    >
      <button
        type="button"
        aria-label={`Chọn sản phẩm ${candidate.name}`}
        aria-pressed={isSelected}
        aria-keyshortcuts={
          hotkeyIndex && hotkeyIndex <= 9 ? String(hotkeyIndex) : undefined
        }
        onClick={onChoose}
        className="focus-visible:ring-ring absolute inset-0 z-10 cursor-pointer rounded-[var(--radius-panel)] focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
      />
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        <span className="text-ink-3 text-xs font-semibold">
          Danh mục vật tư
        </span>
        {isRecommended && assessment.band != null ? (
          <span className="text-good inline-flex items-center gap-1 text-xs font-semibold">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            Gợi ý tốt nhất
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          <span
            className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-semibold tabular-nums ${tone.badge}`}
            aria-label={`Mức khớp ${pct}%`}
          >
            Mức khớp {pct}%
          </span>
          {isSelected ? (
            <CheckCircle2
              className="text-brand h-4 w-4 shrink-0"
              aria-label="Đã chọn"
            />
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

      <div className="flex min-w-0 gap-2">
        <div className="border-line bg-surface-2 relative h-12 w-12 shrink-0 overflow-hidden rounded border">
          {candidate.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={candidate.imageUrl}
              alt=""
              width={48}
              height={48}
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
          <p className="text-ink-1 line-clamp-2 text-sm leading-5 font-semibold text-pretty">
            {candidate.name}
          </p>
          <p className="mt-0.5 truncate text-xs text-slate-700">
            {candidate.code ? `${candidate.code} · ` : ""}
            {candidate.manufacturer ?? "NSX —"}
            {candidate.originCountry ? ` · ${candidate.originCountry}` : ""}
          </p>
          <p className="mt-0.5 text-xs tabular-nums">
            {candidate.unit ? (
              <span className="font-semibold text-slate-700">
                {candidate.unit} ·{" "}
              </span>
            ) : null}
            <span
              className={
                hasPrice
                  ? "font-bold text-amber-800"
                  : "font-medium text-slate-500 italic"
              }
            >
              {priceLabel}
            </span>
          </p>
        </div>
      </div>

      {chips.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {chips.slice(0, 2).map((chip) => (
            <span
              key={chip}
              className="rounded border border-slate-400 bg-slate-50 px-1.5 py-0.5 text-xs font-medium text-slate-600"
            >
              {chip}
            </span>
          ))}
          {chips.length > 2 ? (
            <span className="bg-surface-3 text-ink-3 rounded px-1.5 py-0.5 text-xs font-medium">
              +{chips.length - 2}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="border-line mt-auto flex items-center justify-between gap-2 border-t pt-1.5">
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
            className="text-brand focus-visible:ring-ring relative z-20 inline-flex min-h-10 items-center gap-1 text-xs font-semibold hover:underline focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            <ExternalLink className="h-3 w-3" aria-hidden />
            Nguồn
          </a>
        ) : null}
      </div>
    </div>
  );
}
