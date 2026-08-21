import type { EnvironmentId, OrchestrationThread, ScopedThreadRef } from "@t3tools/contracts";
import {
  connectionPhaseMessage,
  presentEnvironmentConnection,
  type SupervisorConnectionState,
} from "@t3tools/client-runtime/connection";
import * as Option from "effect/Option";
import { AsyncResult, type AtomRegistry } from "effect/unstable/reactivity";

import { environmentCatalog } from "../../connection/catalog";
import { environmentServerConfigsAtom } from "../../state/server";
import { environmentShell } from "../../state/shell";
import { environmentThreadShells, environmentThreads } from "../../state/threads";
import {
  clearBackgroundConnectionRetainedThread,
  ensureBackgroundConnectionRetainedThreadLoaded,
  getBackgroundConnectionRetainedThreadSnapshot,
  subscribeBackgroundConnectionRetainedThread,
} from "./retained-thread";
import { selectBackgroundConnectionThreadTargets } from "./target-selection";
import {
  isAgentTurnSettlement,
  type AgentTurnSnapshot,
} from "../agent-awareness/localNotificationPolicy";
import { scheduleAndroidAgentCompletionNotification } from "../agent-awareness/localNotifications";
import { shouldSuppressAndroidCompletionNotification } from "../agent-awareness/completionNotificationPolicy";
import { setBackgroundConnectionNotificationContent } from "../../native/backgroundConnection";
import {
  BACKGROUND_NOTIFICATION_STATUS_MAX_AGE_MS,
  DEFAULT_BACKGROUND_NOTIFICATION_TITLE,
  deriveBackgroundNotificationContent,
} from "./background-notification-status";

interface DetailLease {
  readonly ref: ScopedThreadRef;
  readonly release: () => void;
}

interface BackgroundConnectionRoot {
  readonly start: () => void;
  readonly stop: () => void;
}

const AGENT_NOTIFICATION_SETTLEMENT_GRACE_MS = 1_000;

function refKey(ref: ScopedThreadRef): string {
  return JSON.stringify([ref.environmentId, ref.threadId]);
}

function refsEqual(left: ScopedThreadRef | null, right: ScopedThreadRef): boolean {
  return (
    left !== null && left.environmentId === right.environmentId && left.threadId === right.threadId
  );
}

function releaseBestEffort(label: string, release: (() => void) | null): void {
  if (release === null) {
    return;
  }
  try {
    release();
  } catch (error) {
    console.error(`[background-connection] failed to release ${label}`, error);
  }
}

