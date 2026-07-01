"use client";

import Link from "next/link";
import { BellPlus, ExternalLink, Eye } from "lucide-react";

import { Button } from "~/app/_components/ui";
import { type api } from "~/trpc/react";

import type { SearchItem } from "./search-types";
import { detailHrefForItem, isPackageItem } from "./result-action-links";

export {
  detailHrefForItem,
  isPackageItem,
  primaryLinkForItem,
  primaryLinkOpensExternally,
  toSavePayload,
} from "./result-action-links";

export function ResultActions({
  item,
  addWatchlist,
  compact = false,
}: {
  item: SearchItem;
  addWatchlist: ReturnType<typeof api.watchlist.addItem.useMutation>;
  compact?: boolean;
}) {
  if (compact) {
    const iconButtonClass =
      "inline-flex h-8 w-8 items-center justify-center rounded border border-slate-500 bg-white text-slate-600 shadow-[var(--shadow-flat)] transition-colors duration-0 hover:border-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60";

    return (
      <div className="flex items-center gap-1.5">
        {!isPackageItem(item) ? (
          <Link
            href={detailHrefForItem(item)}
            title="Xem chi tiết"
            aria-label="Xem chi tiết"
            className={iconButtonClass}
          >
            <Eye className="h-4 w-4" aria-hidden />
          </Link>
        ) : null}
        <a
          href={item.sourceUrl}
          target="_blank"
          rel="noreferrer"
          title="Mở trang nguồn"
          aria-label="Mở trang nguồn"
          className={iconButtonClass}
        >
          <ExternalLink className="h-4 w-4" aria-hidden />
        </a>
        <button
          type="button"
          title="Theo dõi"
          aria-label="Theo dõi"
          disabled={addWatchlist.isPending}
          className={iconButtonClass}
          onClick={() =>
            addWatchlist.mutate({
              type: item.entityType,
              refKey: item.externalId,
              label: item.title,
            })
          }
        >
          <BellPlus className="h-4 w-4" aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-w-[180px] flex-wrap gap-1.5">
      {!isPackageItem(item) ? (
        <Link
          href={detailHrefForItem(item)}
          className="inline-flex items-center gap-1 rounded border border-slate-500 bg-white px-1.5 py-1 text-xs font-semibold whitespace-nowrap shadow-[var(--shadow-flat)] transition-colors duration-0 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 focus-visible:outline-none"
        >
          <Eye className="h-3.5 w-3.5" aria-hidden />
          Chi tiết
        </Link>
      ) : null}
      <a
        href={item.sourceUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 rounded border border-slate-500 bg-white px-1.5 py-1 text-xs font-semibold whitespace-nowrap shadow-[var(--shadow-flat)] transition-colors duration-0 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 focus-visible:outline-none"
      >
        <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        Nguồn
      </a>
      <Button
        variant="secondary"
        size="sm"
        className="px-1.5 py-1"
        leftIcon={<BellPlus className="h-3.5 w-3.5" />}
        onClick={() =>
          addWatchlist.mutate({
            type: item.entityType,
            refKey: item.externalId,
            label: item.title,
          })
        }
      >
        Theo dõi
      </Button>
    </div>
  );
}
