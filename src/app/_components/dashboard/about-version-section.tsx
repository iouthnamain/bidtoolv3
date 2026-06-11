"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  ArrowUpCircle,
  Copy,
  Download,
  Info,
  RefreshCw,
  RotateCw,
} from "lucide-react";

import { SettingsSectionHeader } from "~/app/_components/dashboard/settings-section-header";
import { Button } from "~/app/_components/ui";
import { SkeletonKpi } from "~/app/_components/ui/skeleton";
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
import {
  getApplyUpdateButtonLabel,
  getOnPremApplyConfirmationMessage,
  getOnPremCopyCommandConfirmationMessage,
  resolveApplyUpdateAction,
  shouldShowApplyUpdateButton,
} from "~/lib/update-apply";
import { api } from "~/trpc/react";

function formatBuildLabel(
  version: string,
  buildMetadata: string | null | undefined,
) {
  return buildMetadata ? `${version} (${buildMetadata})` : version;
}

function formatSurfaceLabel(surface: string) {
  switch (surface) {
    case "web":
      return "Web (Vercel)";
    case "onprem":
      return "On-prem (Docker)";
    case "desktop-bundled":
      return "Desktop (bundled)";
    default:
      return surface;
  }
}

function getUpdateStatusBadge(updateAvailable: boolean) {
  return updateAvailable
    ? { label: "Có bản mới", tone: "warning" as const }
    : { label: "Đã cập nhật", tone: "success" as const };
}

