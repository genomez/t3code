import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { describe, expect, it } from "vite-plus/test";

import { resolveThreadStatus } from "./threadPresentation";

const readyThread = {
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  session: null,
  latestTurn: null,
  interactionMode: "default",
  hasActionableProposedPlan: false,
} as EnvironmentThreadShell;

describe("legacy mobile thread status", () => {
  it("shows Done for an unvisited completion", () => {
    expect(resolveThreadStatus(readyThread, { hasUnseenCompletion: true })?.kind).toBe("done");
    expect(resolveThreadStatus(readyThread, { hasUnseenCompletion: true })?.label).toBe("Done");
  });

  it("keeps actionable status ahead of completion attention", () => {
    expect(
      resolveThreadStatus(
        { ...readyThread, hasPendingApprovals: true },
        { hasUnseenCompletion: true },
      )?.kind,
    ).toBe("pending-approval");
  });
});
