import { describe, expect, it } from "vite-plus/test";

import {
  isMarkdownFileLinkOutsideWorkspace,
  normalizeCodeBlockClipboardText,
  orderedListGutterStyle,
  resolveMarkdownFileLinkPrimaryAction,
} from "./ChatMarkdown";

describe("isMarkdownFileLinkOutsideWorkspace", () => {
  it("blocks links that cannot be resolved inside the active workspace", () => {
    expect(isMarkdownFileLinkOutsideWorkspace(null)).toBe(true);
    expect(isMarkdownFileLinkOutsideWorkspace("output/contact sheet.jpg")).toBe(false);
  });

  it("never falls back to editor or browser launch for an outside-workspace path", () => {
    expect(
      resolveMarkdownFileLinkPrimaryAction({
        workspaceRelativePath: null,
        openInEditor: true,
        hasBrowserPreview: true,
      }),
    ).toBe("unavailable");
  });

  it("preserves ordinary actions for workspace files", () => {
    const workspaceRelativePath = "output/contact sheet.jpg";
    expect(
      resolveMarkdownFileLinkPrimaryAction({
        workspaceRelativePath,
        openInEditor: true,
        hasBrowserPreview: true,
      }),
    ).toBe("editor");
    expect(
      resolveMarkdownFileLinkPrimaryAction({
        workspaceRelativePath,
        openInEditor: false,
        hasBrowserPreview: true,
      }),
    ).toBe("browser");
    expect(
      resolveMarkdownFileLinkPrimaryAction({
        workspaceRelativePath,
        openInEditor: false,
        hasBrowserPreview: false,
      }),
    ).toBe("preview");
  });
});

describe("normalizeCodeBlockClipboardText", () => {
  it.each([
    ["NOZZLECAM_EXPOSURE VALUE=300\n", "NOZZLECAM_EXPOSURE VALUE=300"],
    ["first\nsecond\n", "first\nsecond"],
    ["first\nsecond\n\n", "first\nsecond\n"],
    ["first\r\nsecond\r\n", "first\r\nsecond"],
    ["trailing spaces  \n", "trailing spaces  "],
    ["already exact", "already exact"],
    ["", ""],
  ])("removes exactly one structural terminal line ending from %j", (input, expected) => {
    expect(normalizeCodeBlockClipboardText(input)).toBe(expected);
  });
});

describe("orderedListGutterStyle", () => {
  it("leaves the default gutter alone for single-digit lists", () => {
    expect(orderedListGutterStyle(9, undefined)).toBeUndefined();
  });

  it("leaves the default gutter alone for two-digit lists", () => {
    expect(orderedListGutterStyle(99, undefined)).toBeUndefined();
  });

  it("leaves the default gutter alone for a two-digit list that starts above 1", () => {
    // start=50 + 49 items => last marker is "98", still two digits.
    expect(orderedListGutterStyle(49, 50)).toBeUndefined();
  });

  it("widens the gutter once the last marker reaches three digits", () => {
    // item 100 is the bug from #6512: a 100-item list starting at 1.
    expect(orderedListGutterStyle(100, undefined)).toEqual({ "--list-gutter": "4ch" });
  });

  it("accounts for a non-default start attribute", () => {
    // start=95 + 9 items => last marker is "103", three digits.
    expect(orderedListGutterStyle(9, 95)).toEqual({ "--list-gutter": "4ch" });
    expect(orderedListGutterStyle(5, "999995")).toEqual({ "--list-gutter": "7ch" });
  });

  it("scales further for four-digit markers", () => {
    expect(orderedListGutterStyle(1000, undefined)).toEqual({ "--list-gutter": "5ch" });
  });

  it("uses the widest marker and includes a negative start's minus sign", () => {
    expect(orderedListGutterStyle(1001, -1000)).toEqual({ "--list-gutter": "6ch" });
    expect(orderedListGutterStyle(3, -15)).toEqual({ "--list-gutter": "4ch" });
    expect(orderedListGutterStyle(3, -5)).toBeUndefined();
  });

  it("treats a missing/zero item count as a single item", () => {
    expect(orderedListGutterStyle(0, undefined)).toBeUndefined();
    expect(orderedListGutterStyle(0, 100)).toEqual({ "--list-gutter": "4ch" });
  });
});
