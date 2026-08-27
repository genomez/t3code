import { NativeModule, requireOptionalNativeModule } from "expo";

export interface BackgroundConnectionStatus {
  readonly supported: boolean;
  readonly enabled: boolean;
  readonly serviceRunning: boolean;
  readonly runtimeReady: boolean;
  readonly batteryOptimizationIgnored: boolean;
}

export interface BackgroundConnectionNotificationContent {
  readonly title: string;
  readonly body: string;
}

export interface AgentNotificationReply {
  readonly replyId: string;
  readonly environmentId: string;
  readonly threadId: string;
  readonly text: string;
  readonly createdAtEpochMs: number;
}

type BackgroundConnectionNativeEvents = {
  readonly onStatusChange: (status: BackgroundConnectionStatus) => void;
  readonly onStopRequested: () => void;
  readonly onAgentReplyAvailable: () => void;
};

declare class BackgroundConnectionNativeModule extends NativeModule<BackgroundConnectionNativeEvents> {
  readonly getStatus?: () => BackgroundConnectionStatus;
  readonly setEnabled?: (enabled: boolean) => Promise<BackgroundConnectionStatus>;
  readonly setNotificationText?: (text: string | null) => BackgroundConnectionStatus;
  readonly setNotificationContent?: (
    title: string | null,
    body: string | null,
  ) => BackgroundConnectionStatus;
  readonly postAgentNotification?: (
    tag: string,
    title: string,
    body: string,
    deepLink: string,
    environmentId: string,
    threadId: string,
  ) => void;
  readonly dismissAgentNotification?: (tag: string) => void;
  readonly getPendingAgentReplies?: () => ReadonlyArray<unknown>;
  readonly acknowledgeAgentReply?: (replyId: string) => boolean;
  readonly ensureStarted?: () => BackgroundConnectionStatus;
  readonly requestBatteryOptimizationExemption?: () => Promise<BackgroundConnectionStatus>;
  readonly setRuntimeReady?: (ready: boolean) => BackgroundConnectionStatus;
  readonly acknowledgeStop?: () => BackgroundConnectionStatus;
}

export interface BackgroundConnectionSubscription {
  readonly remove: () => void;
}

const UNSUPPORTED_STATUS: BackgroundConnectionStatus = {
  supported: false,
  enabled: false,
  serviceRunning: false,
  runtimeReady: false,
  batteryOptimizationIgnored: false,
};

let cachedNativeModule: BackgroundConnectionNativeModule | null | undefined;

function getNativeModule(): BackgroundConnectionNativeModule | null {
  if (cachedNativeModule !== undefined) return cachedNativeModule;
  try {
    cachedNativeModule =
      requireOptionalNativeModule<BackgroundConnectionNativeModule>("T3BackgroundConnection");
  } catch {
    cachedNativeModule = null;
  }
  return cachedNativeModule;
}

function normalizeStatus(status: BackgroundConnectionStatus | null | undefined) {
  if (status?.supported !== true) return UNSUPPORTED_STATUS;
  return {
    supported: true,
    enabled: status.enabled === true,
    serviceRunning: status.serviceRunning === true,
    runtimeReady: status.runtimeReady === true,
    batteryOptimizationIgnored: status.batteryOptimizationIgnored === true,
  } satisfies BackgroundConnectionStatus;
}

export function getBackgroundConnectionStatus(): BackgroundConnectionStatus {
  try {
    return normalizeStatus(getNativeModule()?.getStatus?.());
  } catch {
    return UNSUPPORTED_STATUS;
  }
}

export async function setBackgroundConnectionEnabled(
  enabled: boolean,
): Promise<BackgroundConnectionStatus> {
  try {
    const nativeModule = getNativeModule();
    if (!nativeModule?.setEnabled) return UNSUPPORTED_STATUS;
    return normalizeStatus(await nativeModule.setEnabled(enabled));
  } catch {
    return getBackgroundConnectionStatus();
  }
}

export function setBackgroundConnectionNotificationText(text: string | null): void {
  try {
    getNativeModule()?.setNotificationText?.(text);
  } catch {
    // Notification status is best-effort and must not interrupt the connection.
  }
}

export function setBackgroundConnectionNotificationContent(
  content: BackgroundConnectionNotificationContent,
): void {
  try {
    const nativeModule = getNativeModule();
    if (nativeModule?.setNotificationContent) {
      nativeModule.setNotificationContent(content.title, content.body);
      return;
    }
    // Keep the JS bundle compatible with an older installed test APK while a
    // native module update is being rolled out.
    nativeModule?.setNotificationText?.(content.body);
  } catch {
    // Notification status is best-effort and must not interrupt the connection.
  }
}

