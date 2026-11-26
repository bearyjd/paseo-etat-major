import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Node cannot load .tsx or react-native, so real client source is transpiled and run in a vm with
// stubbed modules, then expanded into a tree of host elements. This checks what is put on screen
// and what the handlers do, not how a client draws it.
export type Props = Record<string, unknown> & { children?: unknown };
export type Node = { type: unknown; props: Props };

const jsx = (type: unknown, props: Props) => ({ type, props });

export function load(file: string, modules: Record<string, unknown> = {}, globals: Record<string, unknown> = {}): Record<string, unknown> {
  const src = readFileSync(new URL(`../client/${file}`, import.meta.url), "utf8");
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} as Record<string, unknown> };
  const stubs: Record<string, unknown> = {
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native": { Text: "Text", View: "View", Pressable: "Pressable" },
    ...modules,
  };
  vm.runInNewContext(js, { ...globals, module: mod, exports: mod.exports, require: (id: string) => {
    if (!(id in stubs)) throw new Error(`unexpected import: ${id}`);
    return stubs[id];
  } });
  return mod.exports;
}

export function hosts(node: unknown): Node[] {
  if (Array.isArray(node)) return node.flatMap(hosts);
  if (!node || typeof node !== "object") return [];
  const n = node as Node;
  if (typeof n.type === "function") return hosts((n.type as (p: Props) => unknown)(n.props));
  return [n, ...hosts(n.props.children)];
}
export const textOf = (n: Node): string => [n.props.children].flat(Infinity).filter((c) => typeof c === "string").join("");
export const texts = (tree: Node[]) => tree.filter((n) => n.type === "Text").map(textOf);

export function press(tree: Node[], label: string): void {
  const hit = tree.find((n) => n.type === "Pressable" && texts(hosts(n.props.children)).includes(label));
  if (!hit) throw new Error(`no pressable labelled ${label}`);
  (hit.props.onPress as () => void)();
}

// Just enough of React's hooks for one stateful component: slots are matched by call order, and
// effects run after a render when their dependencies changed. Stateful children must be stubbed.
export function hookRuntime() {
  const slots: unknown[] = [];
  const cleanups: Array<(() => void) | void> = [];
  let pending: Array<() => void> = [];
  let at = 0;
  const slot = <T>(init: () => T): [number, T] => {
    const i = at++;
    if (!(i in slots)) slots[i] = init();
    return [i, slots[i] as T];
  };
  const react = {
    useState(init: unknown) {
      const [i, value] = slot(() => (typeof init === "function" ? (init as () => unknown)() : init));
      return [value, (next: unknown) => void (slots[i] = typeof next === "function" ? (next as (v: unknown) => unknown)(slots[i]) : next)];
    },
    useRef: (init: unknown) => slot(() => ({ current: init }))[1],
    useCallback: (fn: unknown) => slot(() => fn)[1],
    useEffect(effect: () => (() => void) | void, deps: readonly unknown[]) {
      const [i, seen] = slot(() => ({ deps: null as readonly unknown[] | null }));
      if (seen.deps && deps.every((d, k) => Object.is(d, seen.deps![k]))) return;
      seen.deps = deps;
      pending.push(() => {
        cleanups[i]?.();
        cleanups[i] = effect();
      });
    },
  };
  function render(component: unknown, props: Props): Node[] {
    at = 0;
    const tree = hosts({ type: component, props });
    const due = pending;
    pending = [];
    due.forEach((run) => run());
    return tree;
  }
  // Renders, lets effects and resolved promises finish, and renders again.
  async function settle(component: unknown, props: Props): Promise<Node[]> {
    render(component, props);
    await new Promise((r) => setImmediate(r));
    return render(component, props);
  }
  return { react, render, settle };
}
