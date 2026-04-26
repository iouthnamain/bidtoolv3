"use client";

import { useEffect, useState } from "react";

const DISMISSED_KEY = "bidtool:mobile-banner-dismissed";

export function MobileBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (window.localStorage.getItem(DISMISSED_KEY) !== "1") {
      setVisible(true);
    }
  }, []);

  function dismiss() {
    window.localStorage.setItem(DISMISSED_KEY, "1");
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="flex items-start gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900 md:hidden">
      <span className="flex-1">
        Tool tối ưu cho màn hình ≥ 1024px. Một số bảng có thể cuộn ngang.
      </span>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Đóng thông báo"
        className="shrink-0 rounded p-0.5 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-1"
      >
        ×
      </button>
    </div>
  );
}