/**
 * Native Android notifications use a stable tag/id pair, so a later result
 * for the same thread replaces its earlier completion alert instead of adding
 * another card. Returning false keeps the Expo fallback available on older
 * development installs.
 */
export function postBackgroundConnectionAgentNotification(
  tag: string,
  title: string,
  body: string,
  deepLink: string,
  environmentId: string,
  threadId: string,
): boolean {
  try {
    const nativeModule = getNativeModule();
    if (!nativeModule?.postAgentNotification) return false;
    nativeModule.postAgentNotification(tag, title, body, deepLink, environmentId, threadId);
    return true;
  } catch {
    return false;
  }
}

function normalizeAgentNotificationReply(value: unknown): AgentNotificationReply | null {
  if (typeof value !== "object" || value === null) return null;
  const reply = value as Record<string, unknown>;
  if (
    typeof reply.replyId !== "string" ||
    typeof reply.environmentId !== "string" ||
    typeof reply.threadId !== "string" ||
    typeof reply.text !== "string" ||
    typeof reply.createdAtEpochMs !== "number" ||
    !Number.isFinite(reply.createdAtEpochMs)
  ) {
    return null;
  }
  return {
    replyId: reply.replyId,
    environmentId: reply.environmentId,
    threadId: reply.threadId,
    text: reply.text,
    createdAtEpochMs: reply.createdAtEpochMs,
  };
}

export function getPendingAgentNotificationReplies(): ReadonlyArray<AgentNotificationReply> {
  try {
    return (getNativeModule()?.getPendingAgentReplies?.() ?? [])
      .map(normalizeAgentNotificationReply)
      .filter((reply): reply is AgentNotificationReply => reply !== null);
  } catch {
    return [];
  }
}

export function acknowledgeAgentNotificationReply(replyId: string): boolean {
  try {
    return getNativeModule()?.acknowledgeAgentReply?.(replyId) === true;
  } catch {
    return false;
  }
}

/** Best-effort, thread-scoped completion dismissal for direct navigation. */
export function dismissBackgroundConnectionAgentNotification(tag: string): void {
  try {
    getNativeModule()?.dismissAgentNotification?.(tag);
  } catch {
    // Navigation must remain usable if the native module is unavailable.
  }
}

export function ensureBackgroundConnectionStarted(): BackgroundConnectionStatus {
  try {
    return normalizeStatus(getNativeModule()?.ensureStarted?.());
  } catch {
    return getBackgroundConnectionStatus();
  }
}

export async function requestBackgroundConnectionBatteryOptimizationExemption(): Promise<BackgroundConnectionStatus> {
  try {
    const nativeModule = getNativeModule();
    if (!nativeModule?.requestBatteryOptimizationExemption) return UNSUPPORTED_STATUS;
    return normalizeStatus(await nativeModule.requestBatteryOptimizationExemption());
  } catch {
    return getBackgroundConnectionStatus();
  }
}

export function setBackgroundConnectionRuntimeReady(ready: boolean): BackgroundConnectionStatus {
  try {
    return normalizeStatus(getNativeModule()?.setRuntimeReady?.(ready));
  } catch {
    return getBackgroundConnectionStatus();
  }
}

export function acknowledgeBackgroundConnectionStop(): BackgroundConnectionStatus {
  try {
    return normalizeStatus(getNativeModule()?.acknowledgeStop?.());
  } catch {
    return getBackgroundConnectionStatus();
  }
}

export function addBackgroundConnectionStatusListener(
  listener: (status: BackgroundConnectionStatus) => void,
): BackgroundConnectionSubscription {
  try {
    const nativeModule = getNativeModule();
    if (!nativeModule) return NOOP_SUBSCRIPTION;
    return nativeModule.addListener("onStatusChange", (status) => {
      listener(normalizeStatus(status));
    });
  } catch {
    return NOOP_SUBSCRIPTION;
  }
}

export function addBackgroundConnectionStopRequestListener(
  listener: () => void,
): BackgroundConnectionSubscription {
  try {
    return getNativeModule()?.addListener("onStopRequested", listener) ?? NOOP_SUBSCRIPTION;
  } catch {
    return NOOP_SUBSCRIPTION;
  }
}

export function addAgentNotificationReplyAvailableListener(
  listener: () => void,
): BackgroundConnectionSubscription {
  try {
    return getNativeModule()?.addListener("onAgentReplyAvailable", listener) ?? NOOP_SUBSCRIPTION;
  } catch {
    return NOOP_SUBSCRIPTION;
  }
}

const NOOP_SUBSCRIPTION: BackgroundConnectionSubscription = {
  remove() {},
};
