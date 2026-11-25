import type { FsLike, StatLike } from "../server/fs-like.ts";

export type Entry =
  | { kind: "file"; mode?: number; uid?: number; mtimeMs?: number; size?: number; ino?: number }
  | { kind: "dir"; mode?: number; uid?: number; readable?: boolean }
  | { kind: "link"; target: string };

// In-memory FsLike. Defaults: mode 0o755, uid 1000. Links resolve one hop.
export function fakeFs(entries: Record<string, Entry>): FsLike & { removed: string[]; made: string[] } {
  const removed: string[] = [];
  const made: string[] = [];
  const err = (code: string): Error => Object.assign(new Error(code), { code });
  const resolve = (p: string): string => {
    const e = entries[p];
    return e?.kind === "link" ? e.target : p;
  };
  // Ancestors of declared entries exist implicitly as owner-1000 0755 dirs unless declared.
  const implicitDir = (p: string): Entry | undefined =>
    p === "/" || Object.keys(entries).some((k) => k.startsWith(`${p}/`)) ? { kind: "dir" } : undefined;
  const at = (p: string): Entry | undefined => entries[p] ?? implicitDir(p);
  const stat = (e: Entry): StatLike => ({
    isFile: () => e.kind === "file",
    isDirectory: () => e.kind === "dir",
    isSymbolicLink: () => e.kind === "link",
    mode: e.kind === "link" ? 0o777 : (e.mode ?? 0o755),
    uid: e.kind === "link" ? 1000 : (e.uid ?? 1000),
    mtimeMs: e.kind === "file" ? (e.mtimeMs ?? 1) : 1,
    size: e.kind === "file" ? (e.size ?? 10) : 0,
    ino: e.kind === "file" ? (e.ino ?? 5) : 0,
  });
  return {
    removed,
    made,
    async lstat(p) {
      const e = at(p);
      if (!e) throw err("ENOENT");
      return stat(e);
    },
    async stat(p) {
      const e = at(resolve(p));
      if (!e) throw err("ENOENT");
      return stat(e);
    },
    async realpath(p) {
      if (!at(p)) throw err("ENOENT");
      return resolve(p);
    },
    async access(p) {
      const e = entries[resolve(p)];
      if (!e) throw err("ENOENT");
      if (e.kind === "dir" && e.readable === false) throw err("EACCES");
    },
    async mkdtemp(prefix) {
      const p = `${prefix}${made.length}`;
      made.push(p);
      entries[p] = { kind: "dir" };
      return p;
    },
    async rm(p) {
      removed.push(p);
      delete entries[p];
    },
  };
}
