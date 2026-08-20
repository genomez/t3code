import { describe, expect, it } from "vite-plus/test";

import { deriveBackgroundNotificationText } from "./background-notification-status";

const NOW = Date.parse("2026-08-12T10:00:05.000Z");

const activity = (summary: string, createdAt: string, sequence?: number, kind = "tool.progress") => ({
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
      deriveBackgroundNotificationText({
        latestTurn: { state: "running" },
        activities: [
          activity("Ran command started", "2026-08-12T10:00:00.000Z", undefined, "tool.started"),
          activity("Context compaction", "2026-08-12T10:00:01.000Z"),
        ],
      }, NOW),
    ).toBe("Context compaction");
  });

  it("uses present-progress wording for command starts", () => {
    expect(
      deriveBackgroundNotificationText({
        latestTurn: { state: "running" },
        activities: [activity("Ran command started", "2026-08-12T10:00:00.000Z", 1, "tool.started")],
      }, NOW),
    ).toBe("Running command");
  });

  it("uses sequence order when activity timestamps match", () => {
    expect(
      deriveBackgroundNotificationText({
        latestTurn: { state: "running" },
        activities: [
          activity("Older activity", "2026-08-12T10:00:00.000Z", 4),
          activity("Latest activity", "2026-08-12T10:00:00.000Z", 5),
        ],
      }, NOW),
    ).toBe("Latest activity");
  });

  it("falls back to Working after the latest activity becomes stale", () => {
    expect(
      deriveBackgroundNotificationText(
        {
          latestTurn: { state: "running" },
          activities: [activity("Ran command started", "2026-08-12T10:00:00.000Z", 1, "tool.started")],
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
});
