import { resolveWorkspaceRelativeFilePath } from "../files/filePath";

export type ThreadMarkdownFileAction =
  | { readonly _tag: "Open"; readonly relativePath: string }
  | { readonly _tag: "Unavailable"; readonly message: string };

export function resolveThreadMarkdownFileAction(
  workspaceRoot: string | null | undefined,
  targetPath: string,
): ThreadMarkdownFileAction {
  if (!workspaceRoot) {
    return {
      _tag: "Unavailable",
      message: "This file is not available because the thread workspace is unknown.",
    };
  }
  const relativePath = resolveWorkspaceRelativeFilePath(workspaceRoot, targetPath);
  if (!relativePath) {
    return {
      _tag: "Unavailable",
      message: "This path is outside the thread workspace and cannot be opened on this client.",
    };
  }
  return { _tag: "Open", relativePath };
}
