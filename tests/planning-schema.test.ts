import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PlanningPayload, TASK_STATES, parsePlanningJson } from "../shared/planning-schema.ts";
import { CAPS, sanitizeText } from "../shared/sanitize.ts";

const load = (name: string): string => readFileSync(new URL(`../fixtures/exports/${name}`, import.meta.url), "utf8");
const obj = (name: string) => JSON.parse(load(name));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

test("recorded exports parse", () => {
  for (const f of ["harbor.json", "harbor-prs.json"]) {
    const r = parsePlanningJson(load(f));
    assert.equal(r.ok, true, f);
    if (r.ok) {
      assert.equal(r.data.project, "harbor");
      assert.equal(r.data.schema, "etat-major/planning@1");
      assert.equal(r.data.tasks.length, 7);
    }
  }
});

test("recorded export with PR evidence carries all six derived states", () => {
  const r = PlanningPayload.parse(obj("harbor-prs.json"));
  assert.deepEqual([...new Set(r.tasks.map((t) => t.state))].sort(), [...TASK_STATES].sort());
});

test("seven evidence fields, unverified or string arrays", () => {
  const r = PlanningPayload.parse(obj("harbor-prs.json"));
  const done = r.tasks.find((t) => t.state === "done")!;
  assert.deepEqual(Object.keys(done.evidence).sort(), ["accepted", "committed", "generated", "merged", "reviewed", "shipped", "tested"]);
  assert.deepEqual(done.evidence.accepted, ["task:harbor/0001"]);
  assert.equal(done.evidence.tested, "unverified");
});

test("evidence rung rejects other strings and non-string arrays", () => {
  for (const bad of ["verified", 1, null, [1], [null]]) {
    const p = clone(obj("harbor.json"));
    p.tasks[0].evidence.tested = bad;
    assert.equal(PlanningPayload.safeParse(p).success, false, JSON.stringify(bad));
  }
  const p = clone(obj("harbor.json"));
  delete p.tasks[0].evidence.shipped;
  assert.equal(PlanningPayload.safeParse(p).success, false);
});

test("optional keys meute, manual_review, execution_links are absent in recordings and accepted when present", () => {
  const base = obj("harbor.json");
  for (const k of ["meute", "manual_review", "execution_links"]) assert.equal(k in base, false);
  assert.equal(PlanningPayload.safeParse(base).success, true);
  const p = clone(base);
  p.meute = { version: 1, project: "harbor", exported_at: "2026-11-01T00:00:00Z", reports: [{ ref: "r1", recorded_at: "2026-11-01T00:00:00Z", outcome: "ok", task: null, linked: false }] };
  p.manual_review = { version: 1, source: "manual-anthropic-api-review", task: "harbor/0001", ref: "r", recorded_at: "2026-11-01", outcome: "ok", commit: "abc", report_sha256: "00" };
  p.execution_links = { version: 1, project: "harbor", links: [{ task: "harbor/0001", kind: "meute-job", ref: "j1", seen_at: "2026-11-01", url: null }] };
  const r = PlanningPayload.parse(p);
  assert.equal(r.meute?.reports.length, 1);
  assert.equal(r.execution_links?.links[0].kind, "meute-job");
  assert.equal(r.manual_review?.task, "harbor/0001");
});

test("unknown keys are stripped at every level", () => {
  const p = clone(obj("harbor.json"));
  p.extra = 1;
  p.tasks[0].extra = 1;
  p.tasks[0].evidence.extra = 1;
  p.features[0].extra = 1;
  p.sources[0].extra = 1;
  const r = PlanningPayload.parse(p);
  assert.equal("extra" in r, false);
  assert.equal("extra" in r.tasks[0], false);
  assert.equal("extra" in r.tasks[0].evidence, false);
  assert.equal("extra" in r.features[0], false);
  assert.equal("extra" in r.sources[0], false);
});

