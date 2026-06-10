"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

import { STORAGE_KEYS } from "~/lib/storage-keys";

const DISMISSED_KEY = STORAGE_KEYS.mobileBannerDismissed;

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
    <div className="flex items-start gap-3 border-b border-sky-200 bg-sky-50 px-4 py-2.5 text-xs text-sky-900 lg:hidden">
      <span className="flex-1">
        Màn hình nhỏ: bảng có thể vuốt ngang, menu nằm ở góc trên.
      </span>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Đóng thông báo"
        className="shrink-0 rounded p-0.5 hover:bg-sky-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 focus-visible:outline-none"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
