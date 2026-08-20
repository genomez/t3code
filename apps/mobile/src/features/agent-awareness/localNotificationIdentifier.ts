import type { EnvironmentId, OrchestrationThread } from "@t3tools/contracts";

/**
 * Keep one completion notification slot per environment/thread. A later turn
 * on the same thread replaces the previous Android notification instead of
 * adding another card, while different threads remain independently visible.
 */
export function androidAgentNotificationIdentifier(
  environmentId: EnvironmentId,
  threadId: OrchestrationThread["id"],
): string {
  return `t3-agent-${environmentId}-${threadId}`;
}
