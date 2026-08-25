import { describe, expect, it } from "vite-plus/test";

import { resolveThreadMarkdownFileAction } from "./threadMarkdownFileAction";

describe("resolveThreadMarkdownFileAction", () => {
  it("opens a Windows workspace path containing spaces through the host", () => {
    expect(
      resolveThreadMarkdownFileAction(
        "C:\\Users\\jason\\OneDrive\\Documents\\Project With Spaces",
        "C:\\Users\\jason\\OneDrive\\Documents\\Project With Spaces\\output\\image one.png",
      ),
    ).toEqual({ _tag: "Open", relativePath: "output/image one.png" });
  });

  it("explains why an outside path is unavailable", () => {
    expect(
      resolveThreadMarkdownFileAction(
        "C:\\Users\\jason\\workspace",
        "C:\\Users\\jason\\private\\secret.png",
      ),
    ).toEqual({
      _tag: "Unavailable",
      message: "This path is outside the thread workspace and cannot be opened on this client.",
    });
  });

  it("explains why a path cannot open without a known workspace", () => {
    expect(resolveThreadMarkdownFileAction(null, "C:\\work\\image.png")._tag).toBe("Unavailable");
  });
});
