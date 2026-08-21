import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { androidAgentNotificationIdentifier } from "./localNotificationIdentifier";
import { buildAndroidAgentNotificationDeepLinks } from "./notificationDeepLink";

const environmentId = "environment-1" as EnvironmentId;
const threadOneId = "thread-1" as ThreadId;
const threadTwoId = "thread-2" as ThreadId;

describe("local agent notification identifiers", () => {
  it("uses one replacement slot for repeated turns in the same thread", () => {
    expect(androidAgentNotificationIdentifier(environmentId, threadOneId)).toBe(
      "t3-agent-environment-1-thread-1",
    );
    expect(androidAgentNotificationIdentifier(environmentId, threadOneId)).toBe(
      androidAgentNotificationIdentifier(environmentId, threadOneId),
    );
  });

  it("keeps different threads in separate slots", () => {
    expect(androidAgentNotificationIdentifier(environmentId, threadOneId)).not.toBe(
      androidAgentNotificationIdentifier(environmentId, threadTwoId),
    );
  });
});

describe("Android agent notification deep links", () => {
  it("keeps the Expo route relative and gives ACTION_VIEW an absolute variant URI", () => {
    const links = buildAndroidAgentNotificationDeepLinks(
      { environmentId, threadId: threadOneId },
      (path) => `t3code-preview://${path}`,
    );

    expect(links).toEqual({
      routePath: "/threads/environment-1/thread-1",
      nativeUri: "t3code-preview:///threads/environment-1/thread-1",
    });
  });

  it("rejects a route-only native URI so the caller can use the Expo fallback", () => {
    const links = buildAndroidAgentNotificationDeepLinks(
      { environmentId, threadId: threadOneId },
      (path) => path,
    );

    expect(links.nativeUri).toBeNull();
    expect(links.routePath).toBe("/threads/environment-1/thread-1");
  });
});
