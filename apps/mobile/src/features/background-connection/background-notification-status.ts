import type { OrchestrationThread } from "@t3tools/contracts";

export const DEFAULT_BACKGROUND_NOTIFICATION_TITLE = "T3 Code";
export const DEFAULT_BACKGROUND_NOTIFICATION_TEXT = "Connected in background";
export const BACKGROUND_NOTIFICATION_STATUS_MAX_AGE_MS = 30_000;

const MAX_STATUS_DETAIL_LENGTH = 180;

type BackgroundNotificationActivity = Pick<
  OrchestrationThread["activities"][number],
  "kind" | "tone" | "summary" | "payload" | "createdAt" | "sequence"
>;

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

function firstString(record: Record<string, unknown> | null, keys: ReadonlyArray<string>): string | null {
  if (record === null) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && compact(value).length > 0) {
      return compact(value);
    }
  }
  return null;
}

function collectChangedFiles(
  value: unknown,
  target: string[],
  seen: Set<string>,
  depth = 0,
): void {
  if (depth > 4 || target.length >= 20) return;
  if (Array.isArray(value)) {
    for (const entry of value) collectChangedFiles(entry, target, seen, depth + 1);
    return;
  }
  const record = asRecord(value);
  if (record === null) return;
  for (const key of ["path", "filePath", "relativePath", "filename", "newPath", "oldPath"]) {
    const path = record[key];
    if (typeof path !== "string") continue;
    const normalized = compact(path);
    if (normalized.length > 0 && !seen.has(normalized)) {
      seen.add(normalized);
      target.push(normalized);
    }
  }
  for (const key of [
    "item",
    "result",
    "input",
    "data",
    "changes",
    "files",
    "edits",
    "patch",
    "patches",
    "operations",
  ]) {
    if (key in record) collectChangedFiles(record[key], target, seen, depth + 1);
  }
}

function payloadStatusDetail(activity: BackgroundNotificationActivity): string | null {
  const payload = asRecord(activity.payload);
  if (payload === null) return null;
  const directDetail = firstString(payload, ["summary", "description", "detail"]);
  if (directDetail !== null) return directDetail;
  const nested = asRecord(payload.data) ?? asRecord(payload.result) ?? asRecord(payload.item);
  return firstString(nested, ["summary", "description", "detail"]);
}

function payloadItemType(activity: BackgroundNotificationActivity): string | null {
  return firstString(asRecord(activity.payload), ["itemType", "item_type", "type"]);
}

function payloadSearchQuery(activity: BackgroundNotificationActivity): string | null {
  const payload = asRecord(activity.payload);
  const rawInput = asRecord(payload?.rawInput) ?? asRecord(payload?.input);
  return (
    firstString(rawInput, ["query", "pattern", "searchTerm"]) ??
    firstString(payload, ["query", "pattern", "searchTerm"])
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
  const started = activity.kind.endsWith(".started") || activity.kind === "tool.started";
  const progressed = activity.kind.endsWith(".progress") || activity.kind === "tool.updated";
  const itemType = payloadItemType(activity)?.toLowerCase();
  const fileCount = changedFileCount(activity);

  if (activity.kind === "approval.requested" || activity.tone === "approval") {
    return "Waiting for approval";
  }
  if (normalized.startsWith("context")) {
    return truncate(summary || "Context window updated");
  }
  if (/^ran command(?: started)?$/i.test(summary)) return "Running command";
  if (/^read file(?: started)?$/i.test(summary)) return "Reading file";
  if (/^changed files?(?: started)?$/i.test(summary)) {
    if (!started && fileCount > 0) return `Changed ${fileCount} file${fileCount === 1 ? "" : "s"}`;
    return started || progressed ? "Changing files" : "Changed files";
  }
  if (/^searched files?(?: started)?$/i.test(summary)) {
    const query = payloadSearchQuery(activity);
    if (query) return truncate(`Searched ${query}`);
    return started || progressed ? "Searching files" : "Searched files";
  }

  const detail = payloadStatusDetail(activity);
  if (detail !== null && /^(web_search|search)$/i.test(itemType ?? "")) {
    return truncate(`${summary || "Searched"} ${detail}`);
  }
  if (itemType === "file_change" && fileCount > 0 && !started) {
    return `Changed ${fileCount} file${fileCount === 1 ? "" : "s"}`;
  }
  if (started) return truncate(summary.replace(/\s+started$/i, "") || "Working");
  return truncate(summary || "Working");
}

function isActivityFresh(activity: BackgroundNotificationActivity, nowMs: number): boolean {
  const createdAtMs = Date.parse(activity.createdAt);
  return !Number.isFinite(createdAtMs) || nowMs - createdAtMs <= BACKGROUND_NOTIFICATION_STATUS_MAX_AGE_MS;
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
  return activity === null || !isActivityFresh(activity, nowMs)
    ? "Working"
    : presentActivitySummary(activity);
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
