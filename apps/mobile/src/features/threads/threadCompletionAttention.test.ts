import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { hasUnseenThreadCompletion, threadCompletionVisitPatch } from "./threadCompletionAttention";

function thread(input: {
  environmentId?: string;
  threadId?: string;
  completedAt: string | null;
}): Pick<EnvironmentThreadShell, "environmentId" | "id" | "latestTurn"> {
  return {
    environmentId: EnvironmentId.make(input.environmentId ?? "environment-1"),
    id: ThreadId.make(input.threadId ?? "thread-1"),
    latestTurn:
      input.completedAt === null
        ? null
        : ({ completedAt: input.completedAt } as EnvironmentThreadShell["latestTurn"]),
  };
}

describe("mobile thread completion attention", () => {
  it("marks a completion after feature activation as unseen", () => {
    expect(
      hasUnseenThreadCompletion(thread({ completedAt: "2026-08-21T12:00:01.000Z" }), {
        completionAttentionStartedAt: "2026-08-21T12:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("does not relabel historical completions from before activation", () => {
    expect(
      hasUnseenThreadCompletion(thread({ completedAt: "2026-08-21T11:59:59.000Z" }), {
        completionAttentionStartedAt: "2026-08-21T12:00:00.000Z",
      }),
    ).toBe(false);
  });

  it("clears only the exact environment and thread after it is visited", () => {
    const target = thread({ completedAt: "2026-08-21T12:00:01.000Z" });
    const patch = threadCompletionVisitPatch(
      { completionAttentionStartedAt: "2026-08-21T12:00:00.000Z" },
      target,
      "2026-08-21T12:00:02.000Z",
    );

    expect(patch).not.toBeNull();
    expect(hasUnseenThreadCompletion(target, { ...patch })).toBe(false);
    expect(
      hasUnseenThreadCompletion(
        thread({
          environmentId: "environment-2",
          completedAt: "2026-08-21T12:00:01.000Z",
        }),
        { completionAttentionStartedAt: "2026-08-21T12:00:00.000Z", ...patch },
      ),
    ).toBe(true);
  });

  it("raises attention again for a later completion", () => {
    expect(
      hasUnseenThreadCompletion(thread({ completedAt: "2026-08-21T12:00:03.000Z" }), {
        completionAttentionStartedAt: "2026-08-21T12:00:00.000Z",
        threadLastVisitedAtById: {
          "environment-1:thread-1": "2026-08-21T12:00:02.000Z",
        },
      }),
    ).toBe(true);
  });

  it("does not record a visit before the completion or rewrite an already-read completion", () => {
    const target = thread({ completedAt: "2026-08-21T12:00:02.000Z" });
    expect(threadCompletionVisitPatch({}, target, "2026-08-21T12:00:01.000Z")).toBeNull();
    expect(
      threadCompletionVisitPatch(
        { threadLastVisitedAtById: { "environment-1:thread-1": "2026-08-21T12:00:03.000Z" } },
        target,
        "2026-08-21T12:00:04.000Z",
      ),
    ).toBeNull();
  });
});
