import { createPageMetadata } from "~/app/_lib/seo";
import { AiSettingsSection } from "~/app/_components/dashboard/ai-settings-section";

export const metadata = createPageMetadata({
  title: "OpenRouter",
  description:
    "Cấu hình OpenRouter API key và model mặc định cho chat sandbox.",
  path: "/settings/ai",
  noIndex: true,
});

export default function SettingsAiPage() {
  return <AiSettingsSection />;
}
