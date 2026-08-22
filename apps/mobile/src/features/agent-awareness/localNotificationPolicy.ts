import type { OrchestrationLatestTurn } from "@t3tools/contracts";

export type AgentTurnSnapshot = Pick<OrchestrationLatestTurn, "turnId" | "state" | "completedAt">;

export const AGENT_COMPLETION_NOTIFICATION_CATCH_UP_WINDOW_MS = 5 * 60 * 1_000;

function isSettled(turn: AgentTurnSnapshot): boolean {
  return turn.state === "completed" || turn.state === "error" || turn.completedAt !== null;
}

/**
 * Returns true only when an already-observed turn becomes terminal. The
 * initial state is deliberately not a notification, so starting the service
 * does not create a false "finished" alert for old work.
 */
export function isAgentTurnSettlement(
  previous: AgentTurnSnapshot | null,
  next: AgentTurnSnapshot | null,
): boolean {
  if (previous === null || next === null || isSettled(previous) || !isSettled(next)) {
    return false;
  }
  return previous.turnId === next.turnId || previous.state === "running";
}

/**
 * Allows a short reconnect catch-up window without presenting an old
 * completion as a new Android notification. Terminal turns without a
 * completion timestamp still fail open because their age cannot be proven.
 */
export function shouldNotifyAgentTurnSettlement(
  previous: AgentTurnSnapshot | null,
  next: AgentTurnSnapshot | null,
  nowMs = Date.now(),
): boolean {
  if (!isAgentTurnSettlement(previous, next) || next === null) {
    return false;
  }
  if (next.completedAt === null) {
    return true;
  }
  const completedAtMs = Date.parse(next.completedAt);
  return (
    Number.isFinite(completedAtMs) &&
    nowMs - completedAtMs <= AGENT_COMPLETION_NOTIFICATION_CATCH_UP_WINDOW_MS
  );
}
