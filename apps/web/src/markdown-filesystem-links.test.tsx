import { describe, expect, it } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

import { CHAT_MARKDOWN_SANITIZE_SCHEMA } from "./components/ChatMarkdown";
import { remarkFilesystemLinkDestinations } from "./markdown-filesystem-links";
import { rewriteMarkdownFileUriHref } from "./markdown-links";

function renderChatMarkdown(markdown: string, options: { readonly parseRawHtml: boolean }): string {
  return renderToStaticMarkup(
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkFilesystemLinkDestinations]}
      rehypePlugins={
        options.parseRawHtml
          ? [rehypeRaw, [rehypeSanitize, CHAT_MARKDOWN_SANITIZE_SCHEMA]]
          : undefined
      }
      skipHtml={false}
      urlTransform={(href) => rewriteMarkdownFileUriHref(href) ?? defaultUrlTransform(href)}
    >
      {markdown}
    </ReactMarkdown>,
  );
}

describe("remarkFilesystemLinkDestinations", () => {
  for (const parseRawHtml of [true, false]) {
    it(`keeps a drive destination with parseRawHtml=${parseRawHtml}`, () => {
      expect(renderChatMarkdown("[Open](D:/tmp/example.md)", { parseRawHtml })).toContain(
        'href="D:/tmp/example.md"',
      );
    });

    it(`keeps a backslash drive destination with parseRawHtml=${parseRawHtml}`, () => {
      expect(
        renderChatMarkdown("[Open](M:\\batches\\docs\\prompt.md)", { parseRawHtml }),
      ).toContain('href="M:/batches/docs/prompt.md"');
    });

    it(`keeps a reference definition destination with parseRawHtml=${parseRawHtml}`, () => {
      expect(
        renderChatMarkdown("[Open][ref]\n\n[ref]: D:/tmp/example.md", { parseRawHtml }),
      ).toContain('href="D:/tmp/example.md"');
    });

    it(`keeps destinations the metadata scan misses with parseRawHtml=${parseRawHtml}`, () => {
      expect(renderChatMarkdown("[Open](D:/tmp/example(1).md)", { parseRawHtml })).toContain(
        'href="D:/tmp/example(1).md"',
      );
      expect(
        renderChatMarkdown("[Open](<D:/Program Files/example.md>)", { parseRawHtml }),
      ).toContain('href="D:/Program%20Files/example.md"');
    });

    it(`still drops an unsafe scheme with parseRawHtml=${parseRawHtml}`, () => {
      const html = renderChatMarkdown("[Click](javascript:alert(1))", { parseRawHtml });
      expect(html).not.toContain("javascript:");
    });

    it(`leaves ordinary destinations alone with parseRawHtml=${parseRawHtml}`, () => {
      expect(renderChatMarkdown("[Docs](https://example.com/docs)", { parseRawHtml })).toContain(
        'href="https://example.com/docs"',
      );
    });
  }
});
