import { describe, expect, it } from "vite-plus/test";

import {
  ANDROID_AGENT_RESPONSE_PREVIEW_MAX_LENGTH,
  buildAndroidAgentNotificationText,
  deriveLatestAssistantResponsePreview,
  stripMarkdownLinkDestinations,
} from "./localNotificationContent";

const runningTurn = {
  assistantMessageId: "assistant-2" as never,
  completedAt: "2026-08-14T12:00:00.000Z",
  requestedAt: "2026-08-14T11:59:00.000Z",
  startedAt: "2026-08-14T11:59:01.000Z",
  state: "completed" as const,
  turnId: "turn-2" as never,
};

function thread(overrides: Record<string, unknown> = {}) {
  return {
    title: "Updated thread title",
    latestTurn: runningTurn,
    messages: [
      {
        id: "user-1" as never,
        role: "user" as const,
        text: "Original question",
        turnId: null,
      },
      {
        id: "assistant-1" as never,
        role: "assistant" as const,
        text: "Earlier answer",
        turnId: "turn-1" as never,
      },
      {
        id: "assistant-2" as never,
        role: "assistant" as const,
        text: "The current answer is ready.",
        turnId: "turn-2" as never,
      },
    ],
    ...overrides,
  };
}

describe("local agent notification content", () => {
  it("uses the completed turn assistant message rather than the original prompt", () => {
    expect(deriveLatestAssistantResponsePreview(thread())).toBe("The current answer is ready.");
  });

  it("falls back to the newest assistant message when no message id is available", () => {
    expect(
      deriveLatestAssistantResponsePreview(
        thread({ latestTurn: { ...runningTurn, assistantMessageId: null } }),
      ),
    ).toBe("The current answer is ready.");
  });

  it("collapses whitespace and truncates long responses", () => {
    const preview = deriveLatestAssistantResponsePreview(
      thread({
        messages: [
          {
            id: "assistant-2" as never,
            role: "assistant" as const,
            text: `  ${"A ".repeat(200)}  `,
            turnId: "turn-2" as never,
          },
        ],
      }),
    );
    expect(preview).not.toBeNull();
    expect(preview!.length).toBe(ANDROID_AGENT_RESPONSE_PREVIEW_MAX_LENGTH);
    expect(preview!.endsWith("…")).toBe(true);
  });

  it("keeps Markdown link labels without exposing raw local destinations", () => {
    const response = String.raw`See [T3_ANDROID_REQUIRED_FEATURES.md](<C:\Users\jason\OneDrive\Documents\Cursor\Codex\T3_ANDROID_REQUIRED_FEATURES.md:107>) for the requirement.`;

    expect(stripMarkdownLinkDestinations(response)).toBe(
      "See T3_ANDROID_REQUIRED_FEATURES.md for the requirement.",
    );
    expect(
      deriveLatestAssistantResponsePreview(
        thread({
          messages: [
            {
              id: "assistant-2" as never,
              role: "assistant" as const,
              text: response,
              turnId: "turn-2" as never,
            },
          ],
        }),
      ),
    ).toBe("See T3_ANDROID_REQUIRED_FEATURES.md for the requirement.");
  });

  it("removes web and image destinations from the compact preview", () => {
    expect(
      stripMarkdownLinkDestinations(
        "Read [the docs](https://example.com/docs) and ![the diagram](https://example.com/a.png).",
      ),
    ).toBe("Read the docs and the diagram.");
  });

  it("uses the updated thread title and includes the response status", () => {
    expect(buildAndroidAgentNotificationText(thread())).toEqual({
      title: "Updated thread title",
      body: "Agent finished — The current answer is ready.",
    });
  });

  it("keeps a useful failure notification when no response text exists", () => {
    expect(
      buildAndroidAgentNotificationText(
        thread({
          latestTurn: { ...runningTurn, state: "error" as const },
          messages: [],
        }),
      ),
    ).toEqual({ title: "Updated thread title", body: "Agent failed" });
  });
});
