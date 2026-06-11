"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Copy, Download, Info, RotateCw } from "lucide-react";

import { useToast } from "~/app/_components/ui/toast";
import {
  canCheckForDesktopUpdate,
  getDesktopUpdateActionError,
  getDesktopUpdateInstallConfirmationMessage,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
} from "~/lib/desktop-update";
import {
  setDesktopUpdateStateQueryData,
  useDesktopUpdateState,
} from "~/lib/desktop-update-react-query";
import { api } from "~/trpc/react";

function formatBuildLabel(
  version: string,
  buildMetadata: string | null | undefined,
) {
  return buildMetadata ? `${version} (${buildMetadata})` : version;
}

export function AboutVersionSection() {
  const { error, success } = useToast();
  const queryClient = useQueryClient();
  const [isDesktop, setIsDesktop] = useState(false);
  const { data: versionStatus, isLoading: versionLoading } =
    api.version.getStatus.useQuery(undefined, {
      staleTime: 60_000,
      refetchInterval: 5 * 60_000,
    });
  const { data: desktopUpdateState } = useDesktopUpdateState();

  useEffect(() => {
    setIsDesktop(!!window.bidtoolDesktop?.isDesktop);
  }, []);

  const desktopAction = resolveDesktopUpdateButtonAction(
    desktopUpdateState ?? null,
  );
  const desktopDisabled = isDesktopUpdateButtonDisabled(
    desktopUpdateState ?? null,
  );
  const desktopVersion =
    desktopUpdateState?.downloadedVersion ??
    desktopUpdateState?.availableVersion ??
    null;

  const copyUpdateCommand = async () => {
    if (!versionStatus?.updateCommand) {
      return;
    }

    try {
      await navigator.clipboard.writeText(versionStatus.updateCommand);
      success("Đã sao chép lệnh cập nhật.");
    } catch {
      success(versionStatus.updateCommand);
    }
  };

  const handleDesktopCheck = async () => {
    const bridge = window.bidtoolDesktop;
    if (!bridge || !canCheckForDesktopUpdate(desktopUpdateState ?? null)) {
      return;
    }

    const result = await bridge.checkForUpdate();
    setDesktopUpdateStateQueryData(queryClient, result.state);
    const actionError = getDesktopUpdateActionError(result);
    if (actionError) {
      error(actionError);
    } else if (result.checked && result.state.status === "up-to-date") {
      success("Desktop đã ở phiên bản mới nhất.");
    }
  };

  const handleDesktopAction = async () => {
    const bridge = window.bidtoolDesktop;
    if (!bridge || desktopDisabled || desktopAction === "none") {
      return;
    }

    if (desktopAction === "download") {
      const result = await bridge.downloadUpdate();
      setDesktopUpdateStateQueryData(queryClient, result.state);
      const actionError = getDesktopUpdateActionError(result);
      if (actionError) {
        error(actionError);
      } else if (result.completed) {
        success("Đã tải bản cập nhật desktop.");
      }
      return;
    }

    if (desktopAction === "install") {
      const confirmed = window.confirm(
        getDesktopUpdateInstallConfirmationMessage(desktopVersion),
      );
      if (!confirmed) {
        return;
      }

      const result = await bridge.installUpdate();
      setDesktopUpdateStateQueryData(queryClient, result.state);
      const actionError = getDesktopUpdateActionError(result);
      if (actionError) {
        error(actionError);
      }
    }
  };

  const desktopButtonLabel =
    desktopAction === "install"
      ? "Khởi động lại"
      : desktopAction === "download"
        ? "Tải cập nhật"
        : canCheckForDesktopUpdate(desktopUpdateState ?? null)
          ? "Kiểm tra cập nhật"
          : desktopUpdateState?.status === "checking"
            ? "Đang kiểm tra"
            : "Kiểm tra cập nhật";

  const handleDesktopButtonClick = () => {
    if (desktopAction === "none") {
      void handleDesktopCheck();
      return;
    }
    void handleDesktopAction();
  };

  return (
    <section id="about-version" className="panel scroll-mt-6 overflow-hidden">
      <div className="border-b border-slate-200 px-5 py-4">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-700">
            <Info className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="section-title">Phiên bản</p>
            <h2 className="mt-1 text-base font-bold text-slate-950">
              Trạng thái cập nhật hệ thống
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Theo dõi phiên bản đang chạy, bản phát hành mới nhất và lệnh cập
              nhật on-prem.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4 p-5">
        {versionLoading || !versionStatus ? (
          <p className="text-sm text-slate-500">Đang tải thông tin phiên bản…</p>
        ) : (
          <dl className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Phiên bản hiện tại
              </dt>
              <dd className="mt-1 text-sm font-bold text-slate-950">
                {formatBuildLabel(
                  versionStatus.current,
                  versionStatus.buildMetadata,
                )}
              </dd>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Môi trường
              </dt>
              <dd className="mt-1 text-sm font-bold text-slate-950">
                {versionStatus.surface}
              </dd>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Bản mới nhất
              </dt>
              <dd className="mt-1 text-sm font-bold text-slate-950">
                {versionStatus.latest
                  ? formatBuildLabel(
                      versionStatus.latest,
                      versionStatus.latestBuildMetadata,
                    )
                  : "Không xác định"}
              </dd>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Trạng thái
              </dt>
              <dd className="mt-1 text-sm font-bold text-slate-950">
                {versionStatus.updateAvailable
                  ? "Có bản cập nhật mới"
                  : "Đã cập nhật"}
              </dd>
            </div>
          </dl>
        )}

        {versionStatus?.changelog ? (
          <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Ghi chú phát hành
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
              {versionStatus.changelog}
            </p>
          </div>
        ) : null}

        {versionStatus?.surface === "web" ? (
          <p className="text-sm text-slate-600">
            Bản web được quản lý bởi pipeline phát hành thống nhất. Production
            chỉ được promote từ tag `v*`.
          </p>
        ) : null}

        {versionStatus?.updateCommand ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
              Lệnh cập nhật on-prem
            </p>
            <code className="mt-2 block overflow-x-auto text-sm text-amber-950">
              {versionStatus.updateCommand}
            </code>
            <button
              type="button"
              onClick={() => void copyUpdateCommand()}
              className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md bg-amber-800 px-2.5 text-xs font-bold text-white hover:bg-amber-900"
            >
              <Copy className="h-3.5 w-3.5" />
              Sao chép lệnh
            </button>
          </div>
        ) : null}

        {isDesktop ? (
          <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">
              Cập nhật desktop
            </p>
            <p className="mt-2 text-sm text-sky-950">
              {desktopUpdateState?.currentVersion
                ? `Desktop shell: ${desktopUpdateState.currentVersion}`
                : "Desktop shell đang kiểm tra phiên bản."}
            </p>
            <button
              type="button"
              onClick={handleDesktopButtonClick}
              disabled={
                desktopAction === "none"
                  ? !canCheckForDesktopUpdate(desktopUpdateState ?? null)
                  : desktopDisabled
              }
              className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md bg-sky-800 px-2.5 text-xs font-bold text-white hover:bg-sky-900 disabled:opacity-60"
            >
              {desktopAction === "install" ? (
                <RotateCw className="h-3.5 w-3.5" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              {desktopButtonLabel}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
