import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  ProviderDriverKind,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import { resolveAttachmentPath } from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import {
  detectSupportedImageMime,
  extractAssistantImageInputs,
  persistAssistantImageInputs,
} from "./AssistantImageAttachments.ts";

const ONE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2ZQAAAABJRU5ErkJggg==";
const MINIMAL_JPEG_BASE64 = "/9j/2Q==";
const testLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3-assistant-image-test-",
}).pipe(Layer.provideMerge(NodeServices.layer));

describe("extractAssistantImageInputs", () => {
  it("extracts multiple MCP image blocks while ignoring adjacent text", () => {
    expect(
      extractAssistantImageInputs({
        item: {
          type: "mcpToolCall",
          result: {
            content: [
              { type: "text", text: "rendered two images" },
              { type: "image", data: ONE_PIXEL_PNG_BASE64, mimeType: "image/png" },
              { type: "image", data: MINIMAL_JPEG_BASE64, mime_type: "image/jpeg" },
            ],
          },
        },
      }),
    ).toEqual([
      {
        _tag: "base64",
        base64: ONE_PIXEL_PNG_BASE64,
        mimeType: "image/png",
        name: "assistant-image.png",
      },
      {
        _tag: "base64",
        base64: MINIMAL_JPEG_BASE64,
        mimeType: "image/jpeg",
        name: "assistant-image.jpg",
      },
    ]);
  });

  it("deduplicates repeated provider delivery and enforces the attachment count limit", () => {
    const content = Array.from({ length: PROVIDER_SEND_TURN_MAX_ATTACHMENTS + 3 }, (_, index) => ({
      type: "image",
      data: Buffer.from(`image-${index}`).toString("base64"),
      mimeType: "image/png",
    }));
    content.splice(1, 0, content[0]!);
    expect(extractAssistantImageInputs({ content })).toHaveLength(
      PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
    );
  });

  it.each([
    { content: [{ type: "image", data: "not-base64", mimeType: "image/png" }] },
    { content: [{ type: "image", data: ONE_PIXEL_PNG_BASE64, mimeType: "image/webp" }] },
    { content: [{ image_url: `data:image/png;base64,${ONE_PIXEL_PNG_BASE64}` }] },
    { path: "C:\\Users\\jason\\private.png" },
  ])("ignores malformed, unsupported, or implicit image data", (payload) => {
    expect(extractAssistantImageInputs(payload)).toEqual([]);
  });

  it("accepts a local path only from an explicit native Codex image item", () => {
    const payload = {
      item: { type: "imageGeneration", savedPath: "C:\\work files\\generated image.png" },
    };
    expect(
      extractAssistantImageInputs(payload, { provider: ProviderDriverKind.make("claudeAgent") }),
    ).toEqual([]);
    expect(
      extractAssistantImageInputs(payload, { provider: ProviderDriverKind.make("codex") }),
    ).toEqual([
      {
        _tag: "local-file",
        path: "C:\\work files\\generated image.png",
        name: "generated image.png",
      },
    ]);
  });

  it("extracts image content intentionally returned by a dynamic tool", () => {
    expect(
      extractAssistantImageInputs({
        item: {
          type: "dynamicToolCall",
          tool: "render_contact_sheet",
          contentItems: [
            { type: "inputText", text: "contact sheet ready" },
            {
              type: "inputImage",
              imageUrl: `data:image/png;base64,${ONE_PIXEL_PNG_BASE64}`,
            },
          ],
        },
      }),
    ).toEqual([
      {
        _tag: "data-url",
        dataUrl: `data:image/png;base64,${ONE_PIXEL_PNG_BASE64}`,
        name: "assistant-image.png",
      },
    ]);
  });

  it("preserves explicit publish_artifact metadata as the attachment name", () => {
    expect(
      extractAssistantImageInputs({
        item: {
          type: "mcpToolCall",
          tool: "publish_artifact",
          result: {
            structuredContent: {
              name: "contact sheet with spaces.png",
              mimeType: "image/png",
              sizeBytes: 67,
            },
            content: [
              { type: "text", text: "published" },
              { type: "image", data: ONE_PIXEL_PNG_BASE64, mimeType: "image/png" },
            ],
          },
        },
      }),
    ).toEqual([
      {
        _tag: "base64",
        base64: ONE_PIXEL_PNG_BASE64,
        mimeType: "image/png",
        name: "contact sheet with spaces.png",
      },
    ]);
  });

  it("does not publish an imageView item that only records agent inspection", () => {
    expect(
      extractAssistantImageInputs(
        {
          item: {
            type: "imageView",
            id: "viewed-image-1",
            path: "C:\\work files\\private reference.png",
          },
        },
        { provider: ProviderDriverKind.make("codex") },
      ),
    ).toEqual([]);
  });

  it("rejects oversized image data before decoding", () => {
    const oversizedBase64 = "A".repeat(Math.ceil(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES / 3) * 4 + 4);
    expect(
      extractAssistantImageInputs({
        content: [{ type: "image", data: oversizedBase64, mimeType: "image/png" }],
      }),
    ).toEqual([]);
  });
});

