import type { OrchestrationThread } from "@t3tools/contracts";

export const ANDROID_AGENT_RESPONSE_PREVIEW_MAX_LENGTH = 180;

type AgentNotificationMessage = Pick<
  OrchestrationThread["messages"][number],
  "id" | "role" | "text" | "turnId"
>;
type AgentNotificationThread = Pick<OrchestrationThread, "title" | "latestTurn"> & {
  readonly messages: ReadonlyArray<AgentNotificationMessage>;
};

export function stripMarkdownLinkDestinations(text: string): string {
  return text.replace(
    /!?\[([^\]\r\n]+)\]\(\s*(?:<[^>\r\n]*>|[^)\r\n]*)\s*\)/g,
    (_link, label: string) => label,
  );
}

function normalizePreview(text: string): string {
  return stripMarkdownLinkDestinations(text).replace(/\s+/g, " ").trim();
}

function truncatePreview(text: string): string {
  if (text.length <= ANDROID_AGENT_RESPONSE_PREVIEW_MAX_LENGTH) {
    return text;
  }
  return `${text.slice(0, ANDROID_AGENT_RESPONSE_PREVIEW_MAX_LENGTH - 1).trimEnd()}…`;
}

export function deriveLatestAssistantResponsePreview(
  thread: Pick<AgentNotificationThread, "messages" | "latestTurn">,
): string | null {
  const assistantMessages = thread.messages.filter(
    (message) => message.role === "assistant" && normalizePreview(message.text).length > 0,
  );
  if (assistantMessages.length === 0) {
    return null;
  }

  const latestTurn = thread.latestTurn;
  const identifiedMessage =
    latestTurn?.assistantMessageId === null || latestTurn?.assistantMessageId === undefined
      ? undefined
      : assistantMessages.find((message) => message.id === latestTurn.assistantMessageId);
  const turnMessage =
    latestTurn === null || latestTurn === undefined
      ? undefined
      : [...assistantMessages].reverse().find((message) => message.turnId === latestTurn.turnId);
  const message = identifiedMessage ?? turnMessage ?? assistantMessages.at(-1);
  return message === undefined ? null : truncatePreview(normalizePreview(message.text));
}

export function buildAndroidAgentNotificationText(thread: AgentNotificationThread): {
  readonly title: string;
  readonly body: string;
} {
  const status = thread.latestTurn?.state === "error" ? "Agent failed" : "Agent finished";
  const preview = deriveLatestAssistantResponsePreview(thread);
  return {
    title: thread.title,
    body: preview === null ? status : `${status} — ${preview}`,
  };
}
