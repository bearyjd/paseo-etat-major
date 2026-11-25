import { test } from "node:test";
import assert from "node:assert/strict";

// Minimal fakes: only the methods the entry files are expected to call.
// An unexpected call throws, which keeps the "registers only X" claim honest.
function fakeServer() {
  const handled: string[] = [];
  const target = {
    handle(rpc: { name: string }) {
      handled.push(rpc.name);
      return () => {};
    },
  };
  const ctx = new Proxy(target, {
    get(t, k) {
      if (k in t) return (t as never)[k];
      throw new Error(`unexpected server context use: ${String(k)}`);
    },
  });
  return { ctx, handled };
}

function fakeClient() {
  const added: string[] = [];
  const removed: string[] = [];
  const reg = (kind: string) => (c: { id: string }) => {
    added.push(`${kind}:${c.id}`);
    return () => void removed.push(`${kind}:${c.id}`);
  };
  const target = { addScreen: reg("screen"), addSidebarFooterItem: reg("footer") };
  const ctx = new Proxy(target, {
    get(t, k) {
      if (k in t) return (t as never)[k];
      throw new Error(`unexpected client context use: ${String(k)}`);
    },
  });
  return { ctx, added, removed };
}

test("server entry default-exports contribute() returning cleanup, registers only status.get", async () => {
  const mod = await import("../index.server.ts");
  assert.equal(typeof mod.default, "function");
  const { ctx, handled } = fakeServer();
  const cleanup = mod.default(ctx as never);
  assert.equal(typeof cleanup, "function");
  assert.equal(handled.length, 1);
  assert.match(handled[0]!, /status\.get$/);
  cleanup();
});

test("client entry default-exports contribute() returning cleanup, registers screen and footer row", async () => {
  const mod = await import("../index.client.tsx");
  assert.equal(typeof mod.default, "function");
  const { ctx, added, removed } = fakeClient();
  const cleanup = mod.default(ctx as never);
  assert.equal(typeof cleanup, "function");
  assert.deepEqual([...added].sort(), ["footer:planning-entry", "screen:planning"]);
  cleanup();
  assert.deepEqual([...removed].sort(), [...added].sort());
});
