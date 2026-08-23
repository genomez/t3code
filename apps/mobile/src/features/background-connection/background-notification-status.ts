import type { OrchestrationThread } from "@t3tools/contracts";

import {
  presentBackgroundNotificationCommand,
  type BackgroundNotificationCommand,
} from "./background-notification-command";

export const DEFAULT_BACKGROUND_NOTIFICATION_TITLE = "T3 Code";
export const DEFAULT_BACKGROUND_NOTIFICATION_TEXT = "Connected in background";
export const BACKGROUND_NOTIFICATION_STATUS_MAX_AGE_MS = 30_000;

const MAX_STATUS_DETAIL_LENGTH = 180;

type BackgroundNotificationActivity = Pick<
  OrchestrationThread["activities"][number],
  "kind" | "tone" | "summary" | "payload" | "createdAt" | "sequence"
> & { readonly completedAt?: string | null };

type BackgroundNotificationThread = {
  readonly activities: ReadonlyArray<BackgroundNotificationActivity>;
  readonly latestTurn: Pick<NonNullable<OrchestrationThread["latestTurn"]>, "state"> | null;
};

export interface BackgroundNotificationContent {
  readonly title: string;
  readonly body: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string): string {
  return value.length <= MAX_STATUS_DETAIL_LENGTH
    ? value
    : `${value.slice(0, MAX_STATUS_DETAIL_LENGTH - 1).trimEnd()}…`;
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string") {
    const normalized = compact(value);
    return normalized.length > 0 ? normalized : null;
  }
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
    const normalized = compact(value.join(" "));
    return normalized.length > 0 ? normalized : null;
  }
  return null;
}

function firstNestedString(value: unknown, keys: ReadonlySet<string>, depth = 0): string | null {
  if (depth > 6) return null;
  const record = asRecord(value);
  if (record === null) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        const found = firstNestedString(entry, keys, depth + 1);
        if (found !== null) return found;
      }
    }
    return null;
  }
  for (const [key, nested] of Object.entries(record)) {
    if (keys.has(key)) {
      const found = stringValue(nested);
      if (found !== null) return found;
    }
  }
  for (const nested of Object.values(record)) {
    const found = firstNestedString(nested, keys, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

function hasNestedValue(value: unknown, keyToFind: string, depth = 0): boolean {
  if (depth > 6) return false;
  if (Array.isArray(value)) {
    return value.some((entry) => hasNestedValue(entry, keyToFind, depth + 1));
  }
  const record = asRecord(value);
  if (record === null) return false;
  if (record[keyToFind] !== undefined && record[keyToFind] !== null) return true;
  return Object.values(record).some((entry) => hasNestedValue(entry, keyToFind, depth + 1));
}

function collectChangedFiles(value: unknown, target: string[], seen: Set<string>, depth = 0): void {
  if (depth > 6 || target.length >= 20) return;
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === "string") {
        const path = compact(entry);
        if (path.length > 0 && !seen.has(path)) {
          seen.add(path);
          target.push(path);
        }
      } else {
        collectChangedFiles(entry, target, seen, depth + 1);
      }
    }
    return;
  }
  const record = asRecord(value);
  if (record === null) return;
  for (const key of [
    "path",
    "filePath",
    "file_path",
    "relativePath",
    "filename",
    "newPath",
    "oldPath",
  ]) {
    const path = stringValue(record[key]);
    if (path !== null && !seen.has(path)) {
      seen.add(path);
      target.push(path);
    }
  }
  for (const [key, nested] of Object.entries(record)) {
    if (
      [
        "item",
        "result",
        "input",
        "rawInput",
        "data",
        "changes",
        "changedFiles",
        "files",
        "edits",
        "patch",
        "patches",
        "operations",
      ].includes(key)
    ) {
      collectChangedFiles(nested, target, seen, depth + 1);
    }
  }
}

function payloadStatusDetail(activity: BackgroundNotificationActivity): string | null {
  return firstNestedString(
    activity.payload,
    new Set(["summary", "description", "detail", "status", "title"]),
  );
}

function payloadItemType(activity: BackgroundNotificationActivity): string | null {
  return firstNestedString(activity.payload, new Set(["itemType", "item_type"]));
}

function payloadSearchQuery(activity: BackgroundNotificationActivity): string | null {
  return firstNestedString(
    activity.payload,
    new Set(["query", "pattern", "searchTerm", "search_term"]),
  );
}

function commandValue(value: unknown): BackgroundNotificationCommand | null {
  if (typeof value === "string") {
    const normalized = compact(value);
    return normalized.length > 0 ? normalized : null;
  }
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
    const normalized = value.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
    return normalized.length > 0 ? normalized : null;
  }
  return null;
}

