"use client";

import { ExternalLink, ImageOff } from "lucide-react";

import { Button } from "~/app/_components/ui";
import type { ProfileScrapedProduct } from "~/lib/materials/profile-scrape-types";

export type ProfileScrapedProductPickerItem = {
  productKey: string;
  product: ProfileScrapedProduct;
  retained: boolean;
  active: boolean;
  productIndex?: number;
};

export function ProfileScrapedProductPicker({
  products,
  onSelect,
  onRemove,
  pendingProductKey,
  removingProductKey,
}: {
  products: ProfileScrapedProductPickerItem[];
  onSelect: (product: ProfileScrapedProductPickerItem) => void;
  onRemove: (productKey: string) => void;
  pendingProductKey: string | null;
  removingProductKey: string | null;
}) {
  return (
    <fieldset className="border-line grid gap-2 rounded-[var(--radius-panel)] border p-3">
      <legend className="section-title px-1">Sản phẩm đã scrape</legend>
      <p className="text-ink-2 text-sm">
        Có thể giữ nhiều sản phẩm và mở lại từng bản nháp để so sánh.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {products.slice(0, 8).map((item, index) => {
          const { product } = item;
          const name = product.name.trim()
            ? product.name
            : `Sản phẩm ${index + 1}`;
          const imageUrl = product.imageUrl?.trim() ?? "";
          const sourceUrl = product.sourceUrl;
          const model = product.model ?? product.sku;
          return (
            <div
              key={item.productKey}
              role="group"
              aria-label={`Sản phẩm ${name}`}
              className={`border-line bg-surface-1 grid min-w-0 grid-cols-[3.5rem_minmax(0,1fr)] gap-2 rounded-[var(--radius-panel)] border p-2 ${item.active ? "ring-brand ring-2" : ""}`}
            >
              <div className="bg-surface-2 border-line flex size-14 items-center justify-center overflow-hidden rounded border">
                {imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- arbitrary shop hosts are not safe for next/image configuration.
                  <img
                    src={imageUrl}
                    alt={`Ảnh ${name}`}
                    width={56}
                    height={56}
                    className="size-full object-cover"
                  />
                ) : (
                  <ImageOff aria-hidden className="text-ink-3" />
                )}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-start justify-between gap-1">
                  <p className="text-ink-1 line-clamp-2 text-sm font-semibold">
                    {name}
                  </p>
                  {item.active ? (
                    <span className="text-brand text-xs font-semibold">
                      Đang xem
                    </span>
                  ) : item.retained ? (
                    <span className="text-good text-xs font-semibold">
                      Đã chọn
                    </span>
                  ) : null}
                </div>
                {model ? <p className="text-ink-3 text-xs">{model}</p> : null}
                {product.priceText ? (
                  <p className="text-warning text-xs font-semibold">
                    {product.priceText}
                  </p>
                ) : null}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {!item.active ? (
                    <Button
                      variant="scrape"
                      size="sm"
                      onClick={() => onSelect(item)}
                      isLoading={pendingProductKey === item.productKey}
                      disabled={
                        pendingProductKey != null || removingProductKey != null
                      }
                    >
                      {item.retained ? "Xem kết quả" : "Chọn sản phẩm này"}
                    </Button>
                  ) : null}
                  {item.retained ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onRemove(item.productKey)}
                      isLoading={removingProductKey === item.productKey}
                      disabled={
                        pendingProductKey != null || removingProductKey != null
                      }
                    >
                      Bỏ
                    </Button>
                  ) : null}
                  {sourceUrl ? (
                    <a
                      href={sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brand focus-visible:ring-ring inline-flex min-h-10 items-center gap-1 rounded text-xs font-semibold hover:underline focus-visible:ring-2 focus-visible:outline-none"
                    >
                      <ExternalLink aria-hidden /> Nguồn
                    </a>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
