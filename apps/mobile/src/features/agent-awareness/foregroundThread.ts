import type {
  BackgroundPolicySnapshot,
  EnvironmentId,
  ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";
import { AppState } from "react-native";

let focusedThread: ScopedThreadRef | null = null;

/**
 * Tracks the Android route currently visible to the user. This deliberately
 * fails open: a notification is suppressed only when the app is active and
 * the exact environment/thread is focused.
 */
export function setAndroidForegroundThread(ref: ScopedThreadRef): () => void {
  focusedThread = ref;
  return () => {
    if (
      focusedThread?.environmentId === ref.environmentId &&
      focusedThread.threadId === ref.threadId
    ) {
      focusedThread = null;
    }
  };
}

export function isAndroidForegroundThread(ref: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}): boolean {
  return (
    AppState.currentState === "active" &&
    focusedThread?.environmentId === ref.environmentId &&
    focusedThread.threadId === ref.threadId
  );
}

/**
 * A remote desktop lease is meaningful only when it names this exact thread
 * and the desktop client is both visible and focused. Every ambiguous policy
 * shape intentionally evaluates to false so completion delivery fails open.
 */
export function isWindowsForegroundThread(
  policy: Pick<BackgroundPolicySnapshot, "leases">,
  ref: {
    readonly environmentId: EnvironmentId;
    readonly threadId: ThreadId;
  },
): boolean {
  return policy.leases.some(
    (lease) =>
      lease.clientKind === "desktop-renderer" &&
      lease.visible &&
      lease.focused &&
      lease.scopes.some((scope) => scope.type === "thread" && scope.threadId === ref.threadId),
  );
}

/** Test-only reset for the module-scoped navigation snapshot. */
export function __resetAndroidForegroundThreadForTests(): void {
  focusedThread = null;
}
