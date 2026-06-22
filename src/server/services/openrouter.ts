import { env } from "~/env";
import { createLogger, traceFn } from "~/server/lib/logger";
const log = createLogger("services-openrouter");

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export type OpenRouterChatRole = "system" | "user" | "assistant";

export type OpenRouterChatMessage = {
  role: OpenRouterChatRole;
  content: string;
};

type OpenRouterMessageContentPart = {
  type?: string;
  text?: string;
};

type OpenRouterChatResponse = {
  choices?: Array<{
    message?: {
      role?: string;
      content?: string | OpenRouterMessageContentPart[] | null;
      reasoning?: string | null;
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

type OpenRouterAssistantMessage = {
  role?: string;
  content?: string | OpenRouterMessageContentPart[] | null;
  reasoning?: string | null;
};

function _extractOpenRouterMessageContent(
  message: OpenRouterAssistantMessage | null | undefined,
) {
  if (!message) {
    return "";
  }

  const content = message.content;
  if (typeof content === "string" && content.trim()) {
    return content.trim();
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => (part?.type === "text" ? part.text?.trim() ?? "" : ""))
      .filter(Boolean)
      .join("\n")
      .trim();
    if (text) {
      return text;
    }
  }

  const reasoning =
    typeof message.reasoning === "string" ? message.reasoning.trim() : "";
  return reasoning;
}

async function _createOpenRouterChatCompletion(input: {
  apiKey: string;
  model: string;
  messages: OpenRouterChatMessage[];
  signal?: AbortSignal;
  responseFormat?: "json_object" | "text";
}) {
  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: openRouterHeaders(input.apiKey),
    body: JSON.stringify({
      model: input.model,
      messages: input.messages,
      ...(input.responseFormat === "json_object"
        ? { response_format: { type: "json_object" } }
        : {}),
    }),
    signal: input.signal,
  });

  const body = await response.text();

  if (!response.ok) {
    throw new Error(formatOpenRouterError(response.status, body));
  }

  const data = JSON.parse(body) as OpenRouterChatResponse;
  const content = extractOpenRouterMessageContent(data.choices?.[0]?.message);

  if (!content) {
    throw new Error("OpenRouter returned an empty response.");
  }

  return {
    content,
    model: data.model ?? input.model,
    usage: data.usage,
  };
}

async function _testOpenRouterConnection(input: {
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

export const extractOpenRouterMessageContent = traceFn(log, "extractOpenRouterMessageContent", _extractOpenRouterMessageContent);
export const createOpenRouterChatCompletion = traceFn(log, "createOpenRouterChatCompletion", _createOpenRouterChatCompletion);
export const testOpenRouterConnection = traceFn(log, "testOpenRouterConnection", _testOpenRouterConnection);
