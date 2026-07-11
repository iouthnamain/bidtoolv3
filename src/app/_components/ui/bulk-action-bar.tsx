"use client";

import type { ReactNode } from "react";
import { Button } from "./button";

interface BulkActionBarProps {
  count: number;
  onClear: () => void;
  children: ReactNode;
  tone?: "default" | "profile";
}

export function BulkActionBar({
  count,
  onClear,
  children,
  tone = "default",
}: BulkActionBarProps) {
  if (count === 0) return null;

  return (
    <div
      className={`flex flex-wrap items-center gap-2 border px-3 py-2 text-sm ${
        tone === "profile"
          ? "border-line bg-surface-2 rounded-[var(--radius-panel)]"
          : "rounded border-blue-200 bg-blue-50"
      }`}
    >
      <span
        className={`font-semibold ${tone === "profile" ? "text-ink-1" : "text-blue-800"}`}
      >
        {count} mục đã chọn
      </span>
      <span
        className={`mx-1 h-4 w-px ${tone === "profile" ? "bg-line-strong" : "bg-blue-200"}`}
        aria-hidden
      />
      {children}
      <Button variant="ghost" size="sm" onClick={onClear}>
        Bỏ chọn
      </Button>
    </div>
  );
}
