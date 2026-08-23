const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[a-z]:[\\/]/i;
const FILE_URL_PATTERN = /^file:\/{2,}/i;
const SHELL_CONTROL_TOKEN_PATTERN = /^(?:&&|\|\||[|;&<>]|>>|<<)$/;
const SENSITIVE_FLAG_PATTERN =
  /^[-/]{1,2}[^=]*(?:pass(?:word|wd)?|token|secret|api[-_]?key|authorization|cookie|credential|private[-_]?key)(?:=|$)/i;
const SENSITIVE_ASSIGNMENT_PATTERN =
  /^(?:[^=]*(?:pass(?:word|wd)?|token|secret|api[-_]?key|authorization|cookie|credential|private[-_]?key)[^=]*)=/i;

export type BackgroundNotificationCommand = string | ReadonlyArray<string>;

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function tokenizeCommand(command: string): string[] | null {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let started = false;

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index]!;
    if (quote !== null) {
      if (character === quote) {
        quote = null;
        continue;
      }
      if (character === "\\" && quote === '"' && command[index + 1] === '"') {
        current += '"';
        index += 1;
        continue;
      }
      current += character;
      started = true;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      started = true;
      continue;
    }
    if (/\s/.test(character)) {
      if (started) {
        tokens.push(current);
        current = "";
        started = false;
      }
      continue;
    }
    current += character;
    started = true;
  }

  if (quote !== null) return null;
  if (started) tokens.push(current);
  return tokens;
}

function commandTokens(command: BackgroundNotificationCommand): string[] | null {
  if (typeof command === "string") return tokenizeCommand(command);
  const tokens = command.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  if (tokens.length === 1) return tokenizeCommand(tokens[0]!);
  return tokens;
}

function pathLeaf(value: string): string {
  const withoutQuery = value.split(/[?#]/, 1)[0] ?? value;
  const normalized = withoutQuery.replace(/\\/g, "/").replace(/\/+$/, "");
  const leaf = normalized.slice(normalized.lastIndexOf("/") + 1);
  try {
    return decodeURIComponent(leaf) || "file";
  } catch {
    return leaf || "file";
  }
}

function programName(value: string): string {
  return pathLeaf(value).replace(/\.exe$/i, "");
}

function isAbsoluteLocalPath(value: string): boolean {
  return (
    WINDOWS_ABSOLUTE_PATH_PATTERN.test(value) ||
    value.startsWith("\\\\") ||
    value.startsWith("/") ||
    FILE_URL_PATTERN.test(value)
  );
}

function wrapperName(value: string): string {
  return programName(value).toLowerCase();
}

function parseCommandTail(tokens: ReadonlyArray<string>, start: number): string[] | null {
  const tail = tokens.slice(start);
  if (tail.length === 0) return null;
  return tail.length === 1 ? tokenizeCommand(tail[0]!) : [...tail];
}

function unwrapCommand(
  originalTokens: ReadonlyArray<string>,
  depth = 0,
): { readonly tokens: string[]; readonly unwrapped: boolean } | null {
  if (depth > 5 || originalTokens.length === 0) return null;
  const tokens = originalTokens[0] === "&" ? originalTokens.slice(1) : [...originalTokens];
  if (tokens.length === 0) return null;
  const wrapper = wrapperName(tokens[0]!);

  if (wrapper === "pwsh" || wrapper === "powershell") {
    if (tokens.some((token) => /^-(?:encodedcommand|enc)$/i.test(token))) return null;
    const commandIndex = tokens.findIndex((token) => /^-(?:command|c)$/i.test(token));
    if (commandIndex < 0) return { tokens, unwrapped: false };
    const inner = parseCommandTail(tokens, commandIndex + 1);
    if (inner === null) return null;
    const nested = unwrapCommand(inner, depth + 1);
    return nested === null ? null : { tokens: nested.tokens, unwrapped: true };
  }

  if (wrapper === "cmd") {
    const commandIndex = tokens.findIndex((token) => /^\/(?:c|k)$/i.test(token));
    if (commandIndex < 0) return { tokens, unwrapped: false };
    const inner = parseCommandTail(tokens, commandIndex + 1);
    if (inner === null) return null;
    const nested = unwrapCommand(inner, depth + 1);
    return nested === null ? null : { tokens: nested.tokens, unwrapped: true };
  }

  if (["bash", "sh", "zsh", "fish"].includes(wrapper)) {
    const commandIndex = tokens.findIndex((token) => /^-[a-z]*c[a-z]*$/i.test(token));
    if (commandIndex < 0) return { tokens, unwrapped: false };
    const inner = parseCommandTail(tokens, commandIndex + 1);
    if (inner === null) return null;
    const nested = unwrapCommand(inner, depth + 1);
    return nested === null ? null : { tokens: nested.tokens, unwrapped: true };
  }

  if (wrapper === "wsl") {
    let index = 1;
    while (index < tokens.length) {
      const token = tokens[index]!;
      if (token === "--" || token === "-e" || token === "--exec") {
        index += 1;
        break;
      }
      if (["-d", "--distribution", "-u", "--user", "--cd"].includes(token)) {
        index += 2;
        continue;
      }
      if (token.startsWith("-")) {
        index += 1;
        continue;
      }
      break;
    }
    const inner = parseCommandTail(tokens, index);
    if (inner === null) return null;
    const nested = unwrapCommand(inner, depth + 1);
    return nested === null ? null : { tokens: nested.tokens, unwrapped: true };
  }

  return { tokens, unwrapped: originalTokens[0] === "&" };
}

function containsSensitiveDetail(tokens: ReadonlyArray<string>): boolean {
  for (const token of tokens) {
    if (
      SENSITIVE_FLAG_PATTERN.test(token) ||
      SENSITIVE_ASSIGNMENT_PATTERN.test(token) ||
      /^bearer$/i.test(token) ||
      /^authorization:/i.test(token) ||
      /^[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/i.test(token)
    ) {
      return true;
    }
  }
  return false;
}

function sanitizeToken(token: string, index: number): string {
  const equalsIndex = token.indexOf("=");
  if (equalsIndex > 0) {
    const prefix = token.slice(0, equalsIndex + 1);
    const value = token.slice(equalsIndex + 1);
    if (isAbsoluteLocalPath(value)) return `${prefix}${pathLeaf(value)}`;
  }
  if (!isAbsoluteLocalPath(token)) return token;
  return index === 0 ? programName(token) : pathLeaf(token);
}

function quoteToken(token: string): string {
  return /\s/.test(token) ? `"${token.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : token;
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}

export function presentBackgroundNotificationCommand(
  command: BackgroundNotificationCommand,
): string | null {
  const tokens = commandTokens(command);
  if (tokens === null || tokens.length === 0 || tokens.length > 64) return null;
  const unwrapped = unwrapCommand(tokens);
  if (unwrapped === null || unwrapped.tokens.length === 0) return null;
  if (
    containsSensitiveDetail(unwrapped.tokens) ||
    unwrapped.tokens.some((token) => SHELL_CONTROL_TOKEN_PATTERN.test(token))
  ) {
    return null;
  }

  let changed = unwrapped.unwrapped;
  const sanitized = unwrapped.tokens.map((token, index) => {
    const next = sanitizeToken(token, index);
    if (next !== token) changed = true;
    return next;
  });
  if (sanitized.some((token) => token.length === 0 || hasControlCharacter(token))) {
    return null;
  }

  if (!changed && typeof command === "string") return compact(command);
  const presented = sanitized.map(quoteToken).join(" ");
  return presented.length > 0 ? presented : null;
}
