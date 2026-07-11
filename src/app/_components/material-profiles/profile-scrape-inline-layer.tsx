"use client";

import { ProfileScrapedProductPicker } from "~/app/_components/material-profiles/profile-scraped-product-picker";
import { ProfileScrapeProgress } from "~/app/_components/material-profiles/profile-scrape-progress";

type Job = Parameters<typeof ProfileScrapeProgress>[0]["job"];
type Run = Parameters<typeof ProfileScrapeProgress>[0]["run"] & {
  scrapedProductCandidatesJson?: Record<string, unknown>[];
};

export function ProfileScrapeInlineLayer({
  job,
  run,
  onCancel,
  onRetry,
  onSelectProduct,
  cancelling,
  retrying,
  pendingProductIndex,
}: {
  job: Job;
  run?: Run | null;
  onCancel?: () => void;
  onRetry?: () => void;
  onSelectProduct?: (index: number) => void;
  cancelling?: boolean;
  retrying?: boolean;
  pendingProductIndex?: number | null;
}) {
  return (
    <div className="grid gap-3">
      <ProfileScrapeProgress
        job={job}
        run={run}
        onCancel={onCancel}
        onRetry={onRetry}
        cancelling={cancelling}
        retrying={retrying}
      />
      {run?.status === "awaiting_product_selection" &&
      run.scrapedProductCandidatesJson?.length &&
      onSelectProduct ? (
        <ProfileScrapedProductPicker
          products={run.scrapedProductCandidatesJson}
          onSelect={onSelectProduct}
          pendingIndex={pendingProductIndex ?? null}
        />
      ) : null}
    </div>
  );
}
