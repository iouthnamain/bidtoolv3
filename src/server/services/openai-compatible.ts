/**
 * OpenAI-compatible provider service.
 * Works with any provider that supports the /chat/completions endpoint
 * (vLLM, Ollama, Together AI, etc.)
 */

export type OpenAICompatibleChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type OpenAICompatibleChatResponse = {
  choices?: Array<{
    message?: {
      role?: string;
      content?: string | null;
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

function formatError(status: number, body: string) {
  try {
    const parsed = JSON.parse(body) as OpenAICompatibleChatResponse;
    if (parsed.error?.message) {
      return `OpenAI Compatible error (${status}): ${parsed.error.message}`;
    }
  } catch {
    // Fall through to raw body.
  }

  return `OpenAI Compatible error (${status}): ${body.slice(0, 300)}`;
}

export async function createOpenAICompatibleChatCompletion(input: {
  apiKey: string;
  baseUrl: string;
  model: string;
  messages: OpenAICompatibleChatMessage[];
  signal?: AbortSignal;
  responseFormat?: "json_object" | "text";
}) {
  const url = input.baseUrl.replace(/\/+$/, "") + "/chat/completions";

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
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
    throw new Error(formatError(response.status, body));
  }

  const data = JSON.parse(body) as OpenAICompatibleChatResponse;
  const content = data.choices?.[0]?.message?.content?.trim() ?? "";

  if (!content) {
    throw new Error("OpenAI Compatible provider returned an empty response.");
  }

  return {
    content,
    model: data.model ?? input.model,
    usage: data.usage,
  };
}
