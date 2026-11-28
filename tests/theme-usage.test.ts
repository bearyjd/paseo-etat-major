import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const root = new URL("..", import.meta.url).pathname;
const files = [
  join(root, "index.client.tsx"),
  ...readdirSync(join(root, "client")).filter((f) => /\.tsx?$/.test(f)).map((f) => join(root, "client", f)),
].map((p) => ({ rel: relative(root, p), text: readFileSync(p, "utf8") }));

const NAMED = "transparent|black|white|red|green|blue|yellow|orange|purple|pink|brown|gr[ae]y|silver|cyan|magenta|teal|navy|maroon|olive|lime|aqua|fuchsia|gold|indigo|violet|(?:light|dark)(?:gr[ae]y|red|green|blue)";
// [name, pattern, sample that must match]
const COLOR_LITERALS: ReadonlyArray<readonly [string, RegExp, string]> = [
  ["hex", /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/, 'color: "#000"'],
  ["rgb/hsl function", /\b(?:rgba?|hsla?|hwb|oklab|oklch)\s*\(/, "rgba(0,0,0,0.5)"],
  ["named color string", new RegExp(`(["'\`])(?:${NAMED})\\1`, "i"), 'borderColor: x ? "Black" : y'],
  ["literal assigned to a color key", /[cC]olor["']?\s*[:=]\s*\{?\s*["'`]/, 'placeholderTextColor={"tomato"}'],
];

const THEMED = new Set(["Text", "TextInput", "Pressable", "View", "ScrollView"]);

function styleProblems(name: string, source: string): string[] {
  const file = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const problems: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(file);
      if (THEMED.has(tag)) {
        const attrs = new Map(
          node.attributes.properties.filter(ts.isJsxAttribute).map((a) => [a.name.getText(file), a.initializer?.getText(file) ?? ""]),
        );
        const at = `${name}:${file.getLineAndCharacterOfPosition(node.getStart()).line + 1} <${tag}>`;
        const need = tag === "Text" || tag === "TextInput" ? /styles\.text\./ : /styles\./;
        if (!need.test(attrs.get("style") ?? "")) problems.push(`${at} style is not from ${need.source}`);
        if (tag === "TextInput" && !attrs.has("placeholderTextColor")) problems.push(`${at} has no placeholderTextColor`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return problems;
}

test("the theme scan covers the screen, settings page, styles and client entry", () => {
  const rels = files.map((f) => f.rel);
  for (const f of ["index.client.tsx", "client/PlanningScreen.tsx", "client/SettingsPage.tsx", "client/DiscoverView.tsx", "client/DiscoverBoard.tsx", "client/controls.tsx", "client/styles.ts"]) {
    assert.ok(rels.includes(f), f);
  }
});

for (const [name, re] of COLOR_LITERALS) {
  test(`no client source has a color literal: ${name}`, () => {
    assert.deepEqual(files.filter((f) => re.test(f.text)).map((f) => f.rel), []);
  });
}

test("every color literal pattern matches its own sample", () => {
  for (const [name, re, sample] of COLOR_LITERALS) assert.ok(re.test(sample), `pattern for ${name} missed its sample`);
});

test("every text, input, pressable and container element takes its style from the themed styles", () => {
  const problems = files.filter((f) => f.rel.endsWith(".tsx")).flatMap((f) => styleProblems(f.rel, f.text));
  assert.deepEqual(problems, []);
});

test("the element checker rejects missing, unthemed and arrow-hidden styles", () => {
  assert.equal(styleProblems("a.tsx", "const a = <Text>x</Text>;").length, 1);
  assert.equal(styleProblems("b.tsx", "const b = <View style={{ gap: 4 }} />;").length, 1);
  assert.equal(styleProblems("c.tsx", "const c = <Text style={styles.card}>x</Text>;").length, 1);
  assert.equal(styleProblems("d.tsx", "const d = <Pressable onPress={() => 1 > 0} />;").length, 1);
  assert.equal(styleProblems("e.tsx", "const e = <TextInput style={styles.text.body} />;").length, 1);
  assert.deepEqual(styleProblems("f.tsx", "const f = <Text style={on ? styles.text.body : styles.text.muted}>x</Text>;"), []);
});
