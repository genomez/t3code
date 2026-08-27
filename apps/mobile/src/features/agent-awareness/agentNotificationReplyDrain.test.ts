import { describe, expect, it, vi } from "vite-plus/test";

import type { AgentNotificationReply } from "../../native/backgroundConnection";

vi.mock("../../native/backgroundConnection", () => ({
  acknowledgeAgentNotificationReply: vi.fn(),
  addAgentNotificationReplyAvailableListener: vi.fn(() => ({ remove: vi.fn() })),
  getPendingAgentNotificationReplies: vi.fn(() => []),
}));
vi.mock("../../state/thread-outbox", () => ({
  enqueueThreadOutboxMessage: vi.fn(() => Promise.resolve()),
}));

import {
  queuedMessageFromAgentNotificationReply,
  transferPendingAgentNotificationReplies,
} from "./agentNotificationReplyDrain";

function reply(overrides: Partial<AgentNotificationReply> = {}): AgentNotificationReply {
  return {
    replyId: "reply-1",
    environmentId: "environment-1",
    threadId: "thread-1",
    text: "  Continue with the guarded check.  ",
    createdAtEpochMs: Date.parse("2026-08-26T12:00:00.000Z"),
    ...overrides,
  };
}

describe("agent notification reply drain", () => {
  it("builds a deterministic exact-thread message that waits behind active work", () => {
    expect(queuedMessageFromAgentNotificationReply(reply())).toEqual({
      environmentId: "environment-1",
      threadId: "thread-1",
      messageId: "agent-notification-reply-message:reply-1",
      commandId: "agent-notification-reply-command:reply-1",
      text: "Continue with the guarded check.",
      attachments: [],
      deferWhileBusy: true,
      createdAt: "2026-08-26T12:00:00.000Z",
    });
  });

  it("rejects blank, oversized, and invalid-time replies", () => {
    expect(queuedMessageFromAgentNotificationReply(reply({ text: "  " }))).toBeNull();
    expect(queuedMessageFromAgentNotificationReply(reply({ text: "x".repeat(16_385) }))).toBeNull();
    expect(
      queuedMessageFromAgentNotificationReply(reply({ createdAtEpochMs: Number.NaN })),
    ).toBeNull();
  });

  it("acknowledges native storage only after the durable outbox write", async () => {
    const order: string[] = [];
    const enqueue = vi.fn(async () => {
      order.push("enqueue");
    });
    const acknowledge = vi.fn(() => {
      order.push("acknowledge");
      return true;
    });

    await expect(
      transferPendingAgentNotificationReplies({ pending: [reply()], enqueue, acknowledge }),
    ).resolves.toBe(true);
    expect(order).toEqual(["enqueue", "acknowledge"]);
  });

  it("retains the native reply when the outbox write fails", async () => {
    const enqueue = vi.fn(() => Promise.reject(new Error("storage unavailable")));
    const acknowledge = vi.fn(() => true);

    await expect(
      transferPendingAgentNotificationReplies({ pending: [reply()], enqueue, acknowledge }),
    ).resolves.toBe(false);
    expect(acknowledge).not.toHaveBeenCalled();
  });
});
