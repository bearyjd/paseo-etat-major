import assert from "node:assert/strict";
import { SettingsSchema } from "../server/settings.ts";

type Handler = (input: unknown, ctx: unknown) => Promise<Record<string, unknown>>;

// Only handle() and registerSettings() exist; any other use (hooks, providers, ...) throws.
export function fakeServer(initial: unknown) {
  const handlers = new Map<string, Handler>();
  const state = { values: initial };
  let definition: { id: string; scope: string; version: number } | undefined;
  const target = {
    handle(contract: { name: string }, h: Handler) {
      handlers.set(contract.name, h);
    },
    registerSettings(def: { id: string; scope: string; version: number; schema: typeof SettingsSchema }) {
      definition = def;
      return {
        read: async () => {
          const r = def.schema.safeParse(state.values);
          return r.success
            ? { status: "ready", revision: "1", values: r.data }
            : { status: "invalid", revision: "1", error: "invalid settings" };
        },
        subscribe: () => () => {},
      };
    },
  };
  const ctx = new Proxy(target, {
    get(t, k) {
      if (k in t) return (t as never)[k];
      throw new Error(`unexpected server context use: ${String(k)}`);
    },
  });
  const call = (name: string, input: unknown = {}) => {
    const h = handlers.get(name);
    assert.ok(h, `no handler ${name}`);
    return h(input, {});
  };
  return { ctx, handlers, state, call, definition: () => definition };
}
