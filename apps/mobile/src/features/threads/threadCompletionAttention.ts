import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";

import { scopedThreadKey } from "../../lib/scopedEntities";

export const completionAttentionSessionStartedAt = new Date().toISOString();

export interface ThreadCompletionAttentionState {
  readonly completionAttentionStartedAt?: string;
  readonly threadLastVisitedAtById?: Readonly<Record<string, string>>;
}

function timestampMs(value: string | null | undefined): number | null {
  if (value == null) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function hasUnseenThreadCompletion(
  thread: Pick<EnvironmentThreadShell, "environmentId" | "id" | "latestTurn">,
  state: ThreadCompletionAttentionState,
): boolean {
  const completedAtMs = timestampMs(thread.latestTurn?.completedAt);
  if (completedAtMs === null) return false;

  const key = scopedThreadKey(thread.environmentId, thread.id);
  const visitedAtMs = timestampMs(state.threadLastVisitedAtById?.[key]);
  const attentionStartedAtMs = timestampMs(state.completionAttentionStartedAt);
  const readWatermarkMs = visitedAtMs ?? attentionStartedAtMs;
  return readWatermarkMs !== null && completedAtMs > readWatermarkMs;
}

export function threadCompletionVisitPatch(
  state: ThreadCompletionAttentionState,
  thread: Pick<EnvironmentThreadShell, "environmentId" | "id" | "latestTurn">,
  visitedAt: string,
): Pick<ThreadCompletionAttentionState, "threadLastVisitedAtById"> | null {
  const completedAtMs = timestampMs(thread.latestTurn?.completedAt);
  const visitedAtMs = timestampMs(visitedAt);
  if (completedAtMs === null || visitedAtMs === null || visitedAtMs < completedAtMs) {
    return null;
  }

  const key = scopedThreadKey(thread.environmentId, thread.id);
  const priorVisitedAt = state.threadLastVisitedAtById?.[key];
  const priorVisitedAtMs = timestampMs(priorVisitedAt);
  if (priorVisitedAtMs !== null && priorVisitedAtMs >= completedAtMs) {
    return null;
  }

  return {
    threadLastVisitedAtById: {
      ...state.threadLastVisitedAtById,
      [key]: visitedAt,
    },
  };
}
