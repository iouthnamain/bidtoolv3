"use client";

import { useState } from "react";
import { Bot, KeyRound, Link, Trash2 } from "lucide-react";

import { SettingsSectionHeader } from "~/app/_components/dashboard/settings-section-header";
import { Badge, Button } from "~/app/_components/ui";
import { FilterField } from "~/app/_components/ui/filter-field";
import { useToast } from "~/app/_components/ui/toast";
import { api } from "~/trpc/react";

function sourceLabel(source: "env" | "database" | "none") {
  switch (source) {
    case "env":
      return "Biến môi trường";
    case "database":
      return "Lưu trong database";
    case "none":
      return "Chưa cấu hình";
  }
}

export function OpenaiCompatibleSettingsSection() {
  const { error, success } = useToast();
  const utils = api.useUtils();
  const { data: config, isLoading } = api.ai.getConfig.useQuery();

  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");

  const saveKeyMutation = api.ai.setOpenaiCompatibleApiKey.useMutation({
    onSuccess: async () => {
      setApiKey("");
      await utils.ai.getConfig.invalidate();
      success("Đã lưu OpenAI Compatible API key.");
    },
    onError: (mutationError) => {
      error(mutationError.message);
    },
  });

  const clearKeyMutation = api.ai.clearOpenaiCompatibleApiKey.useMutation({
    onSuccess: async () => {
      setApiKey("");
      await utils.ai.getConfig.invalidate();
      success("Đã xóa OpenAI Compatible API key.");
    },
    onError: (mutationError) => {
      error(mutationError.message);
    },
  });

  const saveBaseUrlMutation = api.ai.setOpenaiCompatibleBaseUrl.useMutation({
    onSuccess: async () => {
      setBaseUrl("");
      await utils.ai.getConfig.invalidate();
      success("Đã lưu Base URL.");
    },
    onError: (mutationError) => {
      error(mutationError.message);
    },
  });

  const handleSaveKey = () => {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      error("Nhập API key trước khi lưu.");
      return;
    }

    saveKeyMutation.mutate({ apiKey: trimmed });
  };

  const handleSaveBaseUrl = () => {
    const trimmed = baseUrl.trim();
    if (!trimmed) {
      error("Nhập Base URL trước khi lưu.");
      return;
    }

    saveBaseUrlMutation.mutate({ baseUrl: trimmed });
  };

  return (
    <section id="openai-compatible" className="panel scroll-mt-6 overflow-hidden mt-6">
      <SettingsSectionHeader
        eyebrow="OpenAI Compatible API"
        title="Custom Provider"
        description="Kết nối với các nhà cung cấp hỗ trợ OpenAI API format (như vLLM, Ollama, Together AI...)."
        icon={Bot}
        iconClassName="bg-emerald-600 text-white"
        badge={{
          label: config?.openaiCompatible?.configured ? "Đã cấu hình" : "Chưa cấu hình",
          tone: config?.openaiCompatible?.configured ? "success" : "warning",
        }}
      />

      <div className="grid gap-2 p-2 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-6">
          <div className="space-y-4">
            <div className="flex items-start gap-1">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-emerald-50 text-emerald-700">
                <Link className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-bold text-slate-950">URL gốc</h3>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  Địa chỉ API endpoint, ví dụ: https://api.together.xyz/v1.
                </p>
              </div>
            </div>

            <FilterField
              label="URL gốc"
              htmlFor="openai-compatible-base-url"
              helper={
                config?.openaiCompatible?.canEditBaseUrl
                  ? config.openaiCompatible.baseUrl
                    ? `Hiện tại đang dùng: ${config.openaiCompatible.baseUrl}. Nhập URL mới để thay thế.`
                    : "Chưa lưu URL nào."
                  : "Giá trị này đang bị khóa bởi OPENAI_COMPATIBLE_BASE_URL."
              }
            >
              <input
                id="openai-compatible-base-url"
                type="url"
                spellCheck={false}
                value={baseUrl}
                disabled={config?.openaiCompatible?.canEditBaseUrl === false || isLoading}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder={
                  config?.openaiCompatible?.baseUrl ? "…" : "https://api.your-provider.com/v1"
                }
                className="h-11 w-full rounded border border-slate-400 bg-white px-3 font-mono text-sm text-slate-900 transition-colors duration-0 focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-100 focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-700"
              />
            </FilterField>

            <Button
              type="button"
              variant="secondary"
              onClick={handleSaveBaseUrl}
              disabled={!config?.openaiCompatible?.canEditBaseUrl || isLoading}
              isLoading={saveBaseUrlMutation.isPending}
            >
              Lưu Base URL
            </Button>
          </div>

          <div className="space-y-4 border-t border-slate-400 pt-6">
            <div className="flex items-start gap-1">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-emerald-50 text-emerald-700">
                <KeyRound className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-bold text-slate-950">Khóa API</h3>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  Key xác thực cho Custom Provider (có thể để trống tùy provider).
                </p>
              </div>
            </div>

            <FilterField
              label="Khóa API"
              htmlFor="openai-compatible-api-key"
              helper={
                config?.openaiCompatible?.canEdit
                  ? config.openaiCompatible.keySuffix
                    ? `Key hiện tại kết thúc bằng …${config.openaiCompatible.keySuffix}. Nhập key mới để thay thế.`
                    : "Key được mã hóa lưu trong Postgres local."
                  : "Giá trị này đang bị khóa bởi OPENAI_COMPATIBLE_API_KEY."
              }
            >
              <input
                id="openai-compatible-api-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={apiKey}
                disabled={config?.openaiCompatible?.canEdit === false || isLoading}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={
                  config?.openaiCompatible?.configured ? "••••••••••••••••" : "sk-…"
                }
                className="h-11 w-full rounded border border-slate-400 bg-white px-3 font-mono text-sm text-slate-900 transition-colors duration-0 focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-100 focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-700"
              />
            </FilterField>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={handleSaveKey}
                disabled={config?.openaiCompatible?.canEdit === false || isLoading}
                isLoading={saveKeyMutation.isPending}
              >
                Lưu key
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => clearKeyMutation.mutate()}
                disabled={
                  config?.openaiCompatible?.canEdit === false || isLoading || !config?.openaiCompatible?.configured
                }
                isLoading={clearKeyMutation.isPending}
                leftIcon={<Trash2 className="h-3.5 w-3.5" />}
              >
                Xóa key
              </Button>
            </div>
          </div>
        </div>

        <aside className="rounded border border-slate-400 bg-slate-950 p-4 text-white">
          <p className="text-xs font-semibold tracking-[0.14em] text-slate-600 uppercase">
            Trạng thái
          </p>
          <dl className="mt-4 space-y-2 text-sm">
            <div>
              <dt className="text-slate-600">URL gốc</dt>
              <dd className="mt-1 font-mono text-xs font-semibold break-all">
                {config?.openaiCompatible?.baseUrl ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-slate-600">Nguồn Base URL</dt>
              <dd className="mt-1 font-semibold">
                {config?.openaiCompatible ? sourceLabel(config.openaiCompatible.baseUrlSource) : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-slate-600">Nguồn key</dt>
              <dd className="mt-1 font-semibold">
                {config?.openaiCompatible ? sourceLabel(config.openaiCompatible.source) : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-slate-600">Khóa</dt>
              <dd className="mt-1">
                <Badge tone={config?.openaiCompatible?.configured ? "success" : "neutral"}>
                  {config?.openaiCompatible?.configured
                    ? config.openaiCompatible.keySuffix
                      ? `…${config.openaiCompatible.keySuffix}`
                      : "Đã cấu hình"
                    : "Thiếu"}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className="text-slate-600">Có thể sửa</dt>
              <dd className="mt-1 space-y-1">
                <div className="flex items-center gap-2">
                  <Badge tone={config?.openaiCompatible?.canEditBaseUrl ? "success" : "neutral"}>
                    {config?.openaiCompatible?.canEditBaseUrl ? "Có" : "Không"}
                  </Badge>
                  <span className="text-xs text-slate-600">URL</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={config?.openaiCompatible?.canEdit ? "success" : "neutral"}>
                    {config?.openaiCompatible?.canEdit ? "Có" : "Không"}
                  </Badge>
                  <span className="text-xs text-slate-600">Khóa</span>
                </div>
              </dd>
            </div>
          </dl>
        </aside>
      </div>
    </section>
  );
}
