import type { ReactNode } from "react";
import { Text as NativeText, type TextStyle } from "react-native";
import { TaskListItem, type CustomRenderers, type MarkdownNode } from "react-native-nitro-markdown";

export interface AndroidSelectableMarkdownRendererStyles {
  readonly paragraph: TextStyle;
  readonly heading: (level: number) => TextStyle;
  /** Text runs directly inside tight list items; block margins belong to the list renderer. */
  readonly listItemText: TextStyle;
}

type RendererComponent = Parameters<NonNullable<CustomRenderers["paragraph"]>>[0]["Renderer"];

/**
 * Mirrors Nitro Markdown's inline-node set except for inline math. Inline math
 * renders a View and cannot be nested under Android's selectable Text.
 */
const SELECTABLE_INLINE_NODE_TYPES = new Set<MarkdownNode["type"]>([
  "text",
  "bold",
  "italic",
  "strikethrough",
  "link",
  "code_inline",
  "soft_break",
  "line_break",
  "html_inline",
]);

/** Images and math must remain on Nitro Markdown's View-based rendering path. */
function hasNonSelectableChild(node: MarkdownNode): boolean {
  return (node.children ?? []).some((child) => !SELECTABLE_INLINE_NODE_TYPES.has(child.type));
}

/** List items already split block children; only inline math is unsafe inside a text run. */
function hasMathInlineChild(node: MarkdownNode): boolean {
  return (node.children ?? []).some((child) => child.type === "math_inline");
}

function childKey(child: MarkdownNode, index: number): string {
  return `${child.type}:${child.beg ?? index}:${child.end ?? index}`;
}

function renderInlineChildren(node: MarkdownNode, Renderer: RendererComponent): ReactNode {
  return node.children?.map((child, index) => (
    <Renderer key={childKey(child, index)} node={child} depth={1} inListItem={false} parentIsText />
  ));
}

/**
 * Wrap each consecutive inline run in selectable native Text while returning
 * nested blocks to Nitro Markdown. This keeps nested lists and image blocks on
 * their existing layout and gesture paths.
 */
function renderSelectableChildren(
  node: MarkdownNode,
  Renderer: RendererComponent,
  textStyle: TextStyle,
): ReactNode[] {
  const children = node.children ?? [];
  const output: ReactNode[] = [];
  let inlineRun: { child: MarkdownNode; index: number }[] = [];

  const flushInlineRun = () => {
    if (inlineRun.length === 0) return;
    const first = inlineRun[0]!;
    output.push(
      <NativeText selectable style={textStyle} key={`run:${childKey(first.child, first.index)}`}>
        {inlineRun.map(({ child, index }) => (
          <Renderer
            key={childKey(child, index)}
            node={child}
            depth={1}
            inListItem={false}
            parentIsText
          />
        ))}
      </NativeText>,
    );
    inlineRun = [];
  };

  children.forEach((child, index) => {
    if (SELECTABLE_INLINE_NODE_TYPES.has(child.type)) {
      inlineRun.push({ child, index });
      return;
    }
    flushInlineRun();
    output.push(
      <Renderer
        key={childKey(child, index)}
        node={child}
        depth={1}
        inListItem
        parentIsText={false}
      />,
    );
  });
  flushInlineRun();

  return output;
}

export interface AndroidSelectableHeadingStyleInput {
  readonly fontSizes: Readonly<Record<"h1" | "h2" | "h3" | "h4" | "h5" | "h6", number>>;
  readonly borderColor: string;
  readonly borderSpacing: number;
  readonly override: TextStyle | undefined;
}

const HEADING_LETTER_SPACING: Readonly<Record<number, number>> = { 1: -0.6, 2: -0.4 };
const HEADING_LINE_HEIGHT_RATIO = 1.3;

function headingFontSizeKey(level: number): "h1" | "h2" | "h3" | "h4" | "h5" | "h6" {
  switch (level) {
    case 1:
      return "h1";
    case 2:
      return "h2";
    case 3:
      return "h3";
    case 4:
      return "h4";
    case 5:
      return "h5";
    default:
      return "h6";
  }
}

/** Rebuild Nitro Markdown's heading decoration for the selectable replacement. */
export function createAndroidSelectableHeadingStyle(
  input: AndroidSelectableHeadingStyleInput,
): (level: number) => TextStyle {
  return (level) => {
    const fontSize = input.fontSizes[headingFontSizeKey(level)];
    return {
      fontWeight: "700",
      fontSize,
      lineHeight: fontSize * HEADING_LINE_HEIGHT_RATIO,
      letterSpacing: HEADING_LETTER_SPACING[level] ?? -0.2,
      includeFontPadding: false,
      ...(level === 1
        ? {
            borderBottomWidth: 1,
            borderBottomColor: input.borderColor,
            paddingBottom: input.borderSpacing,
          }
        : null),
      ...input.override,
    };
  };
}

export function createAndroidSelectableMarkdownRenderers(
  styles: AndroidSelectableMarkdownRendererStyles,
): Pick<CustomRenderers, "heading" | "paragraph" | "list_item" | "task_list_item"> {
  return {
    paragraph: ({ node, Renderer }) => {
      if (hasNonSelectableChild(node)) return undefined;
      return (
        <NativeText selectable style={styles.paragraph}>
          {renderInlineChildren(node, Renderer)}
        </NativeText>
      );
    },
    heading: ({ node, Renderer, level = 1 }) => (
      <NativeText selectable style={styles.heading(level)}>
        {renderInlineChildren(node, Renderer)}
      </NativeText>
    ),
    list_item: ({ node, Renderer }) => {
      if (hasMathInlineChild(node)) return undefined;
      return <>{renderSelectableChildren(node, Renderer, styles.listItemText)}</>;
    },
    task_list_item: ({ node, Renderer, checked = false }) => {
      if (hasMathInlineChild(node)) return undefined;
      return (
        <TaskListItem checked={checked}>
          {renderSelectableChildren(node, Renderer, styles.listItemText)}
        </TaskListItem>
      );
    },
  };
}
