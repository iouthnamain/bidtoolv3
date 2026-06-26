"use client";

import { useState } from "react";
import { Bot, KeyRound, Trash2 } from "lucide-react";

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

export function GeminiSettingsSection() {
  const { error, success } = useToast();
  const utils = api.useUtils();
  const { data: config, isLoading } = api.ai.getConfig.useQuery();

  const [apiKey, setApiKey] = useState("");

  const saveKeyMutation = api.ai.setGeminiApiKey.useMutation({
    onSuccess: async () => {
      setApiKey("");
      await utils.ai.getConfig.invalidate();
      success("Đã lưu Gemini API key.");
    },
    onError: (mutationError) => {
      error(mutationError.message);
    },
  });

  const clearKeyMutation = api.ai.clearGeminiApiKey.useMutation({
    onSuccess: async () => {
      setApiKey("");
      await utils.ai.getConfig.invalidate();
      success("Đã xóa Gemini API key.");
    },
    onError: (mutationError) => {
      error(mutationError.message);
    },
  });

  const handleSaveKey = () => {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      error("Nhập Gemini API key trước khi lưu.");
      return;
    }

    saveKeyMutation.mutate({ apiKey: trimmed });
  };

  return (
    <section id="gemini" className="panel scroll-mt-6 overflow-hidden mt-6">
      <SettingsSectionHeader
        eyebrow="Gemini API"
        title="Google Gemini API"
        description="Kết nối Google Gemini API để sử dụng các model như Gemini 2.0 Flash."
        icon={Bot}
        iconClassName="bg-blue-600 text-white"
        badge={{
          label: config?.gemini?.configured ? "Đã cấu hình" : "Chưa cấu hình",
          tone: config?.gemini?.configured ? "success" : "warning",
        }}
      />

      <div className="grid gap-2 p-2 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-6">
          <div className="space-y-4">
            <div className="flex items-start gap-1">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-blue-50 text-blue-700">
                <KeyRound className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-bold text-slate-950">Khóa API</h3>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  Lấy key tại{" "}
                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold text-blue-700 underline-offset-2 hover:underline"
                  >
                    Google AI Studio
                  </a>
                  .
                </p>
              </div>
            </div>

            <FilterField
              label="Gemini API key"
              htmlFor="gemini-api-key"
              helper={
                config?.gemini?.canEdit
                  ? config.gemini.keySuffix
                    ? `Key hiện tại kết thúc bằng …${config.gemini.keySuffix}. Nhập key mới để thay thế.`
                    : "Key được mã hóa lưu trong Postgres local."
                  : "Giá trị này đang bị khóa bởi GEMINI_API_KEY."
              }
            >
              <input
                id="gemini-api-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={apiKey}
                disabled={config?.gemini?.canEdit === false || isLoading}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={
                  config?.gemini?.configured ? "••••••••••••••••" : "AIzaSy…"
                }
                className="h-11 w-full rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] px-3 font-mono text-sm text-slate-900 transition-colors duration-0 focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-100 focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-700"
              />
            </FilterField>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={handleSaveKey}
                disabled={config?.gemini?.canEdit === false || isLoading}
                isLoading={saveKeyMutation.isPending}
              >
                Lưu key
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => clearKeyMutation.mutate()}
                disabled={
                  config?.gemini?.canEdit === false || isLoading || !config?.gemini?.configured
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
              <dt className="text-slate-600">Nguồn key</dt>
              <dd className="mt-1 font-semibold">
                {config?.gemini ? sourceLabel(config.gemini.source) : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-slate-600">Khóa</dt>
              <dd className="mt-1">
                <Badge tone={config?.gemini?.configured ? "success" : "neutral"}>
                  {config?.gemini?.configured
                    ? config.gemini.keySuffix
                      ? `…${config.gemini.keySuffix}`
                      : "Đã cấu hình"
                    : "Thiếu"}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className="text-slate-600">Có thể sửa key</dt>
              <dd className="mt-1">
                <Badge tone={config?.gemini?.canEdit ? "success" : "neutral"}>
                  {config?.gemini?.canEdit ? "Có" : "Không"}
                </Badge>
              </dd>
            </div>
          </dl>
        </aside>
      </div>
    </section>
  );
}
