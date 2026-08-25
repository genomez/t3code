import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

import { buildAgentAwarenessDeepLink } from "@t3tools/shared/agentAwareness";

const ABSOLUTE_URI_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;

export interface AndroidAgentNotificationDeepLinks {
  /** Relative route consumed by the Expo notification-response fallback. */
  readonly routePath: string;
  /** Absolute, manifest-resolvable URI consumed by Android ACTION_VIEW. */
  readonly nativeUri: string | null;
}

export function buildAndroidAgentNotificationDeepLinks(
  input: { readonly environmentId: EnvironmentId; readonly threadId: ThreadId },
  createUrl: (path: string) => string,
): AndroidAgentNotificationDeepLinks {
  const routePath = buildAgentAwarenessDeepLink(input);
  const candidate = createUrl(routePath);
  return {
    routePath,
    nativeUri: ABSOLUTE_URI_PATTERN.test(candidate) ? candidate : null,
  };
}
