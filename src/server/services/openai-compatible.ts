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

/**
 * Parses either a plain JSON response or an SSE stream into a single response object.
 * Some providers ignore `stream: false` and always return SSE.
 */
function parseResponseBody(body: string, fallbackModel: string): OpenAICompatibleChatResponse {
  const trimmed = body.trim();

  // Plain JSON response
  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed) as OpenAICompatibleChatResponse;
  }

  // SSE stream: reassemble content from delta chunks
  const lines = trimmed.split("\n");
  let content = "";
  let model = fallbackModel;
  let promptTokens = 0;
  let completionTokens = 0;

  for (const line of lines) {
    if (!line.startsWith("data:")) continue;
    const json = line.slice(5).trim();
    if (json === "[DONE]") break;
    try {
      const chunk = JSON.parse(json) as {
        model?: string;
        choices?: Array<{ delta?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      if (chunk.model) model = chunk.model;
      content += chunk.choices?.[0]?.delta?.content ?? "";
      if (chunk.usage) {
        promptTokens = chunk.usage.prompt_tokens ?? promptTokens;
        completionTokens = chunk.usage.completion_tokens ?? completionTokens;
      }
    } catch {
      // skip malformed chunks
    }
  }

  return {
    model,
    choices: [{ message: { role: "assistant", content } }],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}

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
      stream: false,
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

  // Some providers ignore stream:false and return SSE anyway.
  // Detect and reassemble the streamed response.
  const data = parseResponseBody(body, input.model);
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
