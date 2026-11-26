import { constants } from "node:fs";
import type { FsLike } from "./fs-like.ts";
import { isCleanAbsolute } from "./validate-exe.ts";

const PROJECT_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const isValidProject = (p: unknown): p is string => typeof p === "string" && PROJECT_RE.test(p);

// The exporter's own limit for a recorded input.
export const MAX_INPUT_BYTES = 4 * 1024 * 1024;

export type InputFileCheck =
  | { readonly ok: true; readonly realpath: string }
  | { readonly ok: false; readonly code: "INPUT_INVALID" };

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

// A recorded input: a clean absolute path whose realpath is a readable regular file within the size cap.
// The realpath is what gets passed on, because the exporter refuses symlinks. Never throws.
export async function validateInputFile(path: unknown, deps: { fs: FsLike }): Promise<InputFileCheck> {
  const bad: InputFileCheck = { ok: false, code: "INPUT_INVALID" };
  if (!isCleanAbsolute(path)) return bad;
  try {
    const real = await deps.fs.realpath(path);
    const st = await deps.fs.stat(real);
    if (!st.isFile() || st.size > MAX_INPUT_BYTES) return bad;
    await deps.fs.access(real, constants.R_OK);
    return { ok: true, realpath: real };
  } catch {
    return bad;
  }
}
