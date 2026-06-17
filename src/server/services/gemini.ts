/**
 * Google Gemini API service.
 * Uses the OpenAI-compatible endpoint provided by Google AI Studio.
 */

export type GeminiChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type GeminiChatCompletionResponse = {
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

const GEMINI_OPENAI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai";

function formatGeminiError(status: number, body: string) {
  try {
    const parsed = JSON.parse(body) as GeminiChatCompletionResponse;
    if (parsed.error?.message) {
      return `Gemini error (${status}): ${parsed.error.message}`;
    }
  } catch {
    // Fall through to raw body.
  }

  return `Gemini error (${status}): ${body.slice(0, 300)}`;
}

export async function createGeminiChatCompletion(input: {
  apiKey: string;
  model: string;
  messages: GeminiChatMessage[];
  signal?: AbortSignal;
  responseFormat?: "json_object" | "text";
}) {
  const response = await fetch(`${GEMINI_OPENAI_BASE}/chat/completions`, {
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
    throw new Error(formatGeminiError(response.status, body));
  }

  const data = JSON.parse(body) as GeminiChatCompletionResponse;
  const content = data.choices?.[0]?.message?.content?.trim() ?? "";

  if (!content) {
    throw new Error("Gemini returned an empty response.");
  }

  return {
    content,
    model: data.model ?? input.model,
    usage: data.usage,
  };
}
