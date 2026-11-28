import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DiscoverPayload } from "../shared/discover-schema.ts";
import { buildDiscoverVm } from "../client/discover-view-model.ts";
import { makeStyles } from "../client/styles.ts";
import { sentinelTheme } from "./sentinel-theme.ts";
import { hosts, load, textOf, texts, type Node } from "./ui-harness.ts";

// DiscoverBoard is stateless, so the real source can be expanded into a tree without React.
const controls = load("controls.tsx", {});
const { DiscoverBoard } = load("DiscoverBoard.tsx", { "./controls.tsx": controls }) as { DiscoverBoard: (p: unknown) => Node };

const styles = makeStyles(sentinelTheme, { compact: true });
const data = DiscoverPayload.parse(JSON.parse(readFileSync(new URL("../fixtures/exports/harbor-discover.json", import.meta.url), "utf8")));
const model = buildDiscoverVm({ data, exportedAt: "2026-11-25T10:00:00.000Z", version: "0.1.0" });
const render = (section: "decisions" | "research", selected: string | null, extra: Record<string, unknown> = {}) =>
  hosts({ type: DiscoverBoard, props: { styles, vm: model, section, selected, onSection: () => {}, onSelect: () => {}, ...extra } });

test("decision list: every row shows its status, rejected ones with a danger card and the word", () => {
  const tree = render("decisions", null);
  const all = texts(tree);
  for (const s of ["Status: Approved", "Status: Rejected", "Status: Proposed (not decided)", "Status: Postponed"]) assert.ok(all.includes(s), s);
  const rows = tree.filter((n) => n.type === "Pressable" && n.props.accessibilityRole === "button");
  assert.equal(rows.length, 4);
  const rejected = rows[1]!;
  assert.equal((rejected.props.style as { borderColor: string }).borderColor, sentinelTheme.colors.statusDanger);
  assert.match(String(rejected.props.accessibilityLabel), /Status: Rejected/);
  const label = hosts(rejected.props.children).find((n) => textOf(n) === "Status: Rejected")!;
  assert.equal((label.props.style as { color: string }).color, sentinelTheme.colors.statusDanger);
  assert.equal((rows[0]!.props.style as { borderColor: string }).borderColor, sentinelTheme.colors.border);
});

test("decision list: every row draws its evidence line as text, in warning style when it needs checking", () => {
  const rows = render("decisions", null).filter((n) => n.type === "Pressable" && n.props.accessibilityRole === "button");
  const drawn = rows.map((row, i) => {
    const line = hosts(row.props.children).find((n) => n.type === "Text" && textOf(n) === model.decisions[i]!.evidenceText);
    assert.ok(line, model.decisions[i]!.evidenceText);
    return (line.props.style as { color: string }).color;
  });
  const { statusWarning, foregroundMuted } = sentinelTheme.colors;
  assert.deepEqual(drawn, [foregroundMuted, statusWarning, statusWarning, statusWarning]);
});

test("research list: every row shows review status and provenance", () => {
  const all = texts(render("research", null));
  assert.equal(all.filter((s) => s.startsWith("Status: ")).length, 3);
  assert.equal(all.filter((s) => s.startsWith("Provenance: ")).length, 3);
  assert.ok(all.includes("2 findings, 1 unsourced"));
});

test("decision detail: status, reasons and citation provenance are visible", () => {
  const all = texts(render("decisions", model.decisions[1]!.key));
  for (const s of ["Status: Rejected", "One text message per silent sensor", "research:0002#f2", "Evidence: unsourced. Status: Unreviewed. Provenance: AI-generated."]) {
    assert.ok(all.includes(s), s);
  }
});

test("research detail: status and provenance stay visible and source URLs are plain, unpressable text", () => {
  const tree = render("research", model.research[1]!.key);
  const all = texts(tree);
  for (const s of ["Status: Unreviewed", "Provenance: AI-generated", "unsourced", "https://example.org/harbor/notes/2", "Source date 2026-10-09"]) {
    assert.ok(all.includes(s), s);
  }
  for (const n of tree.filter((x) => x.type === "Text")) {
    assert.deepEqual(Object.keys(n.props).filter((k) => /^on|href|url|link|role/i.test(k)), [], textOf(n));
  }
  const pressables = tree.filter((n) => n.type === "Pressable");
  assert.ok(pressables.every((p) => !hosts(p.props.children).some((n) => textOf(n).includes("example.org"))));
});

test("tabs, rows and the back button call back with the section or row key", () => {
  const picked: unknown[] = [];
  const press = (n: Node) => (n.props.onPress as () => void)();
  const list = render("decisions", null, { onSelect: (k: unknown) => picked.push(k), onSection: (s: unknown) => picked.push(s) });
  const pressables = list.filter((n) => n.type === "Pressable");
  press(pressables.filter((n) => n.props.accessibilityRole === "tab")[1]!);
  press(pressables.filter((n) => n.props.accessibilityRole === "button")[1]!);
  const detail = render("decisions", model.decisions[1]!.key, { onSelect: (k: unknown) => picked.push(k) });
  press(detail.find((n) => n.type === "Pressable")!);
  assert.deepEqual(picked, ["research", model.decisions[1]!.key, null]);
});

test("empty sections say so, and a stale selection falls back to the list", () => {
  const empty = { ...model, decisions: [], research: [] };
  assert.ok(texts(render("decisions", null, { vm: empty })).includes("No decisions recorded."));
  assert.ok(texts(render("research", null, { vm: empty })).includes("No research recorded."));
  assert.ok(texts(render("decisions", "gone")).includes("Status: Approved"));
});
