import type {
  DesktopNotificationShowInput,
  DesktopNotificationShowResult,
  DesktopNotificationTarget,
} from "@t3tools/contracts";
import {
  formatAgentNotificationContent,
  formatAgentNotificationTestContent,
  type AgentNotificationContent,
} from "@t3tools/shared/agentAwareness";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as Electron from "electron";

import * as DesktopWindow from "../window/DesktopWindow.ts";
import { DESKTOP_NOTIFICATION_ACTIVATED_CHANNEL } from "../ipc/channels.ts";

class DesktopNotificationShowError extends Schema.TaggedErrorClass<DesktopNotificationShowError>()(
  "DesktopNotificationShowError",
  {
    notificationKey: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Could not show native desktop notification ${this.notificationKey}.`;
  }
}

export interface NativeNotification {
  readonly show: () => void;
  readonly close: () => void;
  readonly once: (event: "click" | "close", listener: () => void) => unknown;
  readonly on: (event: "failed", listener: (event: unknown, error: string) => void) => unknown;
}

export interface NativeNotificationOptions {
  readonly title: string;
  readonly body: string;
  readonly silent: boolean;
  readonly timeoutType: "default";
}

export class DesktopNotifications extends Context.Service<
  DesktopNotifications,
  {
    readonly show: (
      input: DesktopNotificationShowInput,
    ) => Effect.Effect<DesktopNotificationShowResult>;
    readonly dismiss: (target: DesktopNotificationTarget) => Effect.Effect<void>;
    readonly dismissAll: Effect.Effect<void>;
    readonly showTest: (input: {
      readonly silent: boolean;
    }) => Effect.Effect<DesktopNotificationShowResult>;
  }
>()("@t3tools/desktop/notifications/DesktopNotifications") {}

export class DesktopNotificationPlatformService extends Context.Service<
  DesktopNotificationPlatformService,
  {
    readonly isSupported: () => boolean;
    readonly isAppFocused: () => boolean;
    readonly create: (options: NativeNotificationOptions) => NativeNotification;
    readonly setTaskbarBadge: (window: Electron.BrowserWindow | null, visible: boolean) => void;
  }
>()("@t3tools/desktop/notifications/DesktopNotifications/DesktopNotificationPlatformService") {}

export function notificationTargetKey(target: DesktopNotificationTarget): string {
  return JSON.stringify([target.environmentId, target.threadId]);
}

const TEST_NOTIFICATION_KEY = "desktop-notification-test";

const TASKBAR_BADGE_DESCRIPTION = "Unread T3 notification";

function createTaskbarBadgeIcon(): Electron.NativeImage {
  const size = 16;
  const center = (size - 1) / 2;
  const bitmap = Buffer.alloc(size * size * 4);
  const setPixel = (x: number, y: number, color: readonly [number, number, number, number]) => {
    const offset = (y * size + x) * 4;
    // Electron expects raw bitmap data in BGRA order.
    bitmap[offset] = color[2];
    bitmap[offset + 1] = color[1];
    bitmap[offset + 2] = color[0];
    bitmap[offset + 3] = color[3];
  };
  const red: readonly [number, number, number, number] = [217, 45, 32, 255];
  const white: readonly [number, number, number, number] = [255, 255, 255, 255];

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const distance = Math.hypot(x - center, y - center);
      if (distance <= 7.25) {
        setPixel(x, y, red);
      }
    }
  }

  // Draw a compact white "1" so the overlay remains legible at taskbar size.
  for (let y = 4; y <= 11; y += 1) {
    setPixel(8, y, white);
    setPixel(9, y, white);
  }
  setPixel(7, 5, white);
  setPixel(6, 6, white);
  for (let x = 6; x <= 10; x += 1) {
    setPixel(x, 12, white);
  }

  return Electron.nativeImage.createFromBitmap(bitmap, {
    width: size,
    height: size,
    scaleFactor: 1,
  });
}

export const make = Effect.gen(function* () {
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  const platform = yield* DesktopNotificationPlatformService;
  const notifications = new Map<string, NativeNotification>();
  const context = yield* Effect.context<DesktopWindow.DesktopWindow>();
  const runFork = Effect.runForkWith(context);

  const closeNotification = (key: string): void => {
    const existing = notifications.get(key);
    if (existing === undefined) {
      return;
    }
    existing.close();
    // Some native adapters emit `close` synchronously and some do not. Make
    // sure the map is consistent in either case. Toast expiry is not the same
    // as the user reading the notification, so the taskbar badge is managed
    // independently and remains until the app is focused.
    if (notifications.get(key) === existing) {
      notifications.delete(key);
    }
  };

  const closeAllNotifications = (): void => {
    for (const notification of notifications.values()) {
      notification.close();
    }
    notifications.clear();
    platform.setTaskbarBadge(null, false);
  };

  const reveal = (target: DesktopNotificationTarget | null) =>
    desktopWindow.revealOrCreateMain.pipe(
      Effect.tap((window) =>
        target === null
          ? Effect.void
          : Effect.sync(() => {
              const send = () => {
                if (!window.isDestroyed()) {
                  window.webContents.send(DESKTOP_NOTIFICATION_ACTIVATED_CHANNEL, target);
                }
              };
              if (window.webContents.isLoadingMainFrame()) {
                window.webContents.once("did-finish-load", send);
              } else {
                send();
              }
            }),
      ),
      Effect.asVoid,
      Effect.catchCause((cause) =>
        Effect.logWarning("Could not reveal a desktop notification target.", cause),
      ),
    );

  const showContent = (input: {
    readonly key: string;
    readonly content: AgentNotificationContent;
    readonly silent: boolean;
    readonly target: DesktopNotificationTarget | null;
  }): Effect.Effect<DesktopNotificationShowResult> =>
    Effect.gen(function* () {
      const supported = yield* Effect.try({
        try: platform.isSupported,
        catch: () => false,
      }).pipe(Effect.orElseSucceed(() => false));
      if (supported !== true) {
        return "unsupported" as const;
      }

      const window = yield* desktopWindow.ensureMain.pipe(Effect.orDie);
      return yield* Effect.try({
        try: () => {
          closeNotification(input.key);
          const notification = platform.create({
            title: input.content.title,
            body: input.content.body,
            silent: input.silent,
            timeoutType: "default",
          });
          notifications.set(input.key, notification);
          const clearIfCurrent = () => {
            if (notifications.get(input.key) === notification) {
              notifications.delete(input.key);
            }
          };
          notification.once("close", clearIfCurrent);
          notification.once("click", () => {
            clearIfCurrent();
            runFork(reveal(input.target));
          });
          notification.on("failed", (_event, error) => {
            clearIfCurrent();
            runFork(Effect.logWarning("Native desktop notification failed.", { error }));
          });
          notification.show();
          platform.setTaskbarBadge(window, true);
          return "shown" as const;
        },
        catch: (cause) => new DesktopNotificationShowError({ notificationKey: input.key, cause }),
      }).pipe(
        Effect.tapError((error) => Effect.logWarning(error.message, error.cause)),
        Effect.orElseSucceed(() => "failed" as const),
      );
    }).pipe(Effect.withSpan("desktop.notifications.show"));

  yield* Effect.addFinalizer(() => Effect.sync(closeAllNotifications));

  return DesktopNotifications.of({
    show: Effect.fn("desktop.notifications.show")(function* (input) {
      const appFocused = yield* Effect.try({
        try: platform.isAppFocused,
        catch: () => false,
      }).pipe(Effect.orElseSucceed(() => false));
      if (appFocused) {
        return "suppressed" as const;
      }
      return yield* showContent({
        key: notificationTargetKey(input),
        content: formatAgentNotificationContent(input),
        silent: input.silent,
        target: {
          environmentId: input.environmentId,
          threadId: input.threadId,
        },
      });
    }),
    dismiss: (target) => Effect.sync(() => closeNotification(notificationTargetKey(target))),
    dismissAll: Effect.sync(closeAllNotifications),
    showTest: (input) =>
      showContent({
        key: TEST_NOTIFICATION_KEY,
        content: formatAgentNotificationTestContent(),
        silent: input.silent,
        target: null,
      }),
  });
});

const platformLayer = Layer.effect(
  DesktopNotificationPlatformService,
  Effect.gen(function* () {
    const hostPlatform = yield* HostProcessPlatform;
    let taskbarBadgeIcon: Electron.NativeImage | null = null;
    let taskbarBadgeWindow: Electron.BrowserWindow | null = null;
    let taskbarBadgeFocusListener: (() => void) | null = null;

    const clearTaskbarBadge = (): void => {
      const window = taskbarBadgeWindow;
      const focusListener = taskbarBadgeFocusListener;
      taskbarBadgeWindow = null;
      taskbarBadgeFocusListener = null;
      if (window === null || window.isDestroyed()) {
        return;
      }
      if (focusListener !== null) {
        window.removeListener("focus", focusListener);
      }
      window.setOverlayIcon(null, TASKBAR_BADGE_DESCRIPTION);
    };

    return DesktopNotificationPlatformService.of({
      isSupported: () => Electron.Notification.isSupported(),
      isAppFocused: () => Electron.BrowserWindow.getFocusedWindow() !== null,
      create: (options) =>
        new Electron.Notification(
          options as Electron.NotificationConstructorOptions,
        ) as unknown as NativeNotification,
      setTaskbarBadge: (window, visible) => {
        if (hostPlatform !== "win32") {
          return;
        }
        if (!visible) {
          clearTaskbarBadge();
          return;
        }
        if (window === null || window.isDestroyed()) {
          return;
        }
        if (taskbarBadgeWindow === window) {
          return;
        }

        clearTaskbarBadge();
        taskbarBadgeIcon ??= createTaskbarBadgeIcon();
        window.setOverlayIcon(taskbarBadgeIcon, TASKBAR_BADGE_DESCRIPTION);
        const clearOnFocus = () => clearTaskbarBadge();
        taskbarBadgeWindow = window;
        taskbarBadgeFocusListener = clearOnFocus;
        window.once("focus", clearOnFocus);
      },
    });
  }),
);

export const layer = Layer.effect(DesktopNotifications, make).pipe(Layer.provide(platformLayer));

export const layerTest = (platform: DesktopNotificationPlatformService["Service"]) =>
  Layer.effect(DesktopNotifications, make).pipe(
    Layer.provide(Layer.succeed(DesktopNotificationPlatformService, platform)),
  );
