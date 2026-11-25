import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ERROR_CODES } from "../shared/errors.ts";
import { PlanningPayload, TASK_STATES } from "../shared/planning-schema.ts";
import { CAPS } from "../shared/sanitize.ts";
import { LOAD_ERROR_VIEW, STALE_AFTER_MS, buildPlanningVm, errorView, footerSummary } from "../client/view-model.ts";

const obj = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/exports/${name}`, import.meta.url), "utf8"));
const parse = (name: string) => PlanningPayload.parse(obj(name));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

const T0 = Date.parse("2026-11-25T12:00:00Z");
const exportedAt = "2026-11-25T12:00:00Z";
const vm = (data = parse("harbor-prs.json"), now = T0, at = exportedAt) =>
  buildPlanningVm({ data, exportedAt: at, version: "etat-major 0.1.0" }, () => now);

test("lanes follow the six derived states in order, with a count each", () => {
  const v = vm();
  assert.deepEqual(v.lanes.map((l) => l.state), [...TASK_STATES]);
  assert.equal(v.lanes.reduce((n, l) => n + l.count, 0), 7);
  for (const l of v.lanes) assert.equal(l.count, l.tasks.length);
  assert.deepEqual(v.lanes.map((l) => l.label), ["Draft", "Ready", "In progress", "Review", "Done", "Blocked"]);
});

test("grouping puts each task in the lane of its state", () => {
  const data = parse("harbor.json");
  const v = vm(data);
  for (const lane of v.lanes) {
    const expected = data.tasks.filter((t) => t.state === lane.state).map((t) => t.id);
    assert.deepEqual(lane.tasks.map((t) => t.id), expected);
  }
});

test("a state of unknown gets an Unrecognised lane, last, only when present", () => {
  assert.equal(vm().lanes.some((l) => l.state === "unknown"), false);
  const data = clone(parse("harbor.json"));
  data.tasks[0]!.state = "unknown";
  const v = vm(data);
  const last = v.lanes[v.lanes.length - 1]!;
  assert.equal(last.state, "unknown");
  assert.equal(last.label, "Unrecognised");
  assert.equal(last.count, 1);
  assert.equal(last.tasks[0]!.id, data.tasks[0]!.id);
});

test("empty lanes carry a positive line, non-empty lanes do not need one", () => {
  const data = clone(parse("harbor.json"));
  data.tasks = data.tasks.filter((t) => t.state !== "blocked");
  const v = vm(data);
  const blocked = v.lanes.find((l) => l.state === "blocked")!;
  assert.equal(blocked.count, 0);
  assert.equal(blocked.emptyLine, "No blocked tasks.");
  assert.equal(v.lanes.find((l) => l.state === "in-progress")!.emptyLine, "No in-progress tasks.");
  assert.equal(v.lanes.find((l) => l.state === "draft")!.emptyLine, "No draft tasks.");
});

test("each task has the seven evidence fields in order; unverified is flagged, refs kept", () => {
  const v = vm(parse("harbor.json"));
  const done = v.lanes.find((l) => l.state === "done")!.tasks[0]!;
  assert.deepEqual(
    done.evidence.map((e) => e.key),
    ["generated", "committed", "tested", "reviewed", "merged", "shipped", "accepted"],
  );
  const accepted = done.evidence.find((e) => e.key === "accepted")!;
  assert.equal(accepted.unverified, false);
  assert.deepEqual(accepted.refs, ["task:harbor/0001"]);
  const committed = done.evidence.find((e) => e.key === "committed")!;
  assert.equal(committed.unverified, true);
  assert.deepEqual(committed.refs, []);
  assert.equal(done.unverifiedCount, 6);
});

test("an empty ref array counts as unverified, never as proof", () => {
  const data = clone(parse("harbor.json"));
  data.tasks[0]!.evidence.tested = [];
  const t = vm(data).lanes.flatMap((l) => l.tasks).find((x) => x.id === data.tasks[0]!.id)!;
  assert.equal(t.evidence.find((e) => e.key === "tested")!.unverified, true);
});

test("no percentage or progress figure is produced", () => {
  const text = JSON.stringify(vm());
  assert.equal(/percent|progress%|\d+\s?%/i.test(text), false);
});

test("no issues gives no banner; issues come blocking first with severity and message", () => {
  assert.equal(vm(parse("harbor.json")).issues, null);
  const data = clone(parse("harbor.json"));
  data.issues = [
    { path: "a.md", field: null, message: "soft", severity: "warning", blocking: false },
    { path: "b.md", field: "title", message: "hard", severity: "error", blocking: true },
  ];
  const issues = vm(data).issues!;
  assert.equal(issues.heading, "2 issues in the workspace");
  assert.deepEqual(issues.rows.map((r) => r.message), ["hard", "soft"]);
  assert.equal(issues.rows[0]!.severity, "error");
  assert.equal(issues.rows[0]!.blocking, true);
  assert.equal(issues.rows[0]!.path, "b.md");
  assert.equal(issues.rows[0]!.field, "title");
  data.issues = data.issues.slice(0, 1);
  assert.equal(vm(data).issues!.heading, "1 issue in the workspace");
});

test("hostile fixture: banner present and every string sanitized and capped", () => {
  const v = vm(parse("hostile.handcrafted.json"));
  assert.ok(v.issues);
  const strings: string[] = [];
  const walk = (x: unknown): void => {
    if (typeof x === "string") strings.push(x);
    else if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === "object") Object.values(x).forEach(walk);
  };
  walk(v);
  assert.ok(strings.length > 0);
  for (const s of strings) {
    assert.equal(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/.test(s), false);
  }
  for (const t of v.lanes.flatMap((l) => l.tasks)) assert.ok([...t.title].length <= CAPS.title);
});

test("a 10k-character title is truncated to the title cap", () => {
  const data = clone(parse("harbor.json"));
  data.tasks[0]!.title = "x".repeat(10_000);
  data.features[0]!.title = "y".repeat(10_000);
  const v = vm(data);
  assert.ok([...v.lanes.flatMap((l) => l.tasks)[0]!.title].length <= CAPS.title);
  assert.ok([...v.features[0]!.title].length <= CAPS.title);
});

test("header carries project, export time text and version, sanitized", () => {
  const data = clone(parse("harbor.json"));
  data.project = "ha‮rtbor";
  const v = buildPlanningVm({ data, exportedAt, version: "etat-major 0.1.0\u0007" }, () => T0);
  assert.equal(v.project, "hartbor");
  assert.equal(v.version, "etat-major 0.1.0");
  assert.equal(v.exportedAtText, "just now");
});

test("staleness is computed from the injected clock", () => {
  assert.equal(vm(undefined, T0 + STALE_AFTER_MS - 1).stale, null);
  const s = vm(undefined, T0 + STALE_AFTER_MS + 1).stale!;
  assert.match(s.sentence, /^Possibly stale: exported /);
  assert.match(s.hint, /Try again/);
  const old = vm(undefined, T0 + 3 * 3600_000 + 5);
  assert.equal(old.exportedAtText, "3 h ago");
  assert.match(old.stale!.sentence, /3 h ago/);
  assert.equal(vm(undefined, T0 + 2 * 86400_000).exportedAtText, "2 d ago");
  assert.equal(vm(undefined, T0 + 5 * 60_000).exportedAtText, "5 min ago");
});

test("a future export time (clock skew) is not stale; garbage time is flagged unknown", () => {
  const future = vm(undefined, T0 - 3600_000);
  assert.equal(future.stale, null);
  assert.equal(future.exportedAtText, "just now");
  const bad = vm(undefined, T0, "not a date");
  assert.equal(bad.exportedAtText, "unknown");
  assert.match(bad.stale!.sentence, /unknown/i);
});

test("features carry architecture refs with relation, ref, state, provenance", () => {
  const f = vm(parse("harbor.json")).features[0]!;
  assert.equal(f.id, "harbor/0001");
  assert.equal(f.title, "Flag silent sensors");
  assert.equal(f.status, "planned");
  assert.match(f.outcome ?? "", /silent/);
  assert.deepEqual(Object.keys(f.architecture[0]!).sort(), ["provenance", "ref", "relation", "state"]);
});

test("sources are listed as label and status", () => {
  const s = vm(parse("harbor.json")).sources;
  assert.equal(s.length, 6);
  assert.deepEqual(s[0], { label: "Component declarations", status: "missing" });
});

test("footer summary is hidden until data exists, then counts for sight and speech", () => {
  assert.equal(footerSummary(null), null);
  const f = footerSummary(vm(parse("harbor.json")))!;
  assert.match(f.label, /^État-major: 7 tasks/);
  assert.match(f.label, /2 blocked/);
  assert.match(f.label, /0 issues|no issues/);
  assert.ok(f.short.length > 0 && f.short.length < f.label.length);
  const data = clone(parse("hostile.handcrafted.json"));
  assert.match(footerSummary(vm(data))!.label, /1 issue\b/);
});

test("every error code has one fixed sentence and one hint, all distinct", () => {
  const sentences = new Set<string>();
  for (const code of ERROR_CODES) {
    const e = errorView(code);
    assert.ok(e.sentence.length > 10 && e.hint.length > 10, code);
    assert.equal(/[A-Za-z]:\\|\/home\/|\/usr\//.test(e.sentence + e.hint), false);
    sentences.add(e.sentence);
  }
  assert.equal(sentences.size, ERROR_CODES.length);
  assert.match(errorView("NOT_CONFIGURED").hint, /Settings/);
  assert.match(errorView("EXE_INVALID").hint, /absolute path/);
});

test("a failed call to the host has its own fixed state, distinct from every export error", () => {
  const e = LOAD_ERROR_VIEW;
  assert.ok(e.sentence.length > 10 && e.hint.length > 10);
  for (const code of ERROR_CODES) assert.notEqual(errorView(code).sentence, e.sentence);
});