describe("persistAssistantImageInputs", () => {
  it("detects the supported raster signatures", () => {
    expect(detectSupportedImageMime(Buffer.from(ONE_PIXEL_PNG_BASE64, "base64"))).toBe("image/png");
    expect(detectSupportedImageMime(Buffer.from(MINIMAL_JPEG_BASE64, "base64"))).toBe("image/jpeg");
    expect(detectSupportedImageMime(Buffer.from("not an image"))).toBeNull();
  });

  it.effect("copies validated bytes into the thread attachment store", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const config = yield* ServerConfig.ServerConfig;
      const [attachment] = yield* persistAssistantImageInputs({
        threadId: ThreadId.make("thread-assistant-image"),
        inputs: [
          {
            _tag: "base64",
            base64: ONE_PIXEL_PNG_BASE64,
            mimeType: "image/png",
            name: "contact sheet.png",
          },
        ],
      });
      expect(attachment).toEqual(
        expect.objectContaining({
          type: "image",
          name: "contact sheet.png",
          mimeType: "image/png",
          sizeBytes: 67,
        }),
      );
      if (!attachment) return;
      const storedPath = resolveAttachmentPath({
        attachmentsDir: config.attachmentsDir,
        attachment,
      });
      expect(storedPath).not.toBeNull();
      if (!storedPath) return;
      expect(yield* fs.readFile(storedPath)).toEqual(Buffer.from(ONE_PIXEL_PNG_BASE64, "base64"));
      expect(attachment).not.toHaveProperty("path");
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("rejects a declared MIME that does not match the file signature", () =>
    Effect.gen(function* () {
      expect(
        yield* persistAssistantImageInputs({
          threadId: ThreadId.make("thread-mime-mismatch"),
          inputs: [
            {
              _tag: "base64",
              base64: ONE_PIXEL_PNG_BASE64,
              mimeType: "image/jpeg",
              name: "wrong.jpg",
            },
          ],
        }),
      ).toEqual([]);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("copies an explicitly approved native output instead of retaining its path", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const sourcePath = yield* fs.makeTempFileScoped({
          prefix: "assistant output with spaces ",
          suffix: ".png",
        });
        yield* fs.writeFile(sourcePath, Buffer.from(ONE_PIXEL_PNG_BASE64, "base64"));
        const [attachment] = yield* persistAssistantImageInputs({
          threadId: ThreadId.make("thread-local-image"),
          inputs: [{ _tag: "local-file", path: sourcePath, name: "generated image.png" }],
        });
        expect(attachment).toEqual(
          expect.objectContaining({ name: "generated image.png", mimeType: "image/png" }),
        );
        expect(attachment).not.toHaveProperty("path");
      }).pipe(Effect.provide(testLayer)),
    ),
  );
});
