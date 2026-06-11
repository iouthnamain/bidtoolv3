"use client";

import { useEffect, useMemo, useState } from "react";
import { MonitorCog, RefreshCw, Server, Trash2 } from "lucide-react";

import { SettingsSectionHeader } from "~/app/_components/dashboard/settings-section-header";
import { Badge, Button } from "~/app/_components/ui";
import { EmptyState } from "~/app/_components/ui/empty-state";
import { FilterField } from "~/app/_components/ui/filter-field";
import { useToast } from "~/app/_components/ui/toast";
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

export function DesktopSettingsSection() {
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
    <section id="desktop-client" className="panel scroll-mt-6 overflow-hidden">
      <SettingsSectionHeader
        eyebrow="Desktop"
        title="Desktop client"
        description="Trỏ ứng dụng Electron tới server on-prem của khách hàng, hoặc dùng server local đi kèm."
        icon={MonitorCog}
        iconClassName="bg-slate-950 text-white"
        badge={{
          label: isDesktop ? "Electron" : "Trình duyệt",
          tone: isDesktop ? "success" : "neutral",
        }}
        action={
          isDesktop ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
              <p className="text-[11px] font-semibold tracking-[0.12em] text-slate-500 uppercase">
                Chế độ
              </p>
              <p className="mt-0.5 font-bold text-slate-950">{activeMode}</p>
            </div>
          ) : null
        }
      />

      {!isDesktop ? (
        <div className="p-5">
          <EmptyState
            title="Chỉ khả dụng trên desktop app"
            description="Mở BidTool bằng ứng dụng Electron để cấu hình server URL và chuyển giữa server on-prem với server local đi kèm."
          />
        </div>
      ) : (
        <div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div id="desktop-server" className="scroll-mt-6 space-y-5">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-sky-50 text-sky-700">
                <Server className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-bold text-slate-950">
                  Server URL khách hàng
                </h3>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  Dùng URL từ bản cài on-prem — thường là hostname LAN hoặc
                  domain nội bộ sau reverse proxy.
                </p>
              </div>
            </div>

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
                disabled={!config.canEdit || isLoading}
                onChange={(event) => {
                  setServerUrl(event.target.value);
                  setFormError(null);
                }}
                placeholder="http://localhost:13000"
                className="h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 transition-colors duration-150 focus-visible:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-100 focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
              />
            </FilterField>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={handleSave}
                disabled={!config.canEdit || isLoading}
                isLoading={isSaving}
              >
                Lưu URL
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={handleReload}
                disabled={isLoading}
                isLoading={isReloading}
                leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
              >
                Tải chế độ hiện tại
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={handleClear}
                disabled={!config.canEdit || isLoading || !config.serverUrl}
                isLoading={isClearing}
                leftIcon={<Trash2 className="h-3.5 w-3.5" />}
              >
                Xóa
              </Button>
            </div>
          </div>

          <aside
            id="desktop-config"
            className="scroll-mt-6 rounded-lg border border-slate-200 bg-slate-950 p-4 text-white"
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
                <dd className="mt-1">
                  <Badge tone={config.canEdit ? "success" : "neutral"}>
                    {config.canEdit ? "Có" : "Không"}
                  </Badge>
                </dd>
              </div>
            </dl>
          </aside>
        </div>
      )}
    </section>
  );
}
