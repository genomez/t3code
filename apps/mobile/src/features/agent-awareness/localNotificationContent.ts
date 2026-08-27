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

function simpleTruncatePreview(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function finalSentence(text: string): string | null {
  const match = text.match(/(?:^|[.!?]\s+)([^.!?]+[.!?]?)$/);
  const sentence = match?.[1]?.trim();
  return sentence === undefined || sentence.length < 12 ? null : sentence;
}

export function truncateAgentResponsePreview(
  text: string,
  maxLength = ANDROID_AGENT_RESPONSE_PREVIEW_MAX_LENGTH,
): string {
  if (text.length <= maxLength) {
    return text;
  }

  const ending = finalSentence(text);
  if (ending === null || text.startsWith(ending)) {
    return simpleTruncatePreview(text, maxLength);
  }

  const separator = " … ";
  const endingBudget = Math.min(76, Math.floor(maxLength * 0.44));
  const endingPreview = simpleTruncatePreview(ending, endingBudget);
  const leadingBudget = maxLength - separator.length - endingPreview.length;
  if (leadingBudget < 48 || text.indexOf(ending) <= leadingBudget) {
    return simpleTruncatePreview(text, maxLength);
  }

  const leadingPreview = text.slice(0, leadingBudget).trimEnd();
  return `${leadingPreview}${separator}${endingPreview}`;
}

export function deriveLatestAssistantResponsePreview(
  thread: Pick<AgentNotificationThread, "messages" | "latestTurn">,
  maxLength = ANDROID_AGENT_RESPONSE_PREVIEW_MAX_LENGTH,
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
  return message === undefined
    ? null
    : truncateAgentResponsePreview(normalizePreview(message.text), maxLength);
}

export function buildAndroidAgentNotificationText(thread: AgentNotificationThread): {
  readonly title: string;
  readonly body: string;
} {
  const status = thread.latestTurn?.state === "error" ? "Agent failed" : "Agent finished";
  const prefix = `${status} — `;
  const preview = deriveLatestAssistantResponsePreview(
    thread,
    ANDROID_AGENT_RESPONSE_PREVIEW_MAX_LENGTH - prefix.length,
  );
  return {
    title: thread.title,
    body: preview === null ? status : `${prefix}${preview}`,
  };
}
