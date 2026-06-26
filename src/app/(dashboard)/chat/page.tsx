import { createPageMetadata } from "~/app/_lib/seo";
import { ChatSandboxClient } from "~/app/_components/chat/chat-sandbox-client";

export const dynamic = "force-dynamic";

export const metadata = createPageMetadata({
  title: "Thử nghiệm chat",
  description:
    "Thử nghiệm chat LLM qua OpenRouter với model tùy chọn trong BidTool v3.",
  path: "/chat",
  noIndex: true,
});

export default function ChatPage() {
  return <ChatSandboxClient />;
}
