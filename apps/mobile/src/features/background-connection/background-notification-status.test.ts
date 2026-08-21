import { describe, expect, it } from "vite-plus/test";

import { deriveBackgroundNotificationText } from "./background-notification-status";

const NOW = Date.parse("2026-08-12T10:00:05.000Z");

const activity = (
  summary: string,
  createdAt: string,
  sequence?: number,
  kind = "tool.progress",
) => ({
  id: `activity-${summary}`,
  tone: "tool" as const,
  kind,
  summary,
  payload: null,
  turnId: "turn-1",
  ...(sequence === undefined ? {} : { sequence }),
  createdAt,
});

describe("background notification status", () => {
  it("shows the latest activity while a turn is running", () => {
    expect(
      deriveBackgroundNotificationText(
        {
          latestTurn: { state: "running" },
          activities: [
            activity("Ran command started", "2026-08-12T10:00:00.000Z", undefined, "tool.started"),
            activity("Context compaction", "2026-08-12T10:00:01.000Z"),
          ],
        },
        NOW,
      ),
    ).toBe("Compacting context");
  });

  it("uses present-progress wording for command starts", () => {
    expect(
      deriveBackgroundNotificationText(
        {
          latestTurn: { state: "running" },
          activities: [
            activity("Ran command started", "2026-08-12T10:00:00.000Z", 1, "tool.started"),
          ],
        },
        NOW,
      ),
    ).toBe("Running command");
  });

  it("shows bounded command detail when the provider projects it", () => {
    expect(
      deriveBackgroundNotificationText(
        {
          latestTurn: { state: "running" },
          activities: [
            {
              ...activity("Ran command started", "2026-08-12T10:00:00.000Z", 1, "tool.started"),
              payload: {
                itemType: "command_execution",
                data: { item: { command: "ssh ubuntu 'docker compose ps'" } },
              },
            },
          ],
        },
        NOW,
      ),
    ).toBe("Running: ssh ubuntu 'docker compose ps'");
  });

  it("uses sequence order when activity timestamps match", () => {
    expect(
      deriveBackgroundNotificationText(
        {
          latestTurn: { state: "running" },
          activities: [
            activity("Older activity", "2026-08-12T10:00:00.000Z", 4),
            activity("Latest activity", "2026-08-12T10:00:00.000Z", 5),
          ],
        },
        NOW,
      ),
    ).toBe("Latest activity");
  });

  it("falls back to Working after the latest activity becomes stale", () => {
    expect(
      deriveBackgroundNotificationText(
        {
          latestTurn: { state: "running" },
          activities: [
            activity("Ran command started", "2026-08-12T10:00:00.000Z", 1, "tool.started"),
          ],
        },
        NOW + 30_001,
      ),
    ).toBe("Working");
  });

  it("clears back to the native connected text after a turn settles", () => {
    expect(
      deriveBackgroundNotificationText({
        latestTurn: { state: "completed" },
        activities: [activity("Ran command", "2026-08-12T10:00:00.000Z")],
      }),
    ).toBeNull();
  });

  it.each([
    ["Thinking", "Thinking", null, "tool.updated"],
    ["Context window updated", "Context window updated", null, "context-window.updated"],
    ["Read file started", "Reading file", { itemType: "file_read" }, "tool.started"],
    ["Changed files started", "Changing files", { itemType: "file_change" }, "tool.started"],
    [
      "Changed files",
      "Changed 2 files",
      { itemType: "file_change", data: { changedFiles: ["src/a.ts", "src/b.ts"] } },
      "tool.completed",
    ],
    ["Searched files started", "Searching files", { itemType: "search" }, "tool.started"],
    [
      "Searched files",
      "Searched notification status",
      { itemType: "search", data: { input: { query: "notification status" } } },
      "tool.completed",
    ],
    ["Tool started", "Calling browser", { toolName: "browser" }, "tool.started"],
    ["Tool finished", "Called browser", { toolName: "browser" }, "tool.completed"],
    ["View image started", "Viewing image", { itemType: "image_view" }, "tool.started"],
    ["Viewed image", "Viewed image", { itemType: "image_view" }, "tool.completed"],
  ])("formats %s safely", (summary, expected, payload, kind) => {
    expect(
      deriveBackgroundNotificationText(
        {
          latestTurn: { state: "running" },
          activities: [{ ...activity(summary, "2026-08-12T10:00:00.000Z", 1, kind), payload }],
        },
        NOW,
      ),
    ).toBe(expected);
  });

  it("extracts an array command from a nested provider payload", () => {
    expect(
      deriveBackgroundNotificationText(
        {
          latestTurn: { state: "running" },
          activities: [
            {
              ...activity("Ran command", "2026-08-12T10:00:00.000Z", 1, "tool.completed"),
              payload: { data: { item: { command: ["git", "status", "--short"] } } },
            },
          ],
        },
        NOW,
      ),
    ).toBe("Ran: git status --short");
  });

  it("never exposes approval payload detail", () => {
    expect(
      deriveBackgroundNotificationText(
        {
          latestTurn: { state: "running" },
          activities: [
            {
              ...activity("Approval", "2026-08-12T10:00:00.000Z", 1, "approval.requested"),
              tone: "approval",
              payload: { detail: "secret-token" },
            },
          ],
        },
        NOW,
      ),
    ).toBe("Waiting for approval");
  });

  it("clears a completed activity marker to Working while its turn remains running", () => {
    expect(
      deriveBackgroundNotificationText(
        {
          latestTurn: { state: "running" },
          activities: [
            {
              ...activity("Old provider detail", "2026-08-12T10:00:00.000Z", 1),
              completedAt: "2026-08-12T10:00:01.000Z",
            },
          ],
        },
        NOW,
      ),
    ).toBe("Working");
  });
});
