import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PlanningPayload, TASK_STATES, parsePlanningJson } from "../shared/planning-schema.ts";
import { CAPS, sanitizeText } from "../shared/sanitize.ts";
import { INDEPENDENT_FORBIDDEN, STRIPPED_EXAMPLES } from "./forbidden.ts";

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

// Decision: the schema marker and version stay strict, but an unrecognised task state is
// tolerated and mapped to the literal "unknown" so the screen can show an "Unrecognised" lane
// (plan PR5: unknown state shown as-is, not dropped).
test("an unknown task state parses as \"unknown\"", () => {
  for (const state of ["running", "In-Progress", "", "planned", null, 3, {}, []]) {
    const p = clone(obj("harbor.json"));
    p.tasks[0].state = state;
    const r = parsePlanningJson(JSON.stringify(p));
    assert.equal(r.ok, true, String(state));
    if (r.ok) {
      assert.equal(r.data.tasks[0].state, "unknown", String(state));
      assert.equal(r.data.tasks[0].id, p.tasks[0].id);
    }
  }
});

test("a populated component, architecture row and issue are typed", () => {
  const component = { id: "c1", label: "Sensors", kind: "module", paths: ["src/sensors"], parent: null, provenance: "human", owner: "maintainer", summary: null, summary_provenance: null, reviewed: true };
  const mk = () => {
    const p = clone(obj("harbor.json"));
    p.components = [clone(component)];
    p.issues = [{ path: "x", field: "f", message: "m", severity: "error", blocking: true }];
    return p;
  };
  const ok = PlanningPayload.parse(mk());
  assert.deepEqual(ok.components, [component]);
  assert.equal(ok.features[0].architecture[0].target, null);
  assert.equal(ok.issues[0].blocking, true);
  const mutate = (f: (p: ReturnType<typeof mk>) => void) => {
    const p = mk();
    f(p);
    return PlanningPayload.safeParse(p).success;
  };
  for (const bad of ["yes", 1, null, undefined]) assert.equal(mutate((p) => { p.components[0].reviewed = bad; }), false, `reviewed ${String(bad)}`);
  assert.equal(mutate((p) => { p.components[0].paths = "src"; }), false);
  assert.equal(mutate((p) => { p.components[0].paths = [1]; }), false);
  assert.equal(mutate((p) => { p.components[0].parent = 3; }), false);
  assert.equal(mutate((p) => { p.issues[0].blocking = "true"; }), false);
  assert.equal(mutate((p) => { p.issues[0].field = 1; }), false);
  assert.equal(mutate((p) => { p.features[0].architecture[0].target = 1; }), false);
  assert.equal(mutate((p) => { p.features[0].architecture[0].ref = null; }), false);
});

test("hostile fixture parses and keeps its payload strings for sanitize to handle", () => {
  const r = parsePlanningJson(load("hostile.handcrafted.json"));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.data.tasks[0].title.length, 10000);
  assert.match(r.data.features[0].title, /<script>/);
  assert.match(r.data.features[0].title, /\u202e/);
});


test("hostile fixture: sanitize neutralises every string, judged by an independent oracle", () => {
  const r = parsePlanningJson(load("hostile.handcrafted.json"));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const raw: string[] = [];
  const seen: string[] = [];
  const walk = (v: unknown, key: string): void => {
    if (typeof v === "string") {
      const cap = key === "outcome" ? CAPS.prose : key === "title" ? CAPS.title : CAPS.ref;
      const out = sanitizeText(v, cap, { allowNewline: key === "outcome" });
      assert.doesNotMatch(out.replaceAll("\n", ""), INDEPENDENT_FORBIDDEN, key);
      assert.doesNotMatch(out, /\p{M}{4}/u, key);
      assert.doesNotMatch(out, /\n{3}/, key);
      assert.ok(Array.from(out).length <= cap, key);
      raw.push(v);
      seen.push(out);
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(r.data, "");
  assert.ok(seen.length > 20);
  // The fixture must really contain every stripped class, or the check above proves nothing.
  const all = raw.join("");
  for (const [name, c] of STRIPPED_EXAMPLES) assert.ok(all.includes(c), `fixture lacks ${name}`);
  assert.match(all, /\p{M}{4}/u, "fixture lacks a long combining run");
  assert.match(all, /\n{3}/, "fixture lacks a newline run");
  assert.equal(sanitizeText(r.data.tasks[0].title, CAPS.title).length, 200);
  // Markup is not rewritten here; rendering as plain text is the defence (plan section 4).
  assert.ok(seen.some((s) => s.includes("javascript:alert(1)")));
});
