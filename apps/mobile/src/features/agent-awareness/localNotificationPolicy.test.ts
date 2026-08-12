import { describe, expect, it } from "vite-plus/test";

import { isAgentTurnSettlement } from "./localNotificationPolicy";

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
    const completed = { ...running, completedAt: "2026-08-12T12:00:00.000Z", state: "completed" as const };
    expect(isAgentTurnSettlement(completed, completed)).toBe(false);
  });
});
