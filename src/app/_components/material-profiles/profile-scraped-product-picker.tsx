"use client";

import { ExternalLink, ImageOff } from "lucide-react";

import { Button } from "~/app/_components/ui";

function text(record: Record<string, unknown>, key: string) {
  return typeof record[key] === "string" ? record[key] : "";
}

export function ProfileScrapedProductPicker({
  products,
  onSelect,
  pendingIndex,
}: {
  products: Record<string, unknown>[];
  onSelect: (index: number) => void;
  pendingIndex: number | null;
}) {
  return (
    <fieldset className="border-line grid gap-2 rounded-[var(--radius-panel)] border p-3">
      <legend className="section-title px-1">Chọn sản phẩm đã scrape</legend>
      <p className="text-ink-2 text-sm">
        Nguồn có nhiều sản phẩm gần giống nhau. Chọn đúng sản phẩm để đưa vào
        bảng so sánh.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {products.slice(0, 8).map((product, index) => {
          const name = text(product, "name") || `Sản phẩm ${index + 1}`;
          const imageUrl = text(product, "imageUrl");
          const sourceUrl = text(product, "sourceUrl");
          const model = text(product, "model") || text(product, "sku");
          const price = text(product, "priceText");
          return (
            <div
              key={`${sourceUrl}-${index}`}
              className="border-line bg-surface-1 grid min-w-0 grid-cols-[3.5rem_minmax(0,1fr)] gap-2 rounded-[var(--radius-panel)] border p-2"
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
                <p className="text-ink-1 line-clamp-2 text-sm font-semibold">
                  {name}
                </p>
                {model ? <p className="text-ink-3 text-xs">{model}</p> : null}
                {price ? (
                  <p className="text-warning text-xs font-semibold">{price}</p>
                ) : null}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button
                    variant="scrape"
                    size="sm"
                    onClick={() => onSelect(index)}
                    isLoading={pendingIndex === index}
                    disabled={pendingIndex != null}
                  >
                    Chọn sản phẩm này
                  </Button>
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
