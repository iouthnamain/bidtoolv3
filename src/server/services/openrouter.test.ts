import { describe, expect, it } from "vitest";

import { extractOpenRouterMessageContent } from "~/server/services/openrouter";

describe("extractOpenRouterMessageContent", () => {
  it("reads plain string content", () => {
    expect(
      extractOpenRouterMessageContent({
        role: "assistant",
        content: "  OK  ",
      }),
    ).toBe("OK");
  });

  it("reads multipart text content", () => {
    expect(
      extractOpenRouterMessageContent({
        role: "assistant",
        content: [
          { type: "text", text: "hello" },
          { type: "text", text: "world" },
        ],
      }),
    ).toBe("hello\nworld");
  });

  it("falls back to reasoning when content is empty", () => {
    expect(
      extractOpenRouterMessageContent({
        role: "assistant",
        content: "",
        reasoning: "internal thoughts",
      }),
    ).toBe("internal thoughts");
  });
});
