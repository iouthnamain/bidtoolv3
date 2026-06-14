import { env } from "~/env";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export type OpenRouterChatRole = "system" | "user" | "assistant";

export type OpenRouterChatMessage = {
  role: OpenRouterChatRole;
  content: string;
};

type OpenRouterChatResponse = {
  choices?: Array<{
    message?: {
      role?: string;
      content?: string;
    };
  }>;
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: {
    message?: string;
    code?: number;
  };
};

function openRouterHeaders(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": env.APP_BASE_URL ?? "http://localhost:3000",
    "X-OpenRouter-Title": "BidTool v3",
  };
}

function formatOpenRouterError(status: number, body: string) {
  try {
    const parsed = JSON.parse(body) as OpenRouterChatResponse;
    if (parsed.error?.message) {
      return `OpenRouter error (${status}): ${parsed.error.message}`;
    }
  } catch {
    // Fall through to raw body.
  }

  return `OpenRouter error (${status}): ${body.slice(0, 300)}`;
}

export async function createOpenRouterChatCompletion(input: {
  apiKey: string;
  model: string;
  messages: OpenRouterChatMessage[];
  signal?: AbortSignal;
}) {
  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: openRouterHeaders(input.apiKey),
    body: JSON.stringify({
      model: input.model,
      messages: input.messages,
    }),
    signal: input.signal,
  });

  const body = await response.text();

  if (!response.ok) {
    throw new Error(formatOpenRouterError(response.status, body));
  }

  const data = JSON.parse(body) as OpenRouterChatResponse;
  const content = data.choices?.[0]?.message?.content?.trim();

  if (!content) {
    throw new Error("OpenRouter returned an empty response.");
  }

  return {
    content,
    model: data.model ?? input.model,
    usage: data.usage,
  };
}

export async function testOpenRouterConnection(input: {
  apiKey: string;
  model: string;
}) {
  const result = await createOpenRouterChatCompletion({
    apiKey: input.apiKey,
    model: input.model,
    messages: [{ role: "user", content: "Reply with exactly: OK" }],
  });

  return {
    ok: true,
    reply: result.content.slice(0, 120),
    model: result.model,
  };
}
