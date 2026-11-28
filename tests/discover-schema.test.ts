import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DiscoverPayload, parseDiscoverJson } from "../shared/discover-schema.ts";

const load = (name: string): string => readFileSync(new URL(`../fixtures/exports/${name}`, import.meta.url), "utf8");
const recorded = () => JSON.parse(load("harbor-discover.json"));
const accepts = (mutate: (p: ReturnType<typeof recorded>) => void): boolean => {
  const p = recorded();
  mutate(p);
  return DiscoverPayload.safeParse(p).success;
};

test("the recorded Discover export parses with its research and decisions", () => {
  const r = parseDiscoverJson(load("harbor-discover.json"));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.data.schema, "etat-major/discover@1");
  assert.deepEqual(r.data.research.map((x) => [x.id, x.status, x.provenance]), [
    ["0001", "reviewed", "ai-generated"],
    ["0002", "unreviewed", "ai-generated"],
    ["0003", "superseded", "human"],
  ]);
  assert.deepEqual(r.data.decisions.map((d) => [d.id, d.status]), [
    ["0001", "approved"], ["0002", "rejected"], ["0003", "proposed"], ["0004", "postponed"],
  ]);
  assert.deepEqual(r.data.research[1]!.findings[1], {
    id: "f2", text: "A daily summary would be read more often than single alerts.", source: null, source_date: null, unsourced: true,
  });
  assert.equal(r.data.decisions[1]!.alternatives.length, 2);
  assert.equal(r.data.decisions[1]!.cites[1]!.state, "unsourced");
});

test("the schema marker and version 1 are required", () => {
  for (const marker of ["etat-major/discover@2", "etat-major/planning@1", "", null, undefined]) {
    assert.equal(accepts((p) => { p.schema = marker; }), false, `schema ${String(marker)}`);
  }
  for (const version of [2, 0, "1", null, undefined]) assert.equal(accepts((p) => { p.version = version; }), false, `version ${String(version)}`);
  assert.deepEqual(parseDiscoverJson(load("harbor.json")), { ok: false, code: "SCHEMA_MISMATCH" });
});

test("invalid JSON and wrong shapes map to fixed codes", () => {
  assert.deepEqual(parseDiscoverJson("{"), { ok: false, code: "BAD_JSON" });
  for (const text of ["null", "[]", "{}", "1"]) assert.deepEqual(parseDiscoverJson(text), { ok: false, code: "SCHEMA_MISMATCH" }, text);
});

test("every contract key is required", () => {
  for (const key of ["research", "decisions", "omitted_research", "omitted_decisions", "issue_count", "query"]) {
    assert.equal(accepts((p) => { delete p[key]; }), false, key);
  }
  for (const key of ["id", "title", "status", "provenance", "project", "findings", "omitted_findings", "features"]) {
    assert.equal(accepts((p) => { delete p.research[0][key]; }), false, `research.${key}`);
  }
  for (const key of ["id", "text", "source", "source_date", "unsourced"]) {
    assert.equal(accepts((p) => { delete p.research[0].findings[0][key]; }), false, `finding.${key}`);
  }
  for (const key of ["id", "question", "status", "decided_on", "chosen", "rationale", "alternatives", "omitted_alternatives", "cites", "omitted_cites", "features"]) {
    assert.equal(accepts((p) => { delete p.decisions[0][key]; }), false, `decision.${key}`);
  }
  for (const key of ["ref", "state", "status", "provenance"]) assert.equal(accepts((p) => { delete p.decisions[0].cites[0][key]; }), false, `cite.${key}`);
});

test("enumerated values are closed: an unknown status, provenance or cite state is a mismatch, never relabelled", () => {
  for (const status of ["unreviewed", "reviewed", "superseded"]) assert.ok(accepts((p) => { p.research[0].status = status; }), status);
  for (const v of ["verified", "inferred", "ai-generated", "human"]) assert.ok(accepts((p) => { p.research[0].provenance = v; }), v);
  for (const v of ["proposed", "approved", "rejected", "postponed", "superseded"]) assert.ok(accepts((p) => { p.decisions[0].status = v; }), v);
  for (const v of ["ok", "unsourced", "missing"]) assert.ok(accepts((p) => { p.decisions[0].cites[0].state = v; }), v);
  assert.equal(accepts((p) => { p.research[0].status = "approved"; }), false);
  assert.equal(accepts((p) => { p.research[0].provenance = "trusted"; }), false);
  assert.equal(accepts((p) => { p.decisions[0].status = "Rejected"; }), false);
  assert.equal(accepts((p) => { p.decisions[0].cites[0].state = "fine"; }), false);
});

test("alternatives are exactly two strings and counts are non-negative integers", () => {
  for (const bad of [["only"], ["a", "b", "c"], ["a", 1], "a", {}]) assert.equal(accepts((p) => { p.decisions[0].alternatives = [bad]; }), false, JSON.stringify(bad));
  for (const bad of [-1, 1.5, "0", null]) {
    assert.equal(accepts((p) => { p.issue_count = bad; }), false, `issue_count ${String(bad)}`);
    assert.equal(accepts((p) => { p.research[0].omitted_findings = bad; }), false, `omitted_findings ${String(bad)}`);
    assert.equal(accepts((p) => { p.decisions[0].omitted_cites = bad; }), false, `omitted_cites ${String(bad)}`);
  }
});

test("unknown keys are stripped", () => {
  const p = recorded();
  p.extra = 1;
  p.research[0].extra = 1;
  p.research[0].findings[0].extra = 1;
  p.decisions[0].extra = 1;
  p.decisions[0].cites[0].extra = 1;
  const r = DiscoverPayload.parse(p);
  assert.equal(JSON.stringify(r).includes('"extra"'), false);
});

test("the hostile Discover fixture parses, so the view model has to neutralise it", () => {
  const r = parseDiscoverJson(load("discover-hostile.handcrafted.json"));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.data.research[0]!.title.length, 10000);
  assert.match(r.data.decisions[0]!.question, /<script>/);
  assert.match(r.data.decisions[0]!.question, /‮/);
});

test("recordings carry no absolute filesystem paths", () => {
  assert.doesNotMatch(load("harbor-discover.json"), /\/home\/|\/var\/|\/tmp\/|\/Users\//);
});
