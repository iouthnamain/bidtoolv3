"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bot, ExternalLink, KeyRound, Trash2, Zap } from "lucide-react";

import { SettingsSectionHeader } from "~/app/_components/dashboard/settings-section-header";
import { Badge, Button } from "~/app/_components/ui";
import { FilterField } from "~/app/_components/ui/filter-field";
import { useToast } from "~/app/_components/ui/toast";
import { api } from "~/trpc/react";

const POPULAR_MODELS = [
  "openrouter/free",
  "openai/gpt-4o-mini",
  "openai/gpt-4o",
  "anthropic/claude-3.5-sonnet",
  "google/gemini-2.0-flash-001",
  "meta-llama/llama-3.3-70b-instruct",
] as const;

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

export function AiSettingsSection() {
  const { error, success } = useToast();
  const utils = api.useUtils();
  const { data: config, isLoading } = api.ai.getConfig.useQuery();

  const [apiKey, setApiKey] = useState("");
  const [defaultModel, setDefaultModel] = useState("openai/gpt-4o-mini");

  const configDefaultModel = config?.openRouter?.defaultModel;
  useEffect(() => {
    if (configDefaultModel) {
      setDefaultModel(configDefaultModel);
    }
  }, [configDefaultModel]);

  const saveKeyMutation = api.ai.setOpenRouterApiKey.useMutation({
    onSuccess: async (nextConfig) => {
      setApiKey("");
      await utils.ai.getConfig.invalidate();
      success("Đã lưu OpenRouter API key.");
      return nextConfig;
    },
    onError: (mutationError) => {
      error(mutationError.message);
    },
  });

  const clearKeyMutation = api.ai.clearOpenRouterApiKey.useMutation({
    onSuccess: async () => {
      setApiKey("");
      await utils.ai.getConfig.invalidate();
      success("Đã xóa OpenRouter API key.");
    },
    onError: (mutationError) => {
      error(mutationError.message);
    },
  });

  const saveModelMutation = api.ai.setDefaultModel.useMutation({
    onSuccess: async () => {
      await utils.ai.getConfig.invalidate();
      success("Đã lưu model mặc định.");
    },
    onError: (mutationError) => {
      error(mutationError.message);
    },
  });

  const testMutation = api.ai.testConnection.useMutation({
    onSuccess: (result) => {
      success(`Kết nối OK — model ${result.model}: ${result.reply}`);
    },
    onError: (mutationError) => {
      error(mutationError.message);
    },
  });

  const handleSaveKey = () => {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      error("Nhập OpenRouter API key trước khi lưu.");
      return;
    }

    saveKeyMutation.mutate({ apiKey: trimmed });
  };

  const handleTest = () => {
    const trimmed = apiKey.trim();
    testMutation.mutate(trimmed ? { apiKey: trimmed } : undefined);
  };

  const handleSaveModel = () => {
    const trimmed = defaultModel.trim();
    if (!trimmed) {
      error("Nhập model mặc định.");
      return;
    }

    saveModelMutation.mutate({ model: trimmed });
  };

  return (
    <section id="openrouter" className="panel scroll-mt-6 overflow-hidden">
      <SettingsSectionHeader
        eyebrow="OpenRouter"
        title="OpenRouter API"
        description="Kết nối OpenRouter để thử chat LLM trong sandbox. Key chỉ lưu trên server — không gửi xuống trình duyệt sau khi lưu."
        icon={Bot}
        iconClassName="bg-violet-600 text-white"
        badge={{
          label: config?.openRouter?.configured ? "Đã cấu hình" : "Chưa cấu hình",
          tone: config?.openRouter?.configured ? "success" : "warning",
        }}
        action={
          <Link
            href="/chat"
            className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded border border-slate-400 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 transition-colors duration-0 hover:bg-slate-50"
          >
            Mở chat sandbox
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </Link>
        }
      />

      <div className="grid gap-2 p-2 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-6">
          <div className="space-y-4">
            <div className="flex items-start gap-1">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-violet-50 text-violet-700">
                <KeyRound className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-bold text-slate-950">Khóa API</h3>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  Lấy key tại{" "}
                  <a
                    href="https://openrouter.ai/keys"
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold text-blue-700 underline-offset-2 hover:underline"
                  >
                    openrouter.ai/keys
                  </a>
                  . OpenRouter là gateway tới nhiều model (OpenAI, Anthropic,
                  Google, Meta, …) qua một API tương thích OpenAI.
                </p>
              </div>
            </div>

            <FilterField
              label="OpenRouter API key"
              htmlFor="openrouter-api-key"
              helper={
                config?.openRouter?.canEdit
                  ? config.openRouter.keySuffix
                    ? `Key hiện tại kết thúc bằng …${config.openRouter.keySuffix}. Nhập key mới để thay thế.`
                    : "Key được mã hóa lưu trong Postgres local."
                  : "Giá trị này đang bị khóa bởi OPENROUTER_API_KEY."
              }
            >
              <input
                id="openrouter-api-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={apiKey}
                disabled={config?.openRouter?.canEdit === false || isLoading}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={
                  config?.openRouter?.configured ? "••••••••••••••••" : "sk-or-v1-…"
                }
                className="h-11 w-full rounded border border-slate-400 bg-white px-3 font-mono text-sm text-slate-900 transition-colors duration-0 focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-100 focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-700"
              />
            </FilterField>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={handleSaveKey}
                disabled={config?.openRouter?.canEdit === false || isLoading}
                isLoading={saveKeyMutation.isPending}
              >
                Lưu key
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={handleTest}
                disabled={isLoading}
                isLoading={testMutation.isPending}
                leftIcon={<Zap className="h-3.5 w-3.5" />}
              >
                Thử kết nối
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => clearKeyMutation.mutate()}
                disabled={
                  config?.openRouter?.canEdit === false || isLoading || !config?.openRouter?.configured
                }
                isLoading={clearKeyMutation.isPending}
                leftIcon={<Trash2 className="h-3.5 w-3.5" />}
              >
                Xóa key
              </Button>
            </div>
          </div>

          <div className="space-y-4 border-t border-slate-400 pt-6">
            <FilterField
              label="Model mặc định"
              htmlFor="openrouter-default-model"
              helper="Dùng slug model từ OpenRouter, ví dụ openrouter/free hoặc openai/gpt-4o-mini."
            >
              <input
                id="openrouter-default-model"
                list="openrouter-model-suggestions"
                spellCheck={false}
                value={defaultModel}
                disabled={isLoading}
                onChange={(event) => setDefaultModel(event.target.value)}
                className="h-11 w-full rounded border border-slate-400 bg-white px-3 font-mono text-sm text-slate-900 transition-colors duration-0 focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-100 focus-visible:outline-none"
              />
              <datalist id="openrouter-model-suggestions">
                {POPULAR_MODELS.map((model) => (
                  <option key={model} value={model} />
                ))}
              </datalist>
            </FilterField>

            <Button
              type="button"
              variant="secondary"
              onClick={handleSaveModel}
              disabled={isLoading}
              isLoading={saveModelMutation.isPending}
            >
              Lưu model
            </Button>
          </div>
        </div>

        <aside className="rounded border border-slate-400 bg-slate-950 p-4 text-white">
          <p className="text-xs font-semibold tracking-[0.14em] text-slate-600 uppercase">
            Trạng thái
          </p>
          <dl className="mt-4 space-y-2 text-sm">
            <div>
              <dt className="text-slate-600">Nguồn key</dt>
              <dd className="mt-1 font-semibold">
                {config?.openRouter ? sourceLabel(config.openRouter.source) : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-slate-600">Khóa</dt>
              <dd className="mt-1">
                <Badge tone={config?.openRouter?.configured ? "success" : "neutral"}>
                  {config?.openRouter?.configured
                    ? config.openRouter.keySuffix
                      ? `…${config.openRouter.keySuffix}`
                      : "Đã cấu hình"
                    : "Thiếu"}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className="text-slate-600">Model mặc định</dt>
              <dd className="mt-1 font-mono text-xs font-semibold break-all">
                {config?.openRouter?.defaultModel ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-slate-600">Có thể sửa key</dt>
              <dd className="mt-1">
                <Badge tone={config?.openRouter?.canEdit ? "success" : "neutral"}>
                  {config?.openRouter?.canEdit ? "Có" : "Không"}
                </Badge>
              </dd>
            </div>
          </dl>
        </aside>
      </div>
    </section>
  );
}
