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
    <div className="border-b border-amber-200 bg-amber-50 py-2.5 text-amber-950">
      <div className="dashboard-content flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-800"
            aria-hidden
          >
            <ArrowUpCircle className="h-4 w-4" />
          </span>
          <p className="min-w-0 text-xs font-semibold">
            Có bản cập nhật on-prem {versionStatus.latest}. Bạn đang chạy{" "}
            {versionStatus.current}
            {versionStatus.buildMetadata
              ? ` (${versionStatus.buildMetadata})`
              : ""}
            .
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {versionStatus.updateCommand ? (
            <button
              type="button"
              onClick={() => void copyCommand()}
              className="focus-visible:ring-ring inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-panel)] bg-amber-800 px-3 text-xs font-bold text-white transition-colors duration-150 hover:bg-amber-900 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-amber-50 focus-visible:outline-none motion-reduce:transition-none"
            >
              <Copy className="h-3.5 w-3.5" />
              Sao chép lệnh cập nhật
            </button>
          ) : null}
          <button
            type="button"
            onClick={dismiss}
            aria-label="Ẩn thông báo cập nhật on-prem"
            className="focus-visible:ring-ring flex h-11 w-11 items-center justify-center rounded-[var(--radius-panel)] text-amber-800 transition-colors duration-150 hover:bg-amber-100 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-amber-50 focus-visible:outline-none motion-reduce:transition-none"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
