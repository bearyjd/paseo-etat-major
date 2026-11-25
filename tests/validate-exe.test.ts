import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import * as realFs from "node:fs/promises";
import { join } from "node:path";
import { isInside, validateExecutable } from "../server/validate-exe.ts";
import { trustedTmpBase } from "./tmp-base.ts";
import { fakeFs } from "./fake-fs.ts";

const UID = 1000;
const good = () => ({
  "/opt/venv": { kind: "dir" as const },
  "/opt/venv/bin": { kind: "dir" as const },
  "/opt/venv/bin/etat-major": { kind: "file" as const, mode: 0o755, mtimeMs: 42 },
});
const run = (entries: Record<string, never> | ReturnType<typeof good>, path: string, uid = UID) =>
  validateExecutable(path, { fs: fakeFs(entries as never), uid });

test("accepts a regular file and reports realpath + mtime", async () => {
  const r = await run(good(), "/opt/venv/bin/etat-major");
  assert.deepEqual(r, { ok: true, realpath: "/opt/venv/bin/etat-major", mtimeMs: 42 });
});

test("rejects relative, empty, non-string, dotdot and wrong basename", async () => {
  for (const p of ["etat-major", "./bin/etat-major", "", "/opt/venv/../venv/bin/etat-major"]) {
    assert.deepEqual(await run(good(), p), { ok: false, code: "EXE_INVALID" }, p);
  }
  const e = { ...good(), "/opt/venv/bin/other": { kind: "file" as const } };
  assert.deepEqual(await run(e, "/opt/venv/bin/other"), { ok: false, code: "EXE_INVALID" });
  assert.deepEqual(await run(good(), undefined as unknown as string), { ok: false, code: "EXE_INVALID" });
});

test("rejects missing path and directory", async () => {
  assert.equal((await run(good(), "/nope/etat-major")).ok, false);
  const e = { ...good(), "/opt/venv/bin/etat-major": { kind: "dir" as const } };
  assert.deepEqual(await run(e as never, "/opt/venv/bin/etat-major"), { ok: false, code: "EXE_INVALID" });
});

test("rejects group/world-writable file", async () => {
  for (const mode of [0o775, 0o757, 0o777, 0o722]) {
    const e = good();
    e["/opt/venv/bin/etat-major"] = { kind: "file", mode, mtimeMs: 1 };
    assert.equal((await run(e, "/opt/venv/bin/etat-major")).ok, false, mode.toString(8));
  }
});

test("rejects group/world-writable parent dir", async () => {
  const e = { ...good(), "/opt/venv/bin": { kind: "dir" as const, mode: 0o777 } };
  assert.equal((await run(e, "/opt/venv/bin/etat-major")).ok, false);
  const g = { ...good(), "/opt/venv/bin": { kind: "dir" as const, mode: 0o775 } };
  assert.equal((await run(g, "/opt/venv/bin/etat-major")).ok, false);
});

test("rejects file owned by another uid, and accepts when daemon uid matches the owner", async () => {
  const e = good();
  e["/opt/venv/bin/etat-major"] = { kind: "file", mode: 0o755, mtimeMs: 1, uid: 2000 } as never;
  assert.equal((await run(e, "/opt/venv/bin/etat-major")).ok, false);
  const own = { ...e, "/opt": { kind: "dir" as const, uid: 2000 }, "/opt/venv": { kind: "dir" as const, uid: 2000 }, "/opt/venv/bin": { kind: "dir" as const, uid: 2000 }, "/": { kind: "dir" as const, uid: 2000 } };
  assert.equal((await run(own as never, "/opt/venv/bin/etat-major", 2000)).ok, true);
});

test("symlink to a good file passes and reports the target realpath", async () => {
  const e = {
    ...good(),
    "/home/u/bin": { kind: "dir" as const },
    "/home/u/bin/etat-major": { kind: "link" as const, target: "/opt/venv/bin/etat-major" },
  };
  const r = await run(e as never, "/home/u/bin/etat-major");
  assert.deepEqual(r, { ok: true, realpath: "/opt/venv/bin/etat-major", mtimeMs: 42 });
});

test("symlink to a writable file, or into a writable dir, fails", async () => {
  const link = { "/home/u/bin": { kind: "dir" as const }, "/home/u/bin/etat-major": { kind: "link" as const, target: "/opt/venv/bin/etat-major" } };
  const w = good();
  w["/opt/venv/bin/etat-major"] = { kind: "file", mode: 0o666, mtimeMs: 1 };
  assert.equal((await run({ ...w, ...link } as never, "/home/u/bin/etat-major")).ok, false);
  const d = { ...good(), "/opt/venv/bin": { kind: "dir" as const, mode: 0o777 }, ...link };
  assert.equal((await run(d as never, "/home/u/bin/etat-major")).ok, false);
});

