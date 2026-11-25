// Minimal filesystem surface the server half needs; node:fs/promises satisfies it structurally.
export interface StatLike {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  readonly mode: number;
  readonly uid: number;
  readonly mtimeMs: number;
}

export interface FsLike {
  lstat(path: string): Promise<StatLike>;
  stat(path: string): Promise<StatLike>;
  realpath(path: string): Promise<string>;
  access(path: string, mode: number): Promise<void>;
  mkdtemp(prefix: string): Promise<string>;
  rm(path: string, options: { recursive: true; force: true }): Promise<void>;
}
