"use client";

import { Bot, Check, MessageSquare, Sparkles } from "lucide-react";

import { SettingsSectionHeader } from "~/app/_components/dashboard/settings-section-header";
import { Badge } from "~/app/_components/ui";
import { SkeletonKpi } from "~/app/_components/ui/skeleton";
import { useToast } from "~/app/_components/ui/toast";
import { api } from "~/trpc/react";

type ProviderId = "openrouter" | "gemini" | "openai_compatible";
type FeatureId = "chat" | "enrichment";

const PROVIDER_META: Record<
  ProviderId,
  { label: string; description: string }
> = {
  openrouter: {
    label: "OpenRouter",
    description: "Gateway tới nhiều model (OpenAI, Anthropic, Google…).",
  },
  gemini: {
    label: "Google Gemini",
    description: "Model Gemini trực tiếp từ Google AI Studio.",
  },
  openai_compatible: {
    label: "Custom Provider",
    description: "Endpoint tương thích OpenAI (vLLM, Ollama, Together…).",
  },
};

const FEATURES: { id: FeatureId; label: string; description: string; icon: typeof Bot }[] = [
  {
    id: "chat",
    label: "Thử nghiệm chat",
    description: "Provider dùng cho trang chat thử nghiệm.",
    icon: MessageSquare,
  },
  {
    id: "enrichment",
    label: "Làm giàu vật tư (Enrichment)",
    description: "Provider dùng để trích xuất dữ liệu vật tư từ web.",
    icon: Sparkles,
  },
];

export function ProviderSelectorSection() {
  const { error, success } = useToast();
  const utils = api.useUtils();

  const { data: config, isLoading: configLoading } =
    api.ai.getConfig.useQuery();
  const { data: active, isLoading: activeLoading } =
    api.ai.getActiveProviders.useQuery();

  const setActiveMutation = api.ai.setActiveProvider.useMutation({
    onSuccess: async () => {
      await utils.ai.getActiveProviders.invalidate();
      success("Đã cập nhật provider.");
    },
    onError: (mutationError) => {
      error(mutationError.message);
    },
  });

  const isLoading = configLoading || activeLoading;

  const configuredMap: Record<ProviderId, boolean> = {
    openrouter: config?.openRouter?.configured ?? false,
    gemini: config?.gemini?.configured ?? false,
    openai_compatible: config?.openaiCompatible?.configured ?? false,
  };

  const handleSelect = (feature: FeatureId, provider: ProviderId) => {
    if (active?.[feature] === provider) {
      return;
    }
    if (!configuredMap[provider]) {
      error("Provider này chưa có API key. Nhập key ở mục bên dưới trước.");
      return;
    }
    setActiveMutation.mutate({ feature, provider });
  };

  return (
    <section id="ai-provider-selector" className="panel scroll-mt-6 overflow-hidden">
      <SettingsSectionHeader
        eyebrow="Provider"
        title="Chọn AI provider cho từng tính năng"
        description="Quyết định provider nào được dùng cho mỗi chức năng AI trong ứng dụng. Chỉ chọn được provider đã có API key."
        icon={Bot}
        iconClassName="bg-blue-600 text-white"
      />

      <div className="space-y-5 p-2">
        {isLoading ? (
          <div className="grid gap-1 sm:grid-cols-2">
            <SkeletonKpi />
            <SkeletonKpi />
          </div>
        ) : (
          FEATURES.map((feature) => {
            const FeatureIcon = feature.icon;
            const selected = active?.[feature.id] ?? "openrouter";
            return (
              <fieldset
                key={feature.id}
                className="rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] p-4"
              >
                <legend className="sr-only">{feature.label}</legend>
                <div className="mb-3 flex items-start gap-1">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-blue-50 text-blue-700">
                    <FeatureIcon className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-slate-950">
                      {feature.label}
                    </h3>
                    <p className="mt-0.5 text-sm leading-6 text-slate-600">
                      {feature.description}
                    </p>
                  </div>
                </div>

                <div className="grid gap-2 sm:grid-cols-3">
                  {(Object.keys(PROVIDER_META) as ProviderId[]).map(
                    (providerId) => {
                      const meta = PROVIDER_META[providerId];
                      const isSelected = selected === providerId;
                      const isConfigured = configuredMap[providerId];
                      const isPending =
                        setActiveMutation.isPending &&
                        setActiveMutation.variables?.feature === feature.id &&
                        setActiveMutation.variables?.provider === providerId;

                      return (
                        <button
                          key={providerId}
                          type="button"
                          aria-pressed={isSelected}
                          disabled={!isConfigured || setActiveMutation.isPending}
                          onClick={() => handleSelect(feature.id, providerId)}
                          className={`flex flex-col gap-1 rounded border p-3 text-left transition-colors duration-0 focus-visible:ring-2 focus-visible:ring-blue-100 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 ${
                            isSelected
                              ? "border-blue-500 bg-blue-50"
                              : "border-slate-500 bg-white shadow-sm hover:border-slate-600 hover:bg-slate-100"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-bold text-slate-950">
                              {meta.label}
                            </span>
                            {isSelected ? (
                              <Check
                                className="h-4 w-4 shrink-0 text-blue-600"
                                aria-hidden
                              />
                            ) : null}
                          </div>
                          <span className="text-xs leading-5 text-slate-700">
                            {meta.description}
                          </span>
                          <span className="mt-1">
                            <Badge tone={isConfigured ? "success" : "neutral"}>
                              {isPending
                                ? "Đang lưu…"
                                : isConfigured
                                  ? "Sẵn sàng"
                                  : "Chưa có key"}
                            </Badge>
                          </span>
                        </button>
                      );
                    },
                  )}
                </div>
              </fieldset>
            );
          })
        )}
      </div>
    </section>
  );
}
