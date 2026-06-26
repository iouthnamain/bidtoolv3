"use client";

import { progressWidth } from "~/app/_components/materials/scrape-job-utils";

export function ScrapeProgressBar({
  label,
  percent,
  active,
  tone,
}: {
  label: string;
  percent: number | null;
  active: boolean;
  tone: "blue" | "emerald";
}) {
  const colorClass = tone === "blue" ? "bg-blue-600" : "bg-emerald-600";
  const animated = percent == null && active;

  return (
    <div
      className="mt-2 h-2 overflow-hidden rounded-full bg-white"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent ?? undefined}
      aria-valuetext={percent == null ? "Đang chạy" : `${percent}%`}
    >
      <div
        className={
          animated
            ? `h-full animate-pulse rounded-full ${colorClass}`
            : `h-full rounded-full ${colorClass}`
        }
        style={{ width: progressWidth(percent, active) }}
      />
    </div>
  );
}
