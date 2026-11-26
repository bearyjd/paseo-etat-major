import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as ids from "../shared/ids.ts";
import * as styles from "../client/styles.ts";
import { sentinelTheme } from "./sentinel-theme.ts";

// Minimal fakes: only the methods the entry files are expected to call.
// An unexpected call throws, which keeps the "registers only X" claim honest.
function fakeServer() {
  const handled: string[] = [];
  const registered: string[] = [];
  const target = {
    handle(rpc: { name: string }) {
      handled.push(rpc.name);
      return () => {};
    },
    registerSettings() {
      registered.push("settings");
      return { read: async () => ({ status: "invalid", revision: "0", error: "x" }), subscribe: () => () => {} };
    },
  };
  const ctx = new Proxy(target, {
    get(t, k) {
      if (k in t) return (t as never)[k];
      throw new Error(`unexpected server context use: ${String(k)}`);
    },
  });
  return { ctx, handled, registered };
}

type RowElement = { props: { onPress: () => void; trailing?: { props: { style: { color: string } } } } };

function fakeClient() {
  const added: string[] = [];
  const removed: string[] = [];
  const components: Record<string, (p: unknown) => RowElement> = {};
  const reg = (kind: string) => (c: { id: string; Component: never }) => {
    added.push(`${kind}:${c.id}`);
    components[kind] = c.Component;
    return () => void removed.push(`${kind}:${c.id}`);
  };
  const target = { addScreen: reg("screen"), addSidebarFooterItem: reg("footer") };
  const ctx = new Proxy(target, {
    get(t, k) {
      if (k in t) return (t as never)[k];
      throw new Error(`unexpected client context use: ${String(k)}`);
    },
  });
  return { ctx, added, removed, components };
}

test("server entry default-exports contribute() returning cleanup, registers only settings and the five RPC handlers", async () => {
  const mod = await import("../index.server.ts");
  assert.equal(typeof mod.default, "function");
  const { ctx, handled, registered } = fakeServer();
  const cleanup = mod.default(ctx as never);
  assert.equal(typeof cleanup, "function");
  assert.deepEqual(registered, ["settings"]);
  assert.deepEqual(handled.sort(), [
    "etat-major.discover.get",
    "etat-major.discover.refresh",
    "etat-major.planning.get",
    "etat-major.planning.refresh",
    "etat-major.status.get",
  ]);
  cleanup();
});

// Node cannot load .tsx or react-native, so the real client source is transpiled with
// TypeScript and run in a vm with stubbed UI modules. contribute() is exercised for real.
function loadClientEntry(summary: { short: string; label: string } | null = null): { default: (c: never) => () => void } {
  const src = readFileSync(new URL("../index.client.tsx", import.meta.url), "utf8");
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const stubs: Record<string, unknown> = {
    "react/jsx-runtime": { jsx: (type: unknown, props: unknown) => ({ type, props }), jsxs: () => null, Fragment: null },
    "@getpaseo/plugin/client/ui": { SidebarRow: () => null },
    "./client/PlanningScreen.tsx": { PlanningScreen: () => null },
    "./client/summary-store.ts": { getSummary: () => summary, subscribeSummary: () => () => {} },
    "./client/styles.ts": styles,
    react: { useSyncExternalStore: (_s: unknown, get: () => unknown) => get() },
    "./shared/ids.ts": ids,
    "react-native": { Text: () => null, View: () => null },
  };
  const mod = { exports: {} as Record<string, unknown> };
  const req = (id: string) => {
    if (!(id in stubs)) throw new Error(`unexpected client import: ${id}`);
    return stubs[id];
  };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: req });
  return mod.exports as never;
}

const hostProps = { theme: sentinelTheme, layout: { compact: false, platform: "web" } };

test("client entry default-exports contribute() returning cleanup, registers screen and footer row", () => {
  const mod = loadClientEntry();
  assert.equal(typeof mod.default, "function");
  const { ctx, added, removed, components } = fakeClient();
  const cleanup = mod.default(ctx as never);
  assert.equal(typeof cleanup, "function");
  assert.deepEqual([...added].sort(), ["footer:planning-entry", "screen:planning"]);
  cleanup();
  assert.deepEqual([...removed].sort(), [...added].sort());
  // The row must open the screen that was registered, via one shared constant.
  const opened: unknown[] = [];
  const element = components.footer!({ ...hostProps, openScreen: (a: unknown) => opened.push(a), currentScreen: null });
  element.props.onPress();
  assert.equal(JSON.stringify(opened), JSON.stringify([{ screenId: ids.PLANNING_SCREEN_ID }]));
  assert.ok(added.includes(`screen:${ids.PLANNING_SCREEN_ID}`));
});

test("the sidebar row's trailing summary text takes its color from the host theme", () => {
  const { ctx, components } = fakeClient();
  loadClientEntry({ short: "7 tasks", label: "x" }).default(ctx as never);
  const element = components.footer!({ ...hostProps, openScreen: () => {}, currentScreen: null });
  assert.equal(element.props.trailing?.props.style.color, sentinelTheme.colors.foregroundMuted);
});