test("issues pass through with their fields", () => {
  const p = clone(obj("harbor.json"));
  p.issues = [{ path: "decisions", field: null, message: "m", severity: "warning", blocking: false }];
  const r = PlanningPayload.parse(p);
  assert.deepEqual(r.issues, p.issues);
});

test("version 2 is rejected as SCHEMA_MISMATCH", () => {
  const p = clone(obj("harbor.json"));
  p.version = 2;
  assert.deepEqual(parsePlanningJson(JSON.stringify(p)), { ok: false, code: "SCHEMA_MISMATCH" });
});

test("missing or wrong schema marker is rejected as SCHEMA_MISMATCH", () => {
  for (const marker of [undefined, "etat-major/planning@2", "etat-major/trace@1", "", 1, null]) {
    const p = clone(obj("harbor.json"));
    if (marker === undefined) delete p.schema;
    else p.schema = marker;
    assert.deepEqual(parsePlanningJson(JSON.stringify(p)), { ok: false, code: "SCHEMA_MISMATCH" }, String(marker));
  }
});

test("missing version is rejected", () => {
  const p = clone(obj("harbor.json"));
  delete p.version;
  assert.equal(parsePlanningJson(JSON.stringify(p)).ok, false);
});

test("non-JSON is BAD_JSON, JSON non-objects are SCHEMA_MISMATCH", () => {
  assert.deepEqual(parsePlanningJson("not json"), { ok: false, code: "BAD_JSON" });
  assert.deepEqual(parsePlanningJson(""), { ok: false, code: "BAD_JSON" });
  for (const t of ["null", "[]", "1", '"x"']) assert.deepEqual(parsePlanningJson(t), { ok: false, code: "SCHEMA_MISMATCH" }, t);
});

test("each of the six task states is accepted", () => {
  assert.deepEqual([...TASK_STATES], ["draft", "ready", "in-progress", "review", "done", "blocked"]);
  for (const state of TASK_STATES) {
    const p = clone(obj("harbor.json"));
    p.tasks[0].state = state;
    assert.equal(PlanningPayload.safeParse(p).success, true, state);
  }
});

// Decision: an unknown task state is rejected at the schema level (SCHEMA_MISMATCH),
// because the schema marker already gates compatibility; a new state needs an @2 marker.
test("an unknown task state is rejected", () => {
  for (const state of ["running", "In-Progress", "", "planned", null, 3]) {
    const p = clone(obj("harbor.json"));
    p.tasks[0].state = state;
    assert.deepEqual(parsePlanningJson(JSON.stringify(p)), { ok: false, code: "SCHEMA_MISMATCH" }, String(state));
  }
});

test("hostile fixture parses and keeps its payload strings for sanitize to handle", () => {
  const r = parsePlanningJson(load("hostile.handcrafted.json"));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.data.tasks[0].title.length, 10000);
  assert.match(r.data.features[0].title, /<script>/);
  assert.match(r.data.features[0].title, /\u202e/);
});

test("hostile fixture: sanitize neutralises every string without throwing", () => {
  const r = parsePlanningJson(load("hostile.handcrafted.json"));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const BAD = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/;
  const seen: string[] = [];
  const walk = (v: unknown, key: string): void => {
    if (typeof v === "string") {
      const cap = key === "outcome" ? CAPS.prose : key === "title" ? CAPS.title : CAPS.ref;
      const out = sanitizeText(v, cap, { allowNewline: key === "outcome" });
      assert.doesNotMatch(out.replaceAll("\n", ""), BAD, key);
      assert.ok(Array.from(out).length <= cap, key);
      seen.push(out);
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(r.data, "");
  assert.ok(seen.length > 20);
  assert.equal(sanitizeText(r.data.tasks[0].title, CAPS.title).length, 200);
  // Markup is not rewritten here; rendering as plain text is the defence (plan section 4).
  assert.ok(seen.some((s) => s.includes("javascript:alert(1)")));
});
