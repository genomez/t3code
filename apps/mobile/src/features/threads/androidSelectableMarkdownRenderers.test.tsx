import { isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("react-native", () => ({ Text: "Text" }));
vi.mock("react-native-nitro-markdown", () => ({ TaskListItem: "TaskListItem" }));

import {
  createAndroidSelectableHeadingStyle,
  createAndroidSelectableMarkdownRenderers,
} from "./androidSelectableMarkdownRenderers";

const STYLES = {
  paragraph: { color: "#111111", includeFontPadding: false, width: "100%" as const },
  heading: () => ({ color: "#222222" }),
  listItemText: { color: "#333333", includeFontPadding: false },
};

function assertElement(value: unknown): ReactElement {
  if (!isValidElement(value)) throw new Error("Expected a React element");
  return value;
}

describe("createAndroidSelectableMarkdownRenderers", () => {
  it.each(["paragraph", "heading"] as const)("renders %s as selectable native text", (kind) => {
    const renderers = createAndroidSelectableMarkdownRenderers(STYLES);
    const Renderer = () => null;
    const element = assertElement(
      renderers[kind]?.({
        children: null,
        Renderer,
        node: { type: kind, children: [{ type: "text", content: "select these words" }] },
        ...(kind === "heading" ? { level: 2 as const } : {}),
      }),
    );
    expect(element.props).toMatchObject({
      selectable: true,
      style: kind === "paragraph" ? STYLES.paragraph : STYLES.heading(),
    });
    const child = (element.props as { children: ReactElement[] }).children[0]!;
    expect(child.type).toBe(Renderer);
    expect(child.props).toMatchObject({ parentIsText: true });
  });

  it("makes tight-list inline runs selectable and preserves nested blocks", () => {
    const renderers = createAndroidSelectableMarkdownRenderers(STYLES);
    const Renderer = () => null;
    const element = assertElement(
      renderers.list_item?.({
        children: null,
        Renderer,
        node: {
          type: "list_item",
          children: [
            { type: "text", content: "inline " },
            { type: "bold", children: [{ type: "text", content: "run" }] },
            { type: "list", children: [] },
          ],
        },
      }),
    );
    const output = (element.props as { children: unknown[] }).children;
    expect(output).toHaveLength(2);
    expect(assertElement(output[0]).props).toMatchObject({
      selectable: true,
      style: STYLES.listItemText,
    });
    expect(assertElement(output[1]).props).toMatchObject({ parentIsText: false, inListItem: true });
  });

  it("retains task-list checkbox chrome around selectable content", () => {
    const renderers = createAndroidSelectableMarkdownRenderers(STYLES);
    const element = assertElement(
      renderers.task_list_item?.({
        children: null,
        Renderer: () => null,
        checked: true,
        node: { type: "task_list_item", children: [{ type: "text", content: "done" }] },
      }),
    );
    expect(element.type).toBe("TaskListItem");
    expect(element.props).toMatchObject({ checked: true });
    const content = (element.props as { children: unknown[] }).children;
    expect(assertElement(content[0]).props).toMatchObject({ selectable: true });
  });

  it.each(["image", "math_inline"] as const)(
    "returns paragraphs containing %s to the safe library renderer",
    (type) => {
      const renderers = createAndroidSelectableMarkdownRenderers(STYLES);
      expect(
        renderers.paragraph?.({
          children: null,
          Renderer: () => null,
          node: { type: "paragraph", children: [{ type: "text", content: "look" }, { type }] },
        }),
      ).toBeUndefined();
    },
  );
});

describe("createAndroidSelectableHeadingStyle", () => {
  const heading = createAndroidSelectableHeadingStyle({
    fontSizes: { h1: 24, h2: 20, h3: 18, h4: 16, h5: 15, h6: 14 },
    borderColor: "#cccccc",
    borderSpacing: 4,
    override: { color: "#222222", marginTop: 18, marginBottom: 8 },
  });

  it("preserves the level-one rule and per-level typography", () => {
    expect(heading(1)).toMatchObject({
      borderBottomWidth: 1,
      borderBottomColor: "#cccccc",
      paddingBottom: 4,
      fontSize: 24,
      letterSpacing: -0.6,
    });
    expect(heading(2)).toMatchObject({
      fontSize: 20,
      letterSpacing: -0.4,
      includeFontPadding: false,
    });
    expect(heading(6)).toMatchObject({ fontSize: 14, letterSpacing: -0.2 });
  });
});
