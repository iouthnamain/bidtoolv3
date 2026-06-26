"use client";

import { useEffect, useState } from "react";
import { ArrowUpCircle, Copy, X } from "lucide-react";

import { useToast } from "~/app/_components/ui/toast";
import {
  getAdminUpdateNoticeKey,
  shouldShowAdminUpdateBanner,
} from "~/lib/desktop-update";
import { STORAGE_KEYS } from "~/lib/storage-keys";
import { api } from "~/trpc/react";

const ADMIN_UPDATE_DISMISSED_KEY = STORAGE_KEYS.adminUpdateDismissed;

function readLocalStorageValue(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorageValue(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage failures in restricted contexts.
  }
}

export function AdminUpdateBanner() {
  const { success } = useToast();
  const { data: versionStatus } = api.version.getStatus.useQuery(undefined, {
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  useEffect(() => {
    setDismissedKey(readLocalStorageValue(ADMIN_UPDATE_DISMISSED_KEY));
  }, []);

  if (
    !versionStatus ||
    !shouldShowAdminUpdateBanner({
      surface: versionStatus.surface,
      updateAvailable: versionStatus.updateAvailable,
      latest: versionStatus.latest,
    })
  ) {
    return null;
  }

  const noticeKey = getAdminUpdateNoticeKey(
    versionStatus.current,
    versionStatus.latest,
  );
  if (!noticeKey || dismissedKey === noticeKey) {
    return null;
  }

  const dismiss = () => {
    writeLocalStorageValue(ADMIN_UPDATE_DISMISSED_KEY, noticeKey);
    setDismissedKey(noticeKey);
  };

  const copyCommand = async () => {
    if (!versionStatus.updateCommand) {
      return;
    }

    try {
      await navigator.clipboard.writeText(versionStatus.updateCommand);
      success("Đã sao chép lệnh cập nhật.");
    } catch {
      success(versionStatus.updateCommand);
    }
  };

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-amber-950">
      <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700"
            aria-hidden
          >
            <ArrowUpCircle className="h-4 w-4" />
          </span>
          <p className="min-w-0 text-xs font-semibold">
            Có bản cập nhật on-prem {versionStatus.latest}. Bạn đang chạy{" "}
            {versionStatus.current}
            {versionStatus.buildMetadata ? ` (${versionStatus.buildMetadata})` : ""}.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {versionStatus.updateCommand ? (
            <button
              type="button"
              onClick={() => void copyCommand()}
              className="inline-flex h-8 items-center gap-1.5 rounded bg-amber-800 px-2.5 text-xs font-bold text-white transition-colors hover:bg-amber-900"
            >
              <Copy className="h-3.5 w-3.5" />
              Sao chép lệnh cập nhật
            </button>
          ) : null}
          <button
            type="button"
            onClick={dismiss}
            aria-label="Ẩn thông báo cập nhật on-prem"
            className="flex h-8 w-8 items-center justify-center rounded text-amber-800 transition-colors hover:bg-amber-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