export function createBackgroundConnectionRoot(
  registry: AtomRegistry.AtomRegistry,
): BackgroundConnectionRoot {
  let started = false;
  let retainedThread = getBackgroundConnectionRetainedThreadSnapshot().thread;
  let catalogReady = false;
  let catalogEnvironmentIds = new Set<EnvironmentId>();
  let threadShells = registry.get(environmentThreadShells.threadShellsAtom);
  let catalogRelease: (() => void) | null = null;
  let threadShellsRelease: (() => void) | null = null;
  let serverConfigsRelease: (() => void) | null = null;
  let networkStatusRelease: (() => void) | null = null;
  let networkStatusValueRelease: (() => void) | null = null;
  let retainedThreadRelease: (() => void) | null = null;
  const clearingDeletedKeys = new Set<string>();
  const shellLeases = new Map<EnvironmentId, () => void>();
  const connectionLeases = new Map<EnvironmentId, () => void>();
  const connectionStates = new Map<EnvironmentId, SupervisorConnectionState>();
  const detailLeases = new Map<string, DetailLease>();
  // A shell can settle before the detail stream delivers the terminal turn
  // event. Keep that detail lease alive until the running turn is observed as
  // settled so completion notifications and the persistent status cannot be
  // lost at the shell/detail boundary.
  const pendingSettlementKeys = new Set<string>();
  const agentNotificationTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const notificationTurnStates = new Map<string, AgentTurnSnapshot | null>();
  const settledNotificationTurns = new Map<string, string>();
  const settledShellTurnIds = new Map<string, string | undefined>();
  let notificationStatusRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let latestNotificationThread: OrchestrationThread | null = null;

  const clearNotificationStatusRefresh = () => {
    if (notificationStatusRefreshTimer === null) {
      return;
    }
    clearTimeout(notificationStatusRefreshTimer);
    notificationStatusRefreshTimer = null;
  };

  const clearAgentNotificationTimer = (key: string) => {
    const timer = agentNotificationTimers.get(key);
    if (timer === undefined) {
      return;
    }
    clearTimeout(timer);
    agentNotificationTimers.delete(key);
  };

  const isRunningThread = (thread: OrchestrationThread | null): boolean =>
    thread?.latestTurn?.state === "running" && thread.latestTurn.completedAt === null;

  const isRunningTurn = (turn: AgentTurnSnapshot | null | undefined): boolean =>
    turn?.state === "running" && turn.completedAt === null;

  const mergeObservedTurn = (
    previous: AgentTurnSnapshot | undefined,
    next: AgentTurnSnapshot | null,
  ): AgentTurnSnapshot | null => {
    if (next === null) return previous ?? null;
    if (
      previous !== undefined &&
      previous.turnId === next.turnId &&
      !isRunningTurn(previous) &&
      isRunningTurn(next)
    ) {
      return previous;
    }
    return next;
  };

  const notificationKeyForThread = (thread: OrchestrationThread | null): string | null => {
    if (thread === null) return null;
    const shell = threadShells.find((candidate) => candidate.id === thread.id);
    if (shell !== undefined) {
      return refKey({ environmentId: shell.environmentId, threadId: shell.id });
    }
    return retainedThread?.threadId === thread.id ? refKey(retainedThread) : null;
  };

  const isNotificationThreadRunning = (thread: OrchestrationThread | null): boolean => {
    if (!isRunningThread(thread)) return false;
    const key = notificationKeyForThread(thread);
    if (key !== null && settledNotificationTurns.has(key)) return false;
    const observedTurn = key === null ? undefined : (notificationTurnStates.get(key) ?? undefined);
    return observedTurn === undefined || isRunningTurn(observedTurn);
  };

  const readThreadFromResult = (result: unknown): OrchestrationThread | null => {
    if (!AsyncResult.isAsyncResult(result)) {
      return null;
    }
    const state = Option.getOrNull(AsyncResult.value(result));
    const data = (state as { readonly data?: Option.Option<OrchestrationThread> } | null)?.data;
    return data === undefined ? null : Option.getOrNull(data);
  };

  const deriveConnectionNotificationText = (): string | null => {
    const networkStatus = registry.get(environmentCatalog.networkStatusValueAtom);
    if (networkStatus === "offline") {
      return "You are offline";
    }

    const environmentIds = [
      ...(retainedThread === null ? [] : [retainedThread.environmentId]),
      ...connectionStates.keys(),
    ];
    const seen = new Set<EnvironmentId>();
    for (const environmentId of environmentIds) {
      if (seen.has(environmentId)) {
        continue;
      }
      seen.add(environmentId);
      const state = connectionStates.get(environmentId);
      const entry = catalogEnvironmentIds.has(environmentId)
        ? registry.get(environmentCatalog.catalogValueAtom).entries.get(environmentId)
        : undefined;
      if (state === undefined || entry === undefined) {
        continue;
      }
      const presentation = presentEnvironmentConnection(state);
      if (
        presentation.phase === "connecting" ||
        presentation.phase === "reconnecting" ||
        presentation.phase === "offline" ||
        presentation.phase === "error"
      ) {
        return connectionPhaseMessage(presentation.phase, entry.target.label, networkStatus);
      }
    }
    return null;
  };

  const deriveNotificationContent = (thread: OrchestrationThread | null) => {
    const activeShells = threadShells.filter((shell) => {
      const shellIsActive =
        shell.session?.status === "starting" || shell.session?.status === "running";
      if (!shellIsActive) return false;
      const key = refKey({ environmentId: shell.environmentId, threadId: shell.id });
      const observedTurn = notificationTurnStates.get(key);
      const shellTurnId = shell.latestTurn?.turnId;
      if (settledNotificationTurns.has(key)) return false;
      if (
        observedTurn !== undefined &&
        shellTurnId !== undefined &&
        shellTurnId !== observedTurn?.turnId
      ) {
        return shell.latestTurn?.state === "running" && shell.latestTurn.completedAt === null;
      }
      if (observedTurn !== undefined && !isRunningTurn(observedTurn)) return false;
      if (thread === null || shell.id !== thread.id) return true;
      return observedTurn === undefined || isRunningThread(thread);
    });
    const activeThreads = new Map<string, { readonly title: string }>();
    for (const shell of activeShells) {
      activeThreads.set(refKey({ environmentId: shell.environmentId, threadId: shell.id }), {
        title: shell.title,
      });
    }

    const runningThread = isNotificationThreadRunning(thread) ? thread : null;
    if (runningThread !== null) {
      const matchingShell = threadShells.find((shell) => shell.id === runningThread.id);
      const key = matchingShell
        ? refKey({ environmentId: matchingShell.environmentId, threadId: matchingShell.id })
        : `thread:${runningThread.id}`;
      activeThreads.set(key, { title: matchingShell?.title ?? runningThread.title });
    }

    if (activeThreads.size === 0) {
      return deriveBackgroundNotificationContent(null, null);
    }
    const activeThread = [...activeThreads.values()][0]!;
    const activityThread =
      runningThread ??
      ({ activities: [], latestTurn: { state: "running" } } as unknown as OrchestrationThread);
    const activeContent = deriveBackgroundNotificationContent(activityThread, activeThread.title);
    if (activeThreads.size === 1) return activeContent;
    return {
      title: DEFAULT_BACKGROUND_NOTIFICATION_TITLE,
      body: `${activeThreads.size} threads active — ${activeContent.body}`,
    };
  };

  const publishNotificationStatus = (thread: OrchestrationThread | null) => {
    latestNotificationThread = thread;
    const content = deriveNotificationContent(thread);
    setBackgroundConnectionNotificationContent({
      title: content.title,
      body: deriveConnectionNotificationText() ?? content.body,
    });
    clearNotificationStatusRefresh();
    if (!isNotificationThreadRunning(thread)) {
      return;
    }
    notificationStatusRefreshTimer = setTimeout(() => {
      notificationStatusRefreshTimer = null;
      if (isNotificationThreadRunning(latestNotificationThread)) {
        const content = deriveNotificationContent(latestNotificationThread);
        setBackgroundConnectionNotificationContent({
          title: content.title,
          body: deriveConnectionNotificationText() ?? content.body,
        });
      }
    }, BACKGROUND_NOTIFICATION_STATUS_MAX_AGE_MS + 100);
  };

  const syncConnectionLeases = () => {
    if (!started) {
      return;
    }
    for (const [environmentId, release] of connectionLeases) {
      if (catalogEnvironmentIds.has(environmentId)) {
        continue;
      }
      connectionLeases.delete(environmentId);
      connectionStates.delete(environmentId);
      releaseBestEffort(`environment connection ${environmentId}`, release);
    }
    for (const environmentId of catalogEnvironmentIds) {
      if (connectionLeases.has(environmentId)) {
        continue;
      }
      const release = registry.subscribe(
        environmentCatalog.stateAtom(environmentId),
        (result) => {
          const state = Option.getOrNull(
            AsyncResult.value(result),
          ) as SupervisorConnectionState | null;
          if (state === null) {
            connectionStates.delete(environmentId);
          } else {
            connectionStates.set(environmentId, state);
          }
          publishNotificationStatus(latestNotificationThread);
        },
        { immediate: true },
      );
      connectionLeases.set(environmentId, release);
    }
  };

  const scheduleAgentCompletionNotification = (
    ref: ScopedThreadRef,
    atom: Parameters<AtomRegistry.AtomRegistry["get"]>[0],
    fallbackThread: OrchestrationThread,
  ) => {
    void shouldSuppressAndroidCompletionNotification(ref)
      .then((suppress) => {
        if (suppress) {
          return;
        }
        const key = refKey(ref);
        clearAgentNotificationTimer(key);
        const readNotificationThread = (): OrchestrationThread => {
          agentNotificationTimers.delete(key);
          const latestThread = readThreadFromResult(registry.get(atom));
          const thread = latestThread ?? fallbackThread;
          const shell = threadShells.find(
            (candidate) =>
              candidate.environmentId === ref.environmentId && candidate.id === ref.threadId,
          );
          const title =
            shell?.title !== undefined && shell.title !== fallbackThread.title
              ? shell.title
              : thread.title;
          return title === thread.title ? thread : { ...thread, title };
        };

        const notificationThread = readNotificationThread();
        const initialTitle = notificationThread.title;
        void scheduleAndroidAgentCompletionNotification({
          environmentId: ref.environmentId,
          thread: notificationThread,
        }).catch((error) => {
          console.error("[background-connection] failed to schedule agent notification", error);
        });

        // Thread-title generation can settle just after the agent turn. Refresh
        // the same Android notification slot once without making the user wait
        // for the initial completion alert.
        const timer = setTimeout(() => {
          agentNotificationTimers.delete(key);
          const updatedThread = readNotificationThread();
          if (updatedThread.title === initialTitle) {
            return;
          }
          void scheduleAndroidAgentCompletionNotification({
            environmentId: ref.environmentId,
            silent: true,
            thread: updatedThread,
          }).catch((error) => {
            console.error("[background-connection] failed to refresh agent notification", error);
          });
        }, AGENT_NOTIFICATION_SETTLEMENT_GRACE_MS);
        agentNotificationTimers.set(key, timer);
      })
      .catch((error) => {
        console.error("[background-connection] failed to evaluate notification policy", error);
      });
  };

  const clearRetainedIfCurrent = (ref: ScopedThreadRef) => {
    if (!refsEqual(retainedThread, ref)) {
      return;
    }
    const key = refKey(ref);
    if (clearingDeletedKeys.has(key)) {
      return;
    }
    clearingDeletedKeys.add(key);
    void clearBackgroundConnectionRetainedThread().finally(() => {
      clearingDeletedKeys.delete(key);
      // Saving publishes before its persistence operation is queued. If the
      // same deleted ref was saved while this clear was pending, clear it once
      // more now so the final persistence operation cannot restore it.
      if (started && refsEqual(retainedThread, ref)) {
        clearRetainedIfCurrent(ref);
      }
    });
  };

  const syncDetailLeases = () => {
    if (!started) {
      return;
    }
    const targets = selectBackgroundConnectionThreadTargets(retainedThread, threadShells);
    const targetKeys = new Set(targets.map(refKey));

    for (const [key, lease] of detailLeases) {
      if (targetKeys.has(key) || pendingSettlementKeys.has(key)) {
        continue;
      }
      detailLeases.delete(key);
      releaseBestEffort(`thread detail ${key}`, lease.release);
    }

    for (const ref of targets) {
      const key = refKey(ref);
      if (detailLeases.has(key)) {
        continue;
      }
      const atom = environmentThreads.stateAtom(ref.environmentId, ref.threadId);
      let subscribedRelease: (() => void) | null = null;
      let hasObservedDetail = false;
      let previousTurn: AgentTurnSnapshot | null = null;
      const lease: DetailLease = {
        ref,
        release: () => subscribedRelease?.(),
      };
      // Register the lease before subscribing because an immediate deleted
      // state can synchronously clear the retained target and re-enter this
      // reconciliation.
      detailLeases.set(key, lease);
      subscribedRelease = registry.subscribe(
        atom,
        (result) => {
          const state = Option.getOrNull(AsyncResult.value(result)) as {
            readonly status?: string;
            readonly data?: Option.Option<OrchestrationThread>;
          } | null;
          if (state?.status === "deleted") {
            clearAgentNotificationTimer(key);
            pendingSettlementKeys.delete(key);
            notificationTurnStates.delete(key);
            settledNotificationTurns.delete(key);
            settledShellTurnIds.delete(key);
            clearRetainedIfCurrent(ref);
            publishNotificationStatus(null);
            return;
          }
          const thread = readThreadFromResult(result);
          const nextTurn = thread?.latestTurn
            ? {
                completedAt: thread.latestTurn.completedAt,
                state: thread.latestTurn.state,
                turnId: thread.latestTurn.turnId,
              }
            : null;
          if (thread !== null) {
            notificationTurnStates.set(
              key,
              mergeObservedTurn(notificationTurnStates.get(key) ?? undefined, nextTurn),
            );
            if (nextTurn !== null && isRunningTurn(nextTurn)) {
              const settledDetailTurnId = settledNotificationTurns.get(key);
              const settledShellTurnId = settledShellTurnIds.get(key);
              if (
                settledDetailTurnId === undefined ||
                (nextTurn.turnId !== settledDetailTurnId && nextTurn.turnId !== settledShellTurnId)
              ) {
                settledNotificationTurns.delete(key);
                settledShellTurnIds.delete(key);
                notificationTurnStates.delete(key);
              }
            }
          }
          if (isRunningThread(thread)) pendingSettlementKeys.add(key);
          if (hasObservedDetail && isAgentTurnSettlement(previousTurn, nextTurn) && thread) {
            pendingSettlementKeys.delete(key);
            if (nextTurn !== null) {
              settledNotificationTurns.set(key, nextTurn.turnId);
              settledShellTurnIds.set(
                key,
                threadShells.find(
                  (candidate) =>
                    candidate.environmentId === ref.environmentId && candidate.id === ref.threadId,
                )?.latestTurn?.turnId,
              );
            }
            scheduleAgentCompletionNotification(ref, atom, thread);
          }
          publishNotificationStatus(thread);
          previousTurn = nextTurn;
          hasObservedDetail = true;
          if (!pendingSettlementKeys.has(key)) {
            syncDetailLeases();
          }
        },
        { immediate: true },
      );
      if (!detailLeases.has(key)) {
        subscribedRelease();
      }
    }
  };

  const validateRetainedEnvironment = () => {
    if (
      catalogReady &&
      retainedThread !== null &&
      !catalogEnvironmentIds.has(retainedThread.environmentId)
    ) {
      clearRetainedIfCurrent(retainedThread);
    }
  };

  const syncRetainedThread = () => {
    retainedThread = getBackgroundConnectionRetainedThreadSnapshot().thread;
    validateRetainedEnvironment();
    syncDetailLeases();
  };

  return {
    start() {
      if (started) {
        return;
      }
      started = true;
      retainedThreadRelease = subscribeBackgroundConnectionRetainedThread(syncRetainedThread);
      retainedThread = getBackgroundConnectionRetainedThreadSnapshot().thread;
      serverConfigsRelease = registry.mount(environmentServerConfigsAtom);
      catalogRelease = registry.subscribe(
        environmentCatalog.catalogValueAtom,
        (catalog) => {
          catalogReady = catalog.isReady;
          catalogEnvironmentIds = new Set(catalog.entries.keys());

          for (const [environmentId, release] of shellLeases) {
            if (catalogEnvironmentIds.has(environmentId)) {
              continue;
            }
            shellLeases.delete(environmentId);
            releaseBestEffort(`environment shell ${environmentId}`, release);
          }
          for (const environmentId of catalogEnvironmentIds) {
            if (!shellLeases.has(environmentId)) {
              shellLeases.set(
                environmentId,
                registry.mount(environmentShell.stateAtom(environmentId)),
              );
            }
          }
          syncConnectionLeases();
          validateRetainedEnvironment();
        },
        { immediate: true },
      );
      networkStatusRelease = registry.mount(environmentCatalog.networkStatusAtom);
      networkStatusValueRelease = registry.subscribe(
        environmentCatalog.networkStatusValueAtom,
        () => publishNotificationStatus(latestNotificationThread),
        { immediate: true },
      );
      threadShellsRelease = registry.subscribe(
        environmentThreadShells.threadShellsAtom,
        (nextThreadShells) => {
          threadShells = nextThreadShells;
          syncDetailLeases();
          publishNotificationStatus(latestNotificationThread);
        },
        { immediate: true },
      );
      void ensureBackgroundConnectionRetainedThreadLoaded();
      syncDetailLeases();
    },
    stop() {
      if (!started) {
        return;
      }
      started = false;
      releaseBestEffort("retained-thread listener", retainedThreadRelease);
      retainedThreadRelease = null;
      releaseBestEffort("thread-shell listener", threadShellsRelease);
      threadShellsRelease = null;
      releaseBestEffort("environment catalog", catalogRelease);
      catalogRelease = null;
      releaseBestEffort("server configs", serverConfigsRelease);
      serverConfigsRelease = null;
      releaseBestEffort("network status", networkStatusValueRelease);
      networkStatusValueRelease = null;
      releaseBestEffort("network status stream", networkStatusRelease);
      networkStatusRelease = null;
      for (const [environmentId, release] of connectionLeases) {
        releaseBestEffort(`environment connection ${environmentId}`, release);
      }
      connectionLeases.clear();
      connectionStates.clear();
      for (const [environmentId, release] of shellLeases) {
        releaseBestEffort(`environment shell ${environmentId}`, release);
      }
      shellLeases.clear();
      for (const [key, lease] of detailLeases) {
        releaseBestEffort(`thread detail ${key}`, lease.release);
      }
      detailLeases.clear();
      pendingSettlementKeys.clear();
      for (const key of agentNotificationTimers.keys()) {
        clearAgentNotificationTimer(key);
      }
      notificationTurnStates.clear();
      settledNotificationTurns.clear();
      settledShellTurnIds.clear();
      clearNotificationStatusRefresh();
      latestNotificationThread = null;
    },
  };
}

const roots = new WeakMap<
  AtomRegistry.AtomRegistry,
  { readonly root: BackgroundConnectionRoot; owners: number }
>();

export function acquireBackgroundConnectionRoot(registry: AtomRegistry.AtomRegistry): () => void {
  let shared = roots.get(registry);
  if (shared === undefined) {
    const root = createBackgroundConnectionRoot(registry);
    shared = { root, owners: 1 };
    roots.set(registry, shared);
    try {
      root.start();
    } catch (error) {
      roots.delete(registry);
      root.stop();
      throw error;
    }
  } else {
    shared.owners += 1;
  }
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    const current = roots.get(registry);
    if (current === undefined) {
      return;
    }
    current.owners -= 1;
    if (current.owners > 0) {
      return;
    }
    current.root.stop();
    roots.delete(registry);
  };
}
