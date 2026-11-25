import { constants } from "node:fs";
import type { FsLike } from "./fs-like.ts";
import { isCleanAbsolute } from "./validate-exe.ts";

const PROJECT_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const isValidProject = (p: unknown): p is string => typeof p === "string" && PROJECT_RE.test(p);

export type WorkspaceCheck =
  | { readonly ok: true; readonly realpath: string }
  | { readonly ok: false; readonly code: "WORKSPACE_INVALID" };

// Absolute, no ".." segment, realpath resolves to a readable, searchable directory. Never throws.
export async function validateWorkspace(path: unknown, deps: { fs: FsLike }): Promise<WorkspaceCheck> {
  if (!isCleanAbsolute(path)) return { ok: false, code: "WORKSPACE_INVALID" };
  try {
    const real = await deps.fs.realpath(path);
    const st = await deps.fs.stat(real);
    if (!st.isDirectory() || real.split("/").includes("..")) return { ok: false, code: "WORKSPACE_INVALID" };
    await deps.fs.access(real, constants.R_OK | constants.X_OK);
    return { ok: true, realpath: real };
  } catch {
    return { ok: false, code: "WORKSPACE_INVALID" };
  }
}
