"use client";

import type { ReactNode } from "react";
import { Button } from "./button";

interface BulkActionBarProps {
  count: number;
  onClear: () => void;
  children: ReactNode;
}

export function BulkActionBar({
  count,
  onClear,
  children,
}: BulkActionBarProps) {
  if (count === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm">
      <span className="font-semibold text-sky-800">{count} mục đã chọn</span>
      <span className="mx-1 h-4 w-px bg-sky-200" aria-hidden />
      {children}
      <Button variant="ghost" size="sm" onClick={onClear}>
        Bỏ chọn
      </Button>
    </div>
  );
}
