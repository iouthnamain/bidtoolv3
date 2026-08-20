"use client";

import { RotateCcw } from "lucide-react";

import {
  ProfileScrapedProductPicker,
  type ProfileScrapedProductPickerItem,
} from "~/app/_components/material-profiles/profile-scraped-product-picker";
import { ProfileScrapeProgress } from "~/app/_components/material-profiles/profile-scrape-progress";
import { Button } from "~/app/_components/ui";

type Job = Parameters<typeof ProfileScrapeProgress>[0]["job"];
type Run = Parameters<typeof ProfileScrapeProgress>[0]["run"];

export function ProfileScrapeInlineLayer({
  job,
  run,
  products,
  canSelectUnretained,
  onCancel,
  onRetry,
  onRescrape,
  onSelectProduct,
  onRemoveProduct,
  cancelling,
  retrying,
  rescraping,
  pendingProductKey,
  removingProductKey,
}: {
  job?: Job;
  run?: Run | null;
  products: ProfileScrapedProductPickerItem[];
  canSelectUnretained: boolean;
  onCancel?: () => void;
  onRetry?: () => void;
  onRescrape?: () => void;
  onSelectProduct: (product: ProfileScrapedProductPickerItem) => void;
  onRemoveProduct: (productKey: string) => void;
  cancelling?: boolean;
  retrying?: boolean;
  rescraping?: boolean;
  pendingProductKey: string | null;
  removingProductKey: string | null;
}) {
  return (
    <div className="grid gap-3">
      {job ? (
        <ProfileScrapeProgress
          job={job}
          run={run}
          onCancel={onCancel}
          onRetry={onRetry}
          cancelling={cancelling}
          retrying={retrying}
        />
      ) : null}
      {products.length > 0 ? (
        <ProfileScrapedProductPicker
          products={products}
          canSelectUnretained={canSelectUnretained}
          onSelect={onSelectProduct}
          onRemove={onRemoveProduct}
          pendingProductKey={pendingProductKey}
          removingProductKey={removingProductKey}
        />
      ) : null}
      {onRescrape ? (
        <Button
          variant="scrape"
          size="sm"
          className="w-fit"
          onClick={onRescrape}
          isLoading={rescraping}
          leftIcon={<RotateCcw aria-hidden />}
        >
          Scrape lại
        </Button>
      ) : null}
    </div>
  );
}
