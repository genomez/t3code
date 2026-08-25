import { PROVIDER_SEND_TURN_MAX_IMAGE_BYTES } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Tool } from "effect/unstable/ai";

import { detectSupportedImageMime } from "../orchestration/AssistantImageAttachments.ts";
import * as McpInvocationContext from "./McpInvocationContext.ts";

export const PublishArtifactInput = Schema.Struct({
  path: Schema.String.check(Schema.isMinLength(1)),
  name: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1))),
});
export type PublishArtifactInput = typeof PublishArtifactInput.Type;

const PublishArtifactMetadata = Schema.Struct({
  name: Schema.String,
  mimeType: Schema.Literals(["image/jpeg", "image/png"]),
  sizeBytes: Schema.Number,
});

export const PublishArtifactTool = Tool.make("publish_artifact", {
  description:
    "Publish one JPG or PNG from the active thread workspace as visible assistant message content. Use this only when intentionally presenting the image to the user; do not use it merely because an image was inspected.",
  parameters: PublishArtifactInput,
  success: PublishArtifactMetadata,
  dependencies: [FileSystem.FileSystem, Path.Path, McpInvocationContext.McpInvocationContext],
})
  .annotate(Tool.Title, "Publish image artifact")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

type PublishedArtifactMime = "image/jpeg" | "image/png";

export type PublishedArtifactResult =
  | {
      readonly _tag: "Published";
      readonly bytes: Uint8Array;
      readonly mimeType: PublishedArtifactMime;
      readonly name: string;
      readonly sizeBytes: number;
    }
  | {
      readonly _tag: "Unavailable";
      readonly reason:
        | "workspace-unavailable"
        | "outside-workspace"
        | "file-unavailable"
        | "file-too-large"
        | "unsupported-image";
      readonly message: string;
    };

const unavailable = (
  reason: Extract<PublishedArtifactResult, { _tag: "Unavailable" }>["reason"],
  message: string,
): PublishedArtifactResult => ({ _tag: "Unavailable", reason, message });

const safeImageName = (
  path: Path.Path,
  requestedName: string | undefined,
  sourcePath: string,
  mimeType: PublishedArtifactMime,
): string => {
  const extension = mimeType === "image/png" ? ".png" : ".jpg";
  const candidate = path.basename(requestedName?.trim() || sourcePath).slice(0, 255);
  const candidateExtension = /\.[a-z0-9]{1,8}$/i.exec(candidate)?.[0]?.toLowerCase();
  if (
    candidateExtension === extension ||
    (mimeType === "image/jpeg" && candidateExtension === ".jpeg")
  ) {
    return candidate;
  }
  const stem = candidate.replace(/\.[a-z0-9]{1,8}$/i, "").trim() || "assistant-image";
  return `${stem}${extension}`;
};

/**
 * Loads only a canonical JPG/PNG contained by the active thread workspace.
 * Returning bytes from the explicit MCP tool call is the publication boundary;
 * ordinary imageView activity never reaches this function.
 */
export const loadPublishedArtifact = Effect.fn("ArtifactPublication.loadPublishedArtifact")(
  function* (input: {
    readonly workspaceRoot: string | undefined;
    readonly artifact: PublishArtifactInput;
  }): Effect.fn.Return<PublishedArtifactResult, never, FileSystem.FileSystem | Path.Path> {
    if (!input.workspaceRoot) {
      return unavailable(
        "workspace-unavailable",
        "Image unavailable: this thread has no active workspace.",
      );
    }

    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const requestedPath = input.artifact.path.trim();
    const candidatePath = path.isAbsolute(requestedPath)
      ? requestedPath
      : path.resolve(input.workspaceRoot, requestedPath);
    const [canonicalRoot, canonicalFile] = yield* Effect.all([
      fileSystem.realPath(input.workspaceRoot).pipe(Effect.option),
      fileSystem.realPath(candidatePath).pipe(Effect.option),
    ]);
    if (Option.isNone(canonicalRoot) || Option.isNone(canonicalFile)) {
      return unavailable("file-unavailable", "Image unavailable: the file could not be found.");
    }

    const relativePath = path.relative(canonicalRoot.value, canonicalFile.value);
    if (
      relativePath === "" ||
      relativePath === ".." ||
      relativePath.split(/[\\/]/)[0] === ".." ||
      path.isAbsolute(relativePath)
    ) {
      return unavailable(
        "outside-workspace",
        "Image unavailable: this path is outside the active thread workspace.",
      );
    }

    const info = yield* fileSystem.stat(canonicalFile.value).pipe(Effect.option);
    if (Option.isNone(info) || info.value.type !== "File" || info.value.size <= 0n) {
      return unavailable("file-unavailable", "Image unavailable: the path is not a file.");
    }
    if (info.value.size > BigInt(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES)) {
      return unavailable(
        "file-too-large",
        `Image unavailable: files must be ${PROVIDER_SEND_TURN_MAX_IMAGE_BYTES} bytes or smaller.`,
      );
    }

    const bytes = yield* fileSystem.readFile(canonicalFile.value).pipe(Effect.option);
    if (Option.isNone(bytes)) {
      return unavailable("file-unavailable", "Image unavailable: the file could not be read.");
    }
    const mimeType = detectSupportedImageMime(bytes.value);
    if (!mimeType || bytes.value.byteLength > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
      return unavailable(
        "unsupported-image",
        "Image unavailable: only validated JPG and PNG files can be published.",
      );
    }

    return {
      _tag: "Published",
      bytes: bytes.value,
      mimeType,
      name: safeImageName(path, input.artifact.name, canonicalFile.value, mimeType),
      sizeBytes: bytes.value.byteLength,
    };
  },
);
