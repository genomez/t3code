import type { EnvironmentId, OrchestrationThread } from "@t3tools/contracts";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { buildAgentAwarenessDeepLink } from "@t3tools/shared/agentAwareness";
import { androidAgentNotificationIdentifier } from "./localNotificationIdentifier";
import { buildAndroidAgentNotificationText } from "./localNotificationContent";
import {
  dismissBackgroundConnectionAgentNotification,
  postBackgroundConnectionAgentNotification,
} from "../../native/backgroundConnection";

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
  readonly thread: Pick<OrchestrationThread, "id" | "title" | "latestTurn" | "messages">;
  readonly silent?: boolean;
}): Promise<void> {
  if (Platform.OS !== "android" || input.thread.latestTurn === null) {
    return;
  }

  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) {
    return;
  }

  await ensureAndroidAgentNotificationChannel();
  const notificationText = buildAndroidAgentNotificationText(input.thread);
  const identifier = androidAgentNotificationIdentifier(input.environmentId, input.thread.id);
  const deepLink = buildAgentAwarenessDeepLink({
    environmentId: input.environmentId,
    threadId: input.thread.id,
  });

  // Expo's scheduler can retain separate native records even with a stable
  // JS identifier. The native tag/id route guarantees replacement per thread
  // and keeps completion alerts in a group distinct from the ongoing service.
  if (
    postBackgroundConnectionAgentNotification(
      identifier,
      notificationText.title,
      notificationText.body,
      deepLink,
    )
  ) {
    return;
  }

  await Notifications.scheduleNotificationAsync({
    content: {
      body: notificationText.body,
      color: "#7565C7",
      data: {
        deepLink,
        environmentId: input.environmentId,
        threadId: input.thread.id,
      },
      priority: input.silent
        ? Notifications.AndroidNotificationPriority.DEFAULT
        : Notifications.AndroidNotificationPriority.HIGH,
      sound: input.silent ? false : "default",
      title: notificationText.title,
    },
    identifier,
    trigger: null,
  });
}

/** Dismiss only this thread's completion alert when it is opened directly. */
export async function dismissAndroidAgentCompletionNotification(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: OrchestrationThread["id"];
}): Promise<void> {
  if (Platform.OS !== "android") {
    return;
  }

  const identifier = androidAgentNotificationIdentifier(input.environmentId, input.threadId);
  dismissBackgroundConnectionAgentNotification(identifier);

  const presentedNotifications = await Notifications.getPresentedNotificationsAsync();
  const matchingNotification = presentedNotifications.find((candidate) => {
    const data = candidate.request.content.data;
    return data?.environmentId === input.environmentId && data?.threadId === input.threadId;
  });
  await Notifications.dismissNotificationAsync(
    matchingNotification?.request.identifier ?? identifier,
  );
}
