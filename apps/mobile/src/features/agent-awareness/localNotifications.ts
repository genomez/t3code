import type { EnvironmentId, OrchestrationThread } from "@t3tools/contracts";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { buildAgentAwarenessDeepLink } from "@t3tools/shared/agentAwareness";

export const ANDROID_AGENT_NOTIFICATION_CHANNEL_ID = "t3-agent-updates";

let notificationHandlerConfigured = false;
let channelPromise: Promise<void> | null = null;

/** Install the foreground handler for local agent alerts. */
export function configureLocalAgentNotifications(): void {
  if (Platform.OS !== "android" || notificationHandlerConfigured) {
    return;
  }
  notificationHandlerConfigured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

export function ensureAndroidAgentNotificationChannel(): Promise<void> {
  if (Platform.OS !== "android") {
    return Promise.resolve();
  }
  configureLocalAgentNotifications();
  channelPromise ??= Notifications.setNotificationChannelAsync(
    ANDROID_AGENT_NOTIFICATION_CHANNEL_ID,
    {
      enableLights: true,
      enableVibrate: true,
      importance: Notifications.AndroidImportance.DEFAULT,
      lightColor: "#7565C7",
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      name: "T3 agent updates",
      showBadge: true,
      sound: "default",
      vibrationPattern: [0, 250, 250, 250],
    },
  ).then(() => undefined);
  return channelPromise;
}

export async function scheduleAndroidAgentCompletionNotification(input: {
  readonly environmentId: EnvironmentId;
  readonly thread: Pick<OrchestrationThread, "id" | "title" | "latestTurn">;
}): Promise<void> {
  if (Platform.OS !== "android" || input.thread.latestTurn === null) {
    return;
  }

  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) {
    return;
  }

  await ensureAndroidAgentNotificationChannel();
  const failed = input.thread.latestTurn.state === "error";
  await Notifications.scheduleNotificationAsync({
    content: {
      body: input.thread.title,
      color: "#7565C7",
      data: {
        deepLink: buildAgentAwarenessDeepLink({
          environmentId: input.environmentId,
          threadId: input.thread.id,
        }),
        environmentId: input.environmentId,
        threadId: input.thread.id,
      },
      priority: Notifications.AndroidNotificationPriority.HIGH,
      sound: "default",
      title: failed ? "Agent failed" : "Agent finished",
    },
    identifier: `t3-agent-${input.environmentId}-${input.thread.id}-${input.thread.latestTurn.turnId}`,
    trigger: null,
  });
}
