import type { EnvironmentRegistry } from "@t3tools/client-runtime/connection";
import { request } from "@t3tools/client-runtime/rpc";
import {
  type BackgroundPolicySnapshot,
  type EnvironmentId,
  type ThreadId,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { runtime } from "../../lib/runtime";
import { isAndroidForegroundThread, isWindowsForegroundThread } from "./foregroundThread";

let environmentRegistry: EnvironmentRegistry["Service"] | null = null;

/**
 * Makes the connection registry available to the notification path without
 * coupling the background root to the React connection provider. The returned
 * cleanup cannot erase a newer registry instance.
 */
export function setCompletionNotificationPolicyRegistry(
  next: EnvironmentRegistry["Service"],
): () => void {
  environmentRegistry = next;
  return () => {
    if (environmentRegistry === next) {
      environmentRegistry = null;
    }
  };
}

/**
 * Suppress only when Android itself is displaying the exact thread, or when
 * the shared server reports an exact visible, focused desktop thread. Network
 * and policy lookup failures deliberately fail open.
 */
export async function shouldSuppressAndroidCompletionNotification(ref: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}): Promise<boolean> {
  if (isAndroidForegroundThread(ref)) {
    return true;
  }

  const registry = environmentRegistry;
  if (registry === null) {
    return false;
  }

  try {
    const policy = await runtime.runPromise(
      registry
        .run(ref.environmentId, request(WS_METHODS.serverGetBackgroundPolicy, {}))
        .pipe(Effect.catch(() => Effect.succeed(null))),
    );
    return (
      policy !== null &&
      policy !== undefined &&
      isWindowsForegroundThread(policy as BackgroundPolicySnapshot, ref)
    );
  } catch {
    return false;
  }
}
