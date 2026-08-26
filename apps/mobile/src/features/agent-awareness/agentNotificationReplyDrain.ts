import { CommandId, EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";

import {
  acknowledgeAgentNotificationReply,
  addAgentNotificationReplyAvailableListener,
  getPendingAgentNotificationReplies,
  type AgentNotificationReply,
  type BackgroundConnectionSubscription,
} from "../../native/backgroundConnection";
import { enqueueThreadOutboxMessage } from "../../state/thread-outbox";
import type { QueuedThreadMessage } from "../../state/thread-outbox-model";

const MAX_AGENT_NOTIFICATION_REPLY_LENGTH = 16_384;
const RETRY_DELAY_MS = 1_000;

export function queuedMessageFromAgentNotificationReply(
  reply: AgentNotificationReply,
): QueuedThreadMessage | null {
  const text = reply.text.trim();
  if (
    reply.replyId.length === 0 ||
    reply.environmentId.length === 0 ||
    reply.threadId.length === 0 ||
    text.length === 0 ||
    text.length > MAX_AGENT_NOTIFICATION_REPLY_LENGTH
  ) {
    return null;
  }

  let createdAt: string;
  try {
    createdAt = new Date(reply.createdAtEpochMs).toISOString();
  } catch {
    return null;
  }

  return {
    environmentId: EnvironmentId.make(reply.environmentId),
    threadId: ThreadId.make(reply.threadId),
    messageId: MessageId.make(`agent-notification-reply-message:${reply.replyId}`),
    commandId: CommandId.make(`agent-notification-reply-command:${reply.replyId}`),
    text,
    attachments: [],
    deferWhileBusy: true,
    createdAt,
  };
}

export async function transferPendingAgentNotificationReplies(input: {
  readonly pending: ReadonlyArray<AgentNotificationReply>;
  readonly enqueue: (message: QueuedThreadMessage) => Promise<void>;
  readonly acknowledge: (replyId: string) => boolean;
}): Promise<boolean> {
  for (const reply of input.pending) {
    const message = queuedMessageFromAgentNotificationReply(reply);
    if (message === null) {
      if (!input.acknowledge(reply.replyId)) return false;
      continue;
    }
    try {
      await input.enqueue(message);
      if (!input.acknowledge(reply.replyId)) return false;
    } catch (error) {
      console.warn("[agent-notification-reply] durable outbox transfer failed", {
        replyId: reply.replyId,
        environmentId: reply.environmentId,
        threadId: reply.threadId,
        error,
      });
      return false;
    }
  }
  return true;
}

let active = false;
let draining: Promise<void> | null = null;
let drainRequested = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let subscription: BackgroundConnectionSubscription | null = null;

function clearRetry(): void {
  if (retryTimer === null) return;
  clearTimeout(retryTimer);
  retryTimer = null;
}

function scheduleRetry(): void {
  if (!active || retryTimer !== null) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    requestDrain();
  }, RETRY_DELAY_MS);
}

function requestDrain(): void {
  if (!active) return;
  if (draining !== null) {
    drainRequested = true;
    return;
  }
  drainRequested = false;
  draining = transferPendingAgentNotificationReplies({
    pending: getPendingAgentNotificationReplies(),
    enqueue: enqueueThreadOutboxMessage,
    acknowledge: acknowledgeAgentNotificationReply,
  })
    .then((complete) => {
      if (complete) clearRetry();
      else scheduleRetry();
    })
    .finally(() => {
      draining = null;
      if (drainRequested) requestDrain();
    });
}

export function acquireAgentNotificationReplyDrain(): () => void {
  if (active) {
    throw new Error("Agent notification reply drain already acquired");
  }
  active = true;
  subscription = addAgentNotificationReplyAvailableListener(requestDrain);
  requestDrain();

  return () => {
    if (!active) return;
    active = false;
    drainRequested = false;
    clearRetry();
    subscription?.remove();
    subscription = null;
  };
}