test("symlink to a directory or to a missing target fails", async () => {
  const e = { ...good(), "/h": { kind: "dir" as const }, "/h/etat-major": { kind: "link" as const, target: "/opt/venv" } };
  assert.equal((await run(e as never, "/h/etat-major")).ok, false);
  const m = { ...good(), "/h": { kind: "dir" as const }, "/h/etat-major": { kind: "link" as const, target: "/gone" } };
  assert.equal((await run(m as never, "/h/etat-major")).ok, false);
});

test("every ancestor up to / must be daemon- or root-owned and not group/world-writable", async () => {
  const chain = (gp: object, par: object = { kind: "dir" }) => ({
    "/gp": gp,
    "/gp/par": par,
    "/gp/par/etat-major": { kind: "file", mode: 0o755, mtimeMs: 1 },
  });
  const exe = "/gp/par/etat-major";
  assert.equal((await run(chain({ kind: "dir", mode: 0o755 }) as never, exe)).ok, true);
  assert.equal((await run(chain({ kind: "dir", mode: 0o777 }) as never, exe)).ok, false, "grandparent 0777");
  assert.equal((await run(chain({ kind: "dir", mode: 0o775 }) as never, exe)).ok, false, "grandparent 0775");
  assert.equal((await run(chain({ kind: "dir" }, { kind: "dir", mode: 0o777 }) as never, exe)).ok, false, "parent 0777");
  assert.equal((await run(chain({ kind: "dir", uid: 2000 }) as never, exe)).ok, false, "foreign-owned ancestor");
  assert.equal((await run(chain({ kind: "dir", uid: 0 }) as never, exe)).ok, true, "root-owned ancestor");
  assert.equal((await run({ ...chain({ kind: "dir" }), "/": { kind: "dir", mode: 0o777 } } as never, exe)).ok, false, "root dir writable");
  const sticky = (uid: number) => ({ ...chain({ kind: "dir" }), "/gp": { kind: "dir", mode: 0o1777, uid } });
  assert.equal((await run(sticky(0) as never, exe)).ok, true, "sticky root-owned like /tmp");
  assert.equal((await run(sticky(1000) as never, exe)).ok, false, "sticky but not root-owned");
});

test("a symlink sitting in a writable dir is rejected even when the target is fine", async () => {
  const e = {
    ...good(),
    "/shared": { kind: "dir" as const, mode: 0o777 },
    "/shared/etat-major": { kind: "link" as const, target: "/opt/venv/bin/etat-major" },
  };
  assert.equal((await run(e as never, "/shared/etat-major")).ok, false);
  const g = { ...good(), "/gp": { kind: "dir" as const, mode: 0o777 }, "/gp/par": { kind: "dir" as const }, "/gp/par/etat-major": { kind: "link" as const, target: "/opt/venv/bin/etat-major" } };
  assert.equal((await run(g as never, "/gp/par/etat-major")).ok, false, "configured path ancestors, not only its parent");
});

test("isInside: workspace containment at any depth, not prefix lookalikes", () => {
  assert.equal(isInside("/w/a/b/etat-major", "/w"), true);
  assert.equal(isInside("/w/etat-major", "/w"), true);
  assert.equal(isInside("/w", "/w"), true);
  assert.equal(isInside("/wx/etat-major", "/w"), false);
  assert.equal(isInside("/opt/etat-major", "/w"), false);
  assert.equal(isInside("/anything", "/"), true);
});

test("dropping the dotdot rejection would be caught: the fake resolves lexically-equal paths", async () => {
  // /opt/venv/../venv/bin/etat-major is a real file once resolved, so only the explicit check rejects it.
  const e = { ...good(), "/opt/venv/../venv/bin/etat-major": { kind: "file" as const, mode: 0o755 } };
  assert.equal((await run(e as never, "/opt/venv/../venv/bin/etat-major")).ok, false);
});

test("real filesystem: good file, writable file, symlinks", async () => {
  const root = realpathSync(mkdtempSync(join(trustedTmpBase(), "pem-exe-")));
  try {
    const uid = process.getuid!();
    const bin = join(root, "bin");
    mkdirSync(bin);
    chmodSync(bin, 0o755);
    const exe = join(bin, "etat-major");
    writeFileSync(exe, "#!/bin/sh\n");
    chmodSync(exe, 0o755);
    const deps = { fs: realFs, uid };
    assert.equal((await validateExecutable(exe, deps)).ok, true);

    const link = join(root, "etat-major");
    symlinkSync(exe, link);
    const viaLink = await validateExecutable(link, deps);
    assert.equal(viaLink.ok && viaLink.realpath, exe);

    chmodSync(exe, 0o777);
    assert.equal((await validateExecutable(exe, deps)).ok, false);
    assert.equal((await validateExecutable(link, deps)).ok, false);
    chmodSync(exe, 0o755);

    assert.equal((await validateExecutable(bin, deps)).ok, false);
    chmodSync(bin, 0o777);
    assert.equal((await validateExecutable(exe, deps)).ok, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
