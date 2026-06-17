"use client";

import { Cloud, Monitor, Server } from "lucide-react";

import { Badge } from "~/app/_components/ui/badge";
import { SkeletonKpi } from "~/app/_components/ui/skeleton";
import { api } from "~/trpc/react";

function formatSurfaceLabel(surface: string) {
  switch (surface) {
    case "web":
      return "Web";
    case "onprem":
      return "On-prem";
    case "desktop-bundled":
      return "Desktop";
    default:
      return surface;
  }
}

function surfaceIcon(surface: string) {
  switch (surface) {
    case "web":
      return Cloud;
    case "onprem":
      return Server;
    case "desktop-bundled":
      return Monitor;
    default:
      return Server;
  }
}

function formatBuildLabel(
  version: string,
  buildMetadata: string | null | undefined,
) {
  return buildMetadata ? `${version} · ${buildMetadata}` : version;
}

export function SettingsStatusStrip() {
  const { data: versionStatus, isLoading } = api.version.getStatus.useQuery(
    undefined,
    {
      staleTime: 60_000,
      refetchInterval: 5 * 60_000,
    },
  );

  if (isLoading || !versionStatus) {
    return (
      <section
        id="settings-overview"
        className="scroll-mt-6 grid gap-3 sm:grid-cols-3"
        aria-label="Đang tải trạng thái cài đặt"
        aria-busy="true"
      >
        <SkeletonKpi />
        <SkeletonKpi />
        <SkeletonKpi />
      </section>
    );
  }

  const SurfaceIcon = surfaceIcon(versionStatus.surface);
  const updateTone = versionStatus.updateAvailable ? "warning" : "success";
  const updateLabel = versionStatus.updateAvailable
    ? "Có bản mới"
    : "Đã cập nhật";

  return (
    <section
      id="settings-overview"
      className="scroll-mt-6 grid gap-3 sm:grid-cols-3"
      aria-label="Tóm tắt cài đặt"
    >
      <article className="panel rounded-lg p-4">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-semibold tracking-[0.14em] text-slate-500 uppercase">
            Phiên bản hiện tại
          </p>
          <SurfaceIcon className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
        </div>
        <p className="mt-2 text-lg font-bold tracking-tight text-slate-950 tabular-nums">
          {versionStatus.current}
        </p>
        {versionStatus.buildMetadata !== null &&
        versionStatus.buildMetadata !== undefined ? (
          <p className="mt-1 text-xs text-slate-500">
            {versionStatus.buildMetadata}
          </p>
        ) : null}
      </article>

      <article className="panel rounded-lg p-4">
        <p className="text-xs font-semibold tracking-[0.14em] text-slate-500 uppercase">
          Môi trường
        </p>
        <p className="mt-2 text-lg font-bold tracking-tight text-slate-950">
          {formatSurfaceLabel(versionStatus.surface)}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          {versionStatus.latest
            ? `Mới nhất: ${formatBuildLabel(versionStatus.latest, versionStatus.latestBuildMetadata)}`
            : "Chưa xác định bản mới nhất"}
        </p>
      </article>

      <article className="panel rounded-lg p-4">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-semibold tracking-[0.14em] text-slate-500 uppercase">
            Cập nhật
          </p>
          <Badge tone={updateTone}>{updateLabel}</Badge>
        </div>
        <p className="mt-2 text-sm font-semibold text-slate-950">
          {versionStatus.updateAvailable
            ? "Có bản cập nhật sẵn sàng"
            : "Không có bản mới"}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          {versionStatus.surface === "web"
            ? "Web được promote tự động từ tag v*"
            : versionStatus.surface === "onprem"
              ? "On-prem cập nhật qua Docker stack"
              : "Desktop cập nhật qua GitHub Releases"}
        </p>
      </article>
    </section>
  );
}
