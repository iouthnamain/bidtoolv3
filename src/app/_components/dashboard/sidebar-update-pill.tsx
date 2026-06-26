"use client";

import { useEffect, useState } from "react";
import { Download, RotateCw, X } from "lucide-react";

import { useToast } from "~/app/_components/ui/toast";
import {
  getDesktopUpdateActionError,
  getDesktopUpdateInstallConfirmationMessage,
  getDesktopUpdateNoticeKey,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
  shouldShowDesktopUpdateNotice,
} from "~/lib/desktop-update";
import {
  useDesktopUpdateState,
} from "~/lib/desktop-update-react-query";
import { STORAGE_KEYS } from "~/lib/storage-keys";

const DESKTOP_UPDATE_DISMISSED_KEY = STORAGE_KEYS.desktopUpdateDismissed;

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

export function SidebarUpdatePill({ collapsed }: { collapsed: boolean }) {
  const { error, success } = useToast();
  const { data: updateState } = useDesktopUpdateState();
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const noticeKey = getDesktopUpdateNoticeKey(updateState ?? null);

  useEffect(() => {
    setDismissedKey(readLocalStorageValue(DESKTOP_UPDATE_DISMISSED_KEY));
    const handleDismissed = () => {
      setDismissedKey(readLocalStorageValue(DESKTOP_UPDATE_DISMISSED_KEY));
    };
    window.addEventListener("bidtool:desktop-update-dismissed", handleDismissed);
    return () => {
      window.removeEventListener(
        "bidtool:desktop-update-dismissed",
        handleDismissed,
      );
    };
  }, []);

  if (
    !shouldShowDesktopUpdateNotice(updateState ?? null) ||
    !noticeKey ||
    dismissedKey === noticeKey
  ) {
    return null;
  }

  const bridge = window.bidtoolDesktop;
  const action = resolveDesktopUpdateButtonAction(updateState ?? null);
  const disabled = isDesktopUpdateButtonDisabled(updateState ?? null);
  const version =
    updateState?.downloadedVersion ?? updateState?.availableVersion ?? null;

  const dismiss = () => {
    writeLocalStorageValue(DESKTOP_UPDATE_DISMISSED_KEY, noticeKey);
    window.dispatchEvent(new Event("bidtool:desktop-update-dismissed"));
    setDismissedKey(noticeKey);
  };

  const handleAction = async () => {
    if (!bridge || !updateState || disabled || action === "none") {
      return;
    }

    if (action === "download") {
      const result = await bridge.downloadUpdate();
      const actionError = getDesktopUpdateActionError(result);
      if (actionError) {
        error(actionError);
      } else if (result.completed) {
        success("Đã tải bản cập nhật. Khởi động lại để cài đặt.");
      }
      return;
    }

    if (action === "install") {
      const confirmed = window.confirm(
        getDesktopUpdateInstallConfirmationMessage(version),
      );
      if (!confirmed) {
        return;
      }

      const result = await bridge.installUpdate();
      const actionError = getDesktopUpdateActionError(result);
      if (actionError) {
        error(actionError);
      }
    }
  };

  const label =
    action === "install"
      ? collapsed
        ? "Cài"
        : "Khởi động lại"
      : collapsed
        ? "Tải"
        : "Tải cập nhật";

  return (
    <div
      className={`rounded border border-blue-200 bg-blue-50 text-blue-950 ${
        collapsed ? "px-1.5 py-2" : "px-3 py-2.5"
      }`}
    >
      <div
        className={`flex ${collapsed ? "flex-col items-center gap-1.5" : "items-center justify-between gap-2"}`}
      >
        {!collapsed ? (
          <p className="min-w-0 text-xs font-semibold">
            {action === "install"
              ? `Bản ${version ?? ""} đã tải xong`
              : `Có bản cập nhật ${version ?? ""}`}
          </p>
        ) : null}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void handleAction()}
            disabled={disabled || action === "none"}
            className="inline-flex h-7 items-center gap-1 rounded bg-blue-800 px-2 text-xs font-bold text-white hover:bg-blue-900 disabled:opacity-60"
          >
            {action === "install" ? (
              <RotateCw className="h-3 w-3" />
            ) : (
              <Download className="h-3 w-3" />
            )}
            {label}
          </button>
          {action === "download" ? (
            <button
              type="button"
              onClick={dismiss}
              aria-label="Ẩn thông báo cập nhật desktop"
              className="flex h-7 w-7 items-center justify-center rounded text-blue-800 hover:bg-blue-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
