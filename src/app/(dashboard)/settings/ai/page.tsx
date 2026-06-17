import { createPageMetadata } from "~/app/_lib/seo";
import { AiSettingsSection } from "~/app/_components/dashboard/ai-settings-section";
import { GeminiSettingsSection } from "~/app/_components/dashboard/gemini-settings-section";
import { OpenaiCompatibleSettingsSection } from "~/app/_components/dashboard/openai-compatible-settings-section";
import { ProviderSelectorSection } from "~/app/_components/dashboard/provider-selector-section";

export const metadata = createPageMetadata({
  title: "AI Providers",
  description:
    "Cấu hình các API key và custom provider cho tính năng AI.",
  path: "/settings/ai",
  noIndex: true,
});

export default function SettingsAiPage() {
  return (
    <div className="space-y-6">
      <ProviderSelectorSection />
      <AiSettingsSection />
      <GeminiSettingsSection />
      <OpenaiCompatibleSettingsSection />
    </div>
  );
}
