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

const STICKY = 0o1000;

// True when `child` equals `parent` or lies under it (any depth). Both must be resolved paths.
export function isInside(child: string, parent: string): boolean {
  const base = parent.endsWith("/") ? parent : `${parent}/`;
  return child === parent || child.startsWith(base);
}

// A directory is trusted when the daemon user or root owns it and others cannot write into it.
// Sticky, root-owned directories (like /tmp) are the one writable exception.
async function dirIsTrusted(fs: FsLike, dir: string, uid: number): Promise<boolean> {
  const st = await fs.stat(dir);
  if (!st.isDirectory() || (st.uid !== uid && st.uid !== 0)) return false;
  if ((st.mode & GROUP_OR_WORLD_WRITABLE) === 0) return true;
  return (st.mode & STICKY) !== 0 && st.uid === 0;
}

function ancestors(path: string): string[] {
  const out: string[] = [];
  for (let d = dirname(path); ; d = dirname(d)) {
    out.push(d);
    if (d === "/") return out;
  }
}

// Validates the configured executable. Never throws: any fs failure is EXE_INVALID.
export async function validateExecutable(path: unknown, deps: { fs: FsLike; uid: number | undefined }): Promise<ExeCheck> {
  if (!isCleanAbsolute(path) || basename(path) !== EXE_BASENAME || deps.uid === undefined) return BAD;
  const { fs } = deps;
  try {
    const real = await fs.realpath(path);
    const st = await fs.stat(real);
    if (!st.isFile() || (st.mode & GROUP_OR_WORLD_WRITABLE) !== 0 || st.uid !== deps.uid) return BAD;
    // Every ancestor of both the configured location and the resolved target, up to "/", must be trusted:
    // a writable grandparent lets someone swap the directory below it.
    for (const dir of new Set([...ancestors(path), ...ancestors(real)])) {
      if (!(await dirIsTrusted(fs, dir, deps.uid))) return BAD;
    }
    return { ok: true, realpath: real, mtimeMs: st.mtimeMs };
  } catch {
    return BAD;
  }
}
