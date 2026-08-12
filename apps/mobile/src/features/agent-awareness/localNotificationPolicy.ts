import type { OrchestrationLatestTurn } from "@t3tools/contracts";

export type AgentTurnSnapshot = Pick<
  OrchestrationLatestTurn,
  "turnId" | "state" | "completedAt"
>;

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
