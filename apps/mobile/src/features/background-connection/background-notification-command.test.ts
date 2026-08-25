import { describe, expect, it } from "vite-plus/test";

import { presentBackgroundNotificationCommand } from "./background-notification-command";

describe("persistent notification command presentation", () => {
  it("unwraps a quoted WindowsApps PowerShell launcher and removes local path prefixes", () => {
    expect(
      presentBackgroundNotificationCommand(
        '"C:\\Program Files\\WindowsApps\\Microsoft.PowerShell_7.5.2.0_x64__8wekyb3d8bbwe\\pwsh.exe" -NoLogo -Command "Get-Content \'C:\\Users\\jason\\work files\\status.txt\'"',
      ),
    ).toBe("Get-Content status.txt");
  });

  it.each([
    ['powershell.exe -Command "git status --short"', "git status --short"],
    ['cmd.exe /d /c "git status --short"', "git status --short"],
    ['bash -lc "python /home/jason/work/task.py"', "python task.py"],
    ['wsl.exe -- bash -lc "git status --short"', "git status --short"],
  ])("unwraps %s", (command, expected) => {
    expect(presentBackgroundNotificationCommand(command)).toBe(expected);
  });

  it("preserves useful ordinary remote and Git commands", () => {
    expect(presentBackgroundNotificationCommand("ssh ubuntu 'docker compose ps'")).toBe(
      "ssh ubuntu 'docker compose ps'",
    );
    expect(presentBackgroundNotificationCommand(["git", "status", "--short"])).toBe(
      "git status --short",
    );
  });

  it("handles array wrappers without exposing their absolute executable or file paths", () => {
    expect(
      presentBackgroundNotificationCommand([
        "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
        "-Command",
        "Get-ChildItem 'C:\\Users\\jason\\Documents'",
      ]),
    ).toBe("Get-ChildItem Documents");
  });

  it("reduces absolute executable and file arguments when no wrapper is present", () => {
    expect(
      presentBackgroundNotificationCommand(
        '"C:\\Program Files\\Git\\bin\\git.exe" diff C:\\Users\\jason\\work\\change.patch',
      ),
    ).toBe("git diff change.patch");
  });

  it.each([
    "curl --header 'Authorization: Bearer secret-value' https://example.test",
    "tool --api-key=secret-value run",
    "TOKEN=secret-value deploy",
    "curl https://user:password@example.test/private",
    "pwsh -EncodedCommand c2VjcmV0",
    "git status && echo done",
    "unterminated 'command",
  ])("falls back for sensitive or ambiguous input: %s", (command) => {
    expect(presentBackgroundNotificationCommand(command)).toBeNull();
  });
});
