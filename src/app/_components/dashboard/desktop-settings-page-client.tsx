"use client";

import { useEffect, useMemo, useState } from "react";
import { MonitorCog, RefreshCw, Server, Trash2 } from "lucide-react";

import { Badge } from "~/app/_components/ui/badge";
import { Button } from "~/app/_components/ui/button";
import { FilterField } from "~/app/_components/ui/filter-field";
import { useToast } from "~/app/_components/ui/toast";
import { PageSectionNav } from "~/app/_components/dashboard/page-section-nav";
import { desktopSectionNavItems } from "~/app/_components/dashboard/page-nav-presets";
import type { DesktopServerConfig } from "~/types/bidtool-desktop";

const emptyConfig: DesktopServerConfig = {
  canEdit: true,
  serverUrl: null,
  source: "none",
};

function sourceLabel(source: DesktopServerConfig["source"]) {
  switch (source) {
    case "env":
      return "Cấu hình env quản trị";
    case "user":
      return "Lưu trên máy này";
    case "none":
      return "Server local đi kèm";
  }
}

function validateServerUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "Nhập URL server khách hàng.";
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "Dùng URL bắt đầu bằng http:// hoặc https://.";
    }
  } catch {
    return "Nhập URL hợp lệ, ví dụ http://bidtool.local.";
  }

  return null;
}

export function DesktopSettingsPageClient() {
  const { error, success } = useToast();
  const [isDesktop, setIsDesktop] = useState(false);
  const [config, setConfig] = useState<DesktopServerConfig>(emptyConfig);
  const [serverUrl, setServerUrl] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  useEffect(() => {
    const bridge = window.bidtoolDesktop;
    setIsDesktop(!!bridge?.isDesktop);

    if (!bridge?.isDesktop) {
      setIsLoading(false);
      return;
    }

    void bridge
      .getServerConfig()
      .then((nextConfig) => {
        setConfig(nextConfig);
        setServerUrl(nextConfig.serverUrl ?? "");
      })
      .catch((loadError: unknown) => {
        error(
          loadError instanceof Error
            ? loadError.message
            : "Không đọc được cấu hình desktop server.",
        );
      })
      .finally(() => setIsLoading(false));
  }, [error]);

  const activeMode = useMemo(() => {
    if (config.serverUrl) {
      return "On-prem server";
    }
    return "Bundled local server";
  }, [config.serverUrl]);

  const handleSave = async () => {
    const validationError = validateServerUrl(serverUrl);
    setFormError(validationError);
    if (validationError) {
      return;
    }

    const bridge = window.bidtoolDesktop;
    if (!bridge?.isDesktop) {
      return;
    }

    setIsSaving(true);
    try {
      const nextConfig = await bridge.setServerUrl(serverUrl);
      setConfig(nextConfig);
      setServerUrl(nextConfig.serverUrl ?? "");
      success("Đã lưu Desktop server URL.");
    } catch (saveError) {
      error(
        saveError instanceof Error
          ? saveError.message
          : "Không lưu được Desktop server URL.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleClear = async () => {
    const bridge = window.bidtoolDesktop;
    if (!bridge?.isDesktop || !config.canEdit) {
      return;
    }

    setIsClearing(true);
    try {
      const nextConfig = await bridge.clearServerUrl();
      setConfig(nextConfig);
      setServerUrl("");
      setFormError(null);
      success("Đã xóa Desktop server URL.");
    } catch (clearError) {
      error(
        clearError instanceof Error
          ? clearError.message
          : "Không xóa được Desktop server URL.",
      );
    } finally {
      setIsClearing(false);
    }
  };

  const handleReload = async () => {
    const bridge = window.bidtoolDesktop;
    if (!bridge?.isDesktop) {
      return;
    }

    setIsReloading(true);
    try {
      await bridge.reloadToServerUrl();
    } catch (reloadError) {
      error(
        reloadError instanceof Error
          ? reloadError.message
          : "Không tải được server đang cấu hình.",
      );
      setIsReloading(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <header className="rounded-lg border border-slate-200 bg-white px-5 py-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-950 text-white">
                <MonitorCog className="h-4 w-4" aria-hidden />
              </span>
              <Badge tone={isDesktop ? "success" : "neutral"}>
                {isDesktop ? "Đã nhận Electron" : "Chế độ trình duyệt"}
              </Badge>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-950">
              Desktop client
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              Trỏ desktop app tới server on-prem của khách hàng, hoặc xóa cấu
              hình để dùng server local đi kèm.
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
            <p className="text-xs font-semibold tracking-[0.12em] text-slate-500 uppercase">
              Chế độ hiện tại
            </p>
            <p className="mt-1 font-bold text-slate-950">{activeMode}</p>
          </div>
        </div>
      </header>

      <PageSectionNav title="Khu vực desktop" items={desktopSectionNavItems} />

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div
          id="desktop-server"
          className="scroll-mt-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
        >
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-sky-50 text-sky-700">
              <Server className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-bold text-slate-950">
                Server URL khách hàng
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                Dùng URL từ bản cài on-prem, thường là LAN hostname hoặc domain
                nội bộ sau reverse proxy đi kèm.
              </p>
            </div>
          </div>

          <div className="mt-5 space-y-4">
            <FilterField
              label="Server URL"
              htmlFor="desktop-server-url"
              error={formError ?? undefined}
              helper={
                config.source === "env"
                  ? "Giá trị này đang bị khóa bởi BIDTOOL_SERVER_URL."
                  : "Ví dụ: http://bidtool.local hoặc https://bidtool.company.com"
              }
            >
              <input
                id="desktop-server-url"
                value={serverUrl}
                disabled={!isDesktop || !config.canEdit || isLoading}
                onChange={(event) => {
                  setServerUrl(event.target.value);
                  setFormError(null);
                }}
                placeholder="http://localhost:13000"
                className="h-11 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 transition-colors duration-150 focus-visible:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-100 focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
              />
            </FilterField>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={handleSave}
                disabled={!isDesktop || !config.canEdit || isLoading}
                isLoading={isSaving}
              >
                Lưu URL
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={handleReload}
                disabled={!isDesktop || isLoading}
                isLoading={isReloading}
                leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
              >
                Tải chế độ hiện tại
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={handleClear}
                disabled={
                  !isDesktop ||
                  !config.canEdit ||
                  isLoading ||
                  !config.serverUrl
                }
                isLoading={isClearing}
                leftIcon={<Trash2 className="h-3.5 w-3.5" />}
              >
                Xóa
              </Button>
            </div>
          </div>
        </div>

        <aside
          id="desktop-config"
          className="scroll-mt-6 rounded-lg border border-slate-200 bg-slate-950 p-5 text-white shadow-sm"
        >
          <p className="text-xs font-semibold tracking-[0.14em] text-slate-400 uppercase">
            Cấu hình hiện tại
          </p>
          <dl className="mt-4 space-y-4 text-sm">
            <div>
              <dt className="text-slate-400">Nguồn</dt>
              <dd className="mt-1 font-semibold">
                {sourceLabel(config.source)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Server</dt>
              <dd className="mt-1 font-semibold break-all">
                {config.serverUrl ?? "Chưa cấu hình server remote"}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Có thể sửa</dt>
              <dd className="mt-1 font-semibold">
                {config.canEdit ? "Có" : "Không"}
              </dd>
            </div>
          </dl>
        </aside>
      </section>
    </div>
  );
}
