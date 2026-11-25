import { basename, dirname, isAbsolute } from "node:path";
import type { FsLike } from "./fs-like.ts";

export const EXE_BASENAME = "etat-major";
const GROUP_OR_WORLD_WRITABLE = 0o022;

export type ExeCheck =
  | { readonly ok: true; readonly realpath: string; readonly mtimeMs: number }
  | { readonly ok: false; readonly code: "EXE_INVALID" };

const BAD: ExeCheck = { ok: false, code: "EXE_INVALID" };

export function isCleanAbsolute(p: unknown): p is string {
  return typeof p === "string" && p.length > 0 && !p.includes("\0") && isAbsolute(p) && !p.split("/").includes("..");
}

async function dirIsTight(fs: FsLike, dir: string): Promise<boolean> {
  const st = await fs.stat(dir);
  return st.isDirectory() && (st.mode & GROUP_OR_WORLD_WRITABLE) === 0;
}

// Validates the configured executable. Never throws: any fs failure is EXE_INVALID.
export async function validateExecutable(path: unknown, deps: { fs: FsLike; uid: number | undefined }): Promise<ExeCheck> {
  if (!isCleanAbsolute(path) || basename(path) !== EXE_BASENAME || deps.uid === undefined) return BAD;
  const { fs } = deps;
  try {
    const real = await fs.realpath(path);
    const st = await fs.stat(real);
    if (!st.isFile() || (st.mode & GROUP_OR_WORLD_WRITABLE) !== 0 || st.uid !== deps.uid) return BAD;
    // Both the configured location and the resolved target must sit in non-shared directories.
    for (const dir of new Set([dirname(path), dirname(real)])) {
      if (!(await dirIsTight(fs, dir))) return BAD;
    }
    return { ok: true, realpath: real, mtimeMs: st.mtimeMs };
  } catch {
    return BAD;
  }
}
