import { EnvironmentId, ThreadId, WS_METHODS } from "@t3tools/contracts";
import { afterEach, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { resolveActiveThreadRouteRef, resolveThreadRouteTarget } from "../threadRoutes.ts";
import {
  backgroundActivityScopes,
  observeBackgroundActivitySubscription,
  retainedBackgroundScopes,
  setBackgroundActivityFocusedThread,
  wasRecentlyInteracted,
} from "./backgroundActivityReporter.ts";

afterEach(() => {
  setBackgroundActivityFocusedThread(null);
});

describe("wasRecentlyInteracted", () => {
  it("expires interaction independently of window focus", () => {
    expect(wasRecentlyInteracted(10_000, 55_000)).toBe(true);
    expect(wasRecentlyInteracted(10_000, 55_001)).toBe(false);
  });

  it("rejects future timestamps", () => {
    expect(wasRecentlyInteracted(10_001, 10_000)).toBe(false);
  });

  it("reports the canonical Windows route as an environment-scoped thread lease", () => {
    const environmentId = EnvironmentId.make("environment-focused-route");
    const routeTarget = resolveThreadRouteTarget({
      environmentId,
      threadId: ThreadId.make("thread-focused-route"),
    });
    const focusedThread = resolveActiveThreadRouteRef(routeTarget, null);

    setBackgroundActivityFocusedThread(focusedThread);

    expect(backgroundActivityScopes(environmentId)).toContainEqual({
      type: "thread",
      threadId: ThreadId.make("thread-focused-route"),
    });
  });

  it("reports a promoted draft route as its canonical Windows thread lease", () => {
    const environmentId = EnvironmentId.make("environment-promoted-draft");
    const routeTarget = resolveThreadRouteTarget({ draftId: "draft-route" });
    const focusedThread = resolveActiveThreadRouteRef(routeTarget, {
      environmentId,
      threadId: ThreadId.make("reserved-draft-thread"),
      promotedTo: {
        environmentId,
        threadId: ThreadId.make("promoted-server-thread"),
      },
    });

    setBackgroundActivityFocusedThread(focusedThread);

    expect(backgroundActivityScopes(environmentId)).toContainEqual({
      type: "thread",
      threadId: ThreadId.make("promoted-server-thread"),
    });
    expect(backgroundActivityScopes(EnvironmentId.make("another-environment"))).not.toContainEqual({
      type: "thread",
      threadId: ThreadId.make("promoted-server-thread"),
    });
  });

  it.effect("retains an observed subscription until its returned finalizer runs", () =>
    Effect.gen(function* () {
      const environmentId = EnvironmentId.make("environment-observation-test");
      const scope = { type: "vcs-status" as const, cwd: "/repo" };
      const release = yield* observeBackgroundActivitySubscription({
        environmentId,
        method: WS_METHODS.subscribeVcsStatus,
        input: { cwd: scope.cwd },
      });

      expect(retainedBackgroundScopes(environmentId)).toEqual([scope]);

      yield* release;
      expect(retainedBackgroundScopes(environmentId)).toEqual([]);
    }),
  );

  it.effect("keeps delimiter-containing environment and scope values distinct", () =>
    Effect.gen(function* () {
      const firstEnvironmentId = EnvironmentId.make("a");
      const secondEnvironmentId = EnvironmentId.make("a:vcs-status:b");
      const releaseFirst = yield* observeBackgroundActivitySubscription({
        environmentId: firstEnvironmentId,
        method: WS_METHODS.subscribeVcsStatus,
        input: { cwd: "b:vcs-status:c" },
      });
      const releaseSecond = yield* observeBackgroundActivitySubscription({
        environmentId: secondEnvironmentId,
        method: WS_METHODS.subscribeVcsStatus,
        input: { cwd: "c" },
      });

      expect(retainedBackgroundScopes(firstEnvironmentId)).toEqual([
        { type: "vcs-status", cwd: "b:vcs-status:c" },
      ]);
      expect(retainedBackgroundScopes(secondEnvironmentId)).toEqual([
        { type: "vcs-status", cwd: "c" },
      ]);

      yield* Effect.all([releaseFirst, releaseSecond]);
    }),
  );
});