export function AboutVersionSection() {
  const { error, success } = useToast();
  const queryClient = useQueryClient();
  const [isDesktop, setIsDesktop] = useState(false);
  const utils = api.useUtils();
  const { data: versionStatus, isLoading: versionLoading, refetch } =
    api.version.getStatus.useQuery(undefined, {
      staleTime: 60_000,
      refetchInterval: 5 * 60_000,
    });
  const { data: desktopUpdateState } = useDesktopUpdateState();
  const applyOnPremUpdate = api.version.applyOnPremUpdate.useMutation({
    onSuccess: async (result) => {
      success(result.message);
      await utils.version.getStatus.invalidate();
    },
    onError: (mutationError) => {
      error(mutationError.message);
    },
  });

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

  const versionContext = versionStatus
    ? {
        surface: versionStatus.surface,
        updateAvailable: versionStatus.updateAvailable,
        latest: versionStatus.latest,
        canApplyInApp: versionStatus.canApplyInApp,
      }
    : null;

  const applyAction =
    versionContext &&
    resolveApplyUpdateAction({
      version: versionContext,
      desktopState: desktopUpdateState ?? null,
      isDesktop,
    });

  const showApplyButton =
    versionContext &&
    shouldShowApplyUpdateButton({
      version: versionContext,
      desktopState: desktopUpdateState ?? null,
      isDesktop,
    });

  const applyDisabled =
    applyOnPremUpdate.isPending ||
    (applyAction === "desktop-check" ||
    applyAction === "desktop-download" ||
    applyAction === "desktop-install"
      ? desktopAction === "none"
        ? !canCheckForDesktopUpdate(desktopUpdateState ?? null)
        : desktopDisabled
      : false);

  const handleApplyUpdate = async () => {
    if (!versionStatus || !applyAction || applyAction === "none") {
      return;
    }

    if (
      applyAction === "desktop-check" ||
      applyAction === "desktop-download" ||
      applyAction === "desktop-install"
    ) {
      if (desktopAction === "none") {
        await handleDesktopCheck();
        return;
      }
      await handleDesktopAction();
      return;
    }

    if (applyAction === "refresh") {
      await refetch();
      window.location.reload();
      return;
    }

    if (applyAction === "copy-onprem-command") {
      if (!window.confirm(getOnPremCopyCommandConfirmationMessage())) {
        return;
      }
      await copyUpdateCommand();
      return;
    }

    if (applyAction === "run-onprem") {
      if (
        !window.confirm(
          getOnPremApplyConfirmationMessage(versionStatus.latest),
        )
      ) {
        return;
      }

      await applyOnPremUpdate.mutateAsync({
        version: versionStatus.latest ?? undefined,
      });
    }
  };

  const applyDescription = (() => {
    switch (applyAction) {
      case "run-onprem":
        return "Chạy cập nhật on-prem trực tiếp. Stack Docker sẽ pull image mới và khởi động lại.";
      case "copy-onprem-command":
        return "Sao chép lệnh và chạy trên máy chủ hosting Docker stack.";
      case "refresh":
        return "Tải lại để nhận bản web mới nhất từ pipeline phát hành.";
      case "desktop-download":
        return "Tải bản cập nhật desktop từ GitHub Releases.";
      case "desktop-install":
        return "Cài bản đã tải và khởi động lại ứng dụng.";
      case "desktop-check":
        return "Kiểm tra bản cập nhật desktop mới từ GitHub Releases.";
      default:
        return null;
    }
  })();

  return (
    <section id="about-version" className="panel scroll-mt-6 overflow-hidden">
      <SettingsSectionHeader
        eyebrow="Cập nhật"
        title="Quản lý phiên bản"
        description="Kiểm tra bản phát hành mới, áp dụng cập nhật và xem ghi chú phát hành."
        icon={Info}
        iconClassName="bg-violet-50 text-violet-700"
        badge={
          versionStatus
            ? getUpdateStatusBadge(versionStatus.updateAvailable)
            : undefined
        }
        action={
          <Button
            type="button"
            variant="secondary"
            size="sm"
            leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
            disabled={versionLoading}
            onClick={() => void refetch()}
          >
            Làm mới
          </Button>
        }
      />

      <div className="space-y-4 p-5">
        {versionLoading || !versionStatus ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <SkeletonKpi />
            <SkeletonKpi />
            <SkeletonKpi />
            <SkeletonKpi />
          </div>
        ) : (
          <dl className="grid gap-3 sm:grid-cols-2">
            {[
              {
                label: "Phiên bản hiện tại",
                value: formatBuildLabel(
                  versionStatus.current,
                  versionStatus.buildMetadata,
                ),
              },
              {
                label: "Môi trường",
                value: formatSurfaceLabel(versionStatus.surface),
              },
              {
                label: "Bản mới nhất",
                value: versionStatus.latest
                  ? formatBuildLabel(
                      versionStatus.latest,
                      versionStatus.latestBuildMetadata,
                    )
                  : "Không xác định",
              },
              {
                label: "Trạng thái",
                value: versionStatus.updateAvailable
                  ? "Có bản cập nhật mới"
                  : "Đã cập nhật",
              },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-3"
              >
                <dt className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  {item.label}
                </dt>
                <dd className="mt-1 text-sm font-bold text-slate-950">
                  {item.value}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {showApplyButton && applyAction ? (
          <div className="rounded-lg border border-sky-200 bg-gradient-to-br from-sky-50 to-white px-4 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold tracking-wide text-sky-700 uppercase">
                  Hành động cập nhật
                </p>
                {applyDescription ? (
                  <p className="mt-2 text-sm leading-6 text-sky-950">
                    {applyDescription}
                  </p>
                ) : null}
                {versionStatus?.updateCommand &&
                (applyAction === "copy-onprem-command" ||
                  applyAction === "run-onprem") ? (
                  <code className="mt-3 block overflow-x-auto rounded-md border border-sky-200/80 bg-white/80 px-3 py-2 text-xs text-slate-800">
                    {versionStatus.updateCommand}
                  </code>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {versionStatus?.updateCommand &&
                applyAction === "copy-onprem-command" ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    leftIcon={<Copy className="h-3.5 w-3.5" />}
                    onClick={() => void copyUpdateCommand()}
                  >
                    Sao chép
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  leftIcon={
                    applyAction === "desktop-install" ? (
                      <RotateCw className="h-3.5 w-3.5" />
                    ) : applyAction === "desktop-download" ? (
                      <Download className="h-3.5 w-3.5" />
                    ) : applyAction === "refresh" ? (
                      <RefreshCw className="h-3.5 w-3.5" />
                    ) : (
                      <ArrowUpCircle className="h-3.5 w-3.5" />
                    )
                  }
                  isLoading={applyOnPremUpdate.isPending}
                  disabled={applyDisabled}
                  onClick={() => void handleApplyUpdate()}
                >
                  {getApplyUpdateButtonLabel(applyAction)}
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {versionStatus?.changelog ? (
          <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
            <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
              Ghi chú phát hành
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
              {versionStatus.changelog}
            </p>
          </div>
        ) : null}

        {isDesktop && desktopUpdateState?.currentVersion ? (
          <p className="text-xs text-slate-500">
            Desktop shell:{" "}
            <span className="font-semibold text-slate-700">
              {desktopUpdateState.currentVersion}
            </span>
          </p>
        ) : null}
      </div>
    </section>
  );
}
