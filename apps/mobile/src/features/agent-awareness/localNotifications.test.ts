import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { androidAgentNotificationIdentifier } from "./localNotificationIdentifier";

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
