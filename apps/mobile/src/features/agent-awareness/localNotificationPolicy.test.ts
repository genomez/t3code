import { describe, expect, it } from "vite-plus/test";

import {
  AGENT_COMPLETION_NOTIFICATION_CATCH_UP_WINDOW_MS,
  isAgentTurnSettlement,
  shouldNotifyAgentTurnSettlement,
} from "./localNotificationPolicy";

const running = {
  completedAt: null,
  state: "running" as const,
  turnId: "turn-1" as never,
};

describe("isAgentTurnSettlement", () => {
  it("does not notify for the initial settled snapshot", () => {
    expect(isAgentTurnSettlement(null, { ...running, state: "completed" })).toBe(false);
  });

  it("notifies when a running turn completes", () => {
    expect(
      isAgentTurnSettlement(running, {
        ...running,
        completedAt: "2026-08-12T12:00:00.000Z",
        state: "completed",
      }),
    ).toBe(true);
  });

  it("notifies when a running turn fails", () => {
    expect(isAgentTurnSettlement(running, { ...running, state: "error" })).toBe(true);
  });

  it("does not duplicate a settled turn", () => {
    const completed = {
      ...running,
      completedAt: "2026-08-12T12:00:00.000Z",
      state: "completed" as const,
    };
    expect(isAgentTurnSettlement(completed, completed)).toBe(false);
  });
});

describe("shouldNotifyAgentTurnSettlement", () => {
  const nowMs = Date.parse("2026-08-22T02:00:00.000Z");

  it("notifies for a completion inside the reconnect catch-up window", () => {
    expect(
      shouldNotifyAgentTurnSettlement(
        running,
        {
          ...running,
          completedAt: new Date(
            nowMs - AGENT_COMPLETION_NOTIFICATION_CATCH_UP_WINDOW_MS,
          ).toISOString(),
          state: "completed",
        },
        nowMs,
      ),
    ).toBe(true);
  });

  it("suppresses a stale completion observed after reconnect", () => {
    expect(
      shouldNotifyAgentTurnSettlement(
        running,
        {
          ...running,
          completedAt: new Date(
            nowMs - AGENT_COMPLETION_NOTIFICATION_CATCH_UP_WINDOW_MS - 1,
          ).toISOString(),
          state: "completed",
        },
        nowMs,
      ),
    ).toBe(false);
  });

  it("keeps terminal errors without a completion timestamp deliverable", () => {
    expect(shouldNotifyAgentTurnSettlement(running, { ...running, state: "error" }, nowMs)).toBe(
      true,
    );
  });

  it("suppresses an invalid completion timestamp", () => {
    expect(
      shouldNotifyAgentTurnSettlement(
        running,
        { ...running, completedAt: "invalid", state: "completed" },
        nowMs,
      ),
    ).toBe(false);
  });
});
