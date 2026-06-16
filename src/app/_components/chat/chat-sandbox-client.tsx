"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Bot, Loader2, Send, Settings2 } from "lucide-react";

import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { Badge, Button } from "~/app/_components/ui";
import { EmptyState } from "~/app/_components/ui/empty-state";
import { useToast } from "~/app/_components/ui/toast";
import { api } from "~/trpc/react";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  model?: string;
};

function createMessageId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function ChatSandboxClient() {
  const { error } = useToast();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { data: config, isLoading: isConfigLoading } =
    api.ai.getConfig.useQuery();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [model, setModel] = useState("openai/gpt-4o-mini");

  useEffect(() => {
    if (config?.openRouter?.defaultModel) {
      setModel(config.openRouter.defaultModel);
    }
  }, [config?.openRouter?.defaultModel]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const chatMutation = api.ai.chat.useMutation({
    onSuccess: (assistantMessage) => {
      setMessages((current) => [
        ...current,
        {
          id: createMessageId(),
          role: "assistant",
          content: assistantMessage.content,
          model: assistantMessage.model,
        },
      ]);
    },
    onError: (mutationError) => {
      error(mutationError.message);
    },
  });

  const handleSend = () => {
    const trimmed = draft.trim();
    if (!trimmed || chatMutation.isPending) {
      return;
    }

    const userMessage: ChatMessage = {
      id: createMessageId(),
      role: "user",
      content: trimmed,
    };

    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setDraft("");

    chatMutation.mutate({
      model: model.trim() || undefined,
      messages: nextMessages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    });
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  return (
    <DashboardShell
      title="Chat sandbox"
      description="Thử nghiệm chat qua OpenRouter. Tin nhắn được gửi từ server — API key không lộ ra trình duyệt."
    >
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
        <div className="panel overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-violet-600 text-white">
                <Bot className="h-4 w-4" aria-hidden />
              </span>
              <div>
                <p className="text-sm font-bold text-slate-950">OpenRouter</p>
                <p className="text-xs text-slate-500">
                  {config?.openRouter?.configured
                    ? `Key …${config?.openRouter?.keySuffix ?? "****"}`
                    : "Chưa cấu hình API key"}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={config?.openRouter?.configured ? "success" : "warning"}>
                {config?.openRouter?.configured ? "Sẵn sàng" : "Thiếu key"}
              </Badge>
              <Link
                href="/settings/ai"
                className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold text-slate-700 transition-colors duration-150 hover:bg-slate-100"
              >
                <Settings2 className="h-3.5 w-3.5" aria-hidden />
                Cài đặt
              </Link>
            </div>
          </div>

          {!isConfigLoading && !config?.openRouter?.configured ? (
            <div className="p-5">
              <EmptyState
                title="Cần OpenRouter API key"
                description="Vào Cài đặt → OpenRouter để nhập key trước khi chat."
                cta={
                  <Link
                    href="/settings/ai"
                    className="inline-flex min-h-9 items-center justify-center rounded-md bg-sky-700 px-3.5 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-sky-800"
                  >
                    Cấu hình OpenRouter
                  </Link>
                }
              />
            </div>
          ) : (
            <>
              <div className="flex max-h-[min(60vh,520px)] min-h-[320px] flex-col gap-3 overflow-y-auto bg-slate-50/80 p-4">
                {messages.length === 0 ? (
                  <div className="flex flex-1 items-center justify-center text-center">
                    <div className="max-w-md space-y-2">
                      <p className="text-sm font-semibold text-slate-700">
                        Bắt đầu cuộc hội thoại
                      </p>
                      <p className="text-sm leading-6 text-slate-500">
                        Gửi tin nhắn để thử model qua OpenRouter. Enter để gửi,
                        Shift+Enter để xuống dòng.
                      </p>
                    </div>
                  </div>
                ) : (
                  messages.map((message) => (
                    <div
                      key={message.id}
                      className={`flex ${
                        message.role === "user" ? "justify-end" : "justify-start"
                      }`}
                    >
                      <div
                        className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-6 whitespace-pre-wrap ${
                          message.role === "user"
                            ? "bg-sky-600 text-white"
                            : "border border-slate-200 bg-white text-slate-900 shadow-sm"
                        }`}
                      >
                        {message.content}
                        {message.model ? (
                          <p
                            className={`mt-2 text-[11px] ${
                              message.role === "user"
                                ? "text-sky-100"
                                : "text-slate-400"
                            }`}
                          >
                            {message.model}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  ))
                )}

                {chatMutation.isPending ? (
                  <div className="flex justify-start">
                    <div className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 shadow-sm">
                      <Loader2
                        className="h-4 w-4 animate-spin"
                        aria-hidden
                      />
                      Đang trả lời…
                    </div>
                  </div>
                ) : null}

                <div ref={messagesEndRef} />
              </div>

              <div className="space-y-3 border-t border-slate-200 p-4">
                <label className="block text-xs font-semibold tracking-[0.08em] text-slate-500 uppercase">
                  Model
                  <input
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                    className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 focus-visible:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-100 focus-visible:outline-none"
                  />
                </label>

                <div className="flex gap-2">
                  <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={handleKeyDown}
                    rows={3}
                    disabled={chatMutation.isPending}
                    placeholder="Nhập tin nhắn…"
                    className="min-h-[88px] flex-1 resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 transition-colors duration-150 focus-visible:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-100 focus-visible:outline-none disabled:bg-slate-100"
                  />
                  <Button
                    type="button"
                    onClick={handleSend}
                    disabled={!draft.trim() || chatMutation.isPending}
                    isLoading={chatMutation.isPending}
                    className="self-end"
                    leftIcon={<Send className="h-3.5 w-3.5" />}
                  >
                    Gửi
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </DashboardShell>
  );
}