function firstNestedCommand(value: unknown, depth = 0): BackgroundNotificationCommand | null {
  if (depth > 6) return null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = firstNestedCommand(entry, depth + 1);
      if (found !== null) return found;
    }
    return null;
  }
  const record = asRecord(value);
  if (record === null) return null;
  for (const key of ["command", "cmd", "script"]) {
    const found = commandValue(record[key]);
    if (found !== null) return found;
  }
  for (const nested of Object.values(record)) {
    const found = firstNestedCommand(nested, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

function payloadCommand(
  activity: BackgroundNotificationActivity,
): BackgroundNotificationCommand | null {
  return firstNestedCommand(activity.payload);
}

function payloadToolName(activity: BackgroundNotificationActivity): string | null {
  return firstNestedString(
    activity.payload,
    new Set(["toolName", "tool_name", "serverToolName", "server_tool_name"]),
  );
}

function changedFileCount(activity: BackgroundNotificationActivity): number {
  const files: string[] = [];
  collectChangedFiles(activity.payload, files, new Set());
  return files.length;
}

function presentActivitySummary(activity: BackgroundNotificationActivity): string {
  const summary = compact(activity.summary);
  const normalized = summary.toLowerCase();
  const started = activity.kind.endsWith(".started");
  const completed = activity.kind.endsWith(".completed");
  const itemType = payloadItemType(activity)?.toLowerCase() ?? "";
  const fileCount = changedFileCount(activity);

  // Approval payloads can contain prompts, diffs, or credentials. Never render
  // any provider detail from this branch.
  if (activity.kind === "approval.requested" || activity.tone === "approval") {
    return "Waiting for approval";
  }
  if (/compact(?:ing|ion)|context compaction/.test(normalized)) return "Compacting context";
  if (activity.kind === "context-window.updated" || normalized.startsWith("context")) {
    return "Context window updated";
  }
  if (/thinking|reasoning/.test(normalized)) return "Thinking";

  if (itemType === "command_execution" || /\b(?:ran|run|running) command\b/.test(normalized)) {
    const command = payloadCommand(activity);
    if (command === null) return "Running command";
    const presentedCommand = presentBackgroundNotificationCommand(command);
    if (presentedCommand === null) {
      return !started && (completed || /^ran\b/.test(normalized))
        ? "Ran command"
        : "Running command";
    }
    return truncate(
      `${!started && (completed || /^ran\b/.test(normalized)) ? "Ran" : "Running"}: ${presentedCommand}`,
    );
  }
  if (itemType === "file_read" || /\b(?:read|reading) file\b/.test(normalized)) {
    return "Reading file";
  }
  if (
    itemType === "file_change" ||
    /\b(?:change|changed|changing|edit|edited) files?\b/.test(normalized)
  ) {
    if (started || activity.kind.endsWith(".updated")) return "Changing files";
    if (fileCount > 0) return `Changed ${fileCount} file${fileCount === 1 ? "" : "s"}`;
    return completed || /changed|edited/.test(normalized) ? "Changed files" : "Changing files";
  }
  if (
    itemType === "web_search" ||
    itemType === "search" ||
    /\bsearch(?:ed|ing)?\b/.test(normalized)
  ) {
    const query = payloadSearchQuery(activity);
    if (started || activity.kind.endsWith(".updated")) return "Searching files";
    return query === null ? "Searched files" : truncate(`Searched ${query}`);
  }
  if (itemType === "image_view" || /\b(?:view|viewed|viewing) image\b/.test(normalized)) {
    return completed || /viewed/.test(normalized) ? "Viewed image" : "Viewing image";
  }

  const toolName = payloadToolName(activity);
  if (activity.kind.startsWith("tool.")) {
    if (started || activity.kind.endsWith(".updated")) {
      return truncate(toolName === null ? "Calling tool" : `Calling ${toolName}`);
    }
    if (completed) return truncate(toolName === null ? "Called tool" : `Called ${toolName}`);
  }

  const detail = payloadStatusDetail(activity);
  if (detail !== null && compact(detail).toLowerCase() !== normalized) {
    return truncate(summary.length > 0 ? `${summary}: ${detail}` : detail);
  }
  return truncate(summary || "Working");
}

function isActivityFresh(activity: BackgroundNotificationActivity, nowMs: number): boolean {
  const createdAtMs = Date.parse(activity.createdAt);
  return (
    !Number.isFinite(createdAtMs) ||
    nowMs - createdAtMs <= BACKGROUND_NOTIFICATION_STATUS_MAX_AGE_MS
  );
}

function activityCompleted(activity: BackgroundNotificationActivity): boolean {
  return activity.completedAt != null || hasNestedValue(activity.payload, "completedAt");
}

function latestActivity(thread: Pick<BackgroundNotificationThread, "activities">) {
  return thread.activities.reduce<BackgroundNotificationActivity | null>((latest, activity) => {
    if (latest === null) return activity;
    if (activity.createdAt !== latest.createdAt) {
      return activity.createdAt > latest.createdAt ? activity : latest;
    }
    return (activity.sequence ?? -1) > (latest.sequence ?? -1) ? activity : latest;
  }, null);
}

export function deriveBackgroundNotificationText(
  thread: BackgroundNotificationThread | null,
  nowMs = Date.now(),
): string | null {
  if (thread?.latestTurn?.state !== "running") return null;
  const activity = latestActivity(thread);
  if (activity === null || !isActivityFresh(activity, nowMs) || activityCompleted(activity)) {
    return "Working";
  }
  return presentActivitySummary(activity);
}

export function deriveBackgroundNotificationContent(
  thread: BackgroundNotificationThread | null,
  threadTitle: string | null | undefined,
  nowMs = Date.now(),
): BackgroundNotificationContent {
  const title = compact(threadTitle ?? "") || DEFAULT_BACKGROUND_NOTIFICATION_TITLE;
  return {
    title: truncate(title),
    body: deriveBackgroundNotificationText(thread, nowMs) ?? DEFAULT_BACKGROUND_NOTIFICATION_TEXT,
  };
}
