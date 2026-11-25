import { test } from "node:test";
import assert from "node:assert/strict";
import { SETTINGS_ID, SETTINGS_VERSION } from "../server/settings.ts";
import { clientSettings } from "../client/settings-def.ts";
import { getSummary, publishSummary, subscribeSummary } from "../client/summary-store.ts";

test("client settings definition matches the server registration", () => {
  assert.equal(clientSettings.id, SETTINGS_ID);
  assert.equal(clientSettings.version, SETTINGS_VERSION);
  assert.equal(clientSettings.scope, "host");
  assert.deepEqual(Object.keys(clientSettings.schema.shape).sort(), ["executable", "project", "workspace"]);
});

test("summary store: empty at first, notifies subscribers, unsubscribe stops notifications", () => {
  assert.equal(getSummary(), null);
  let calls = 0;
  const off = subscribeSummary(() => void (calls += 1));
  publishSummary({ short: "7 tasks", label: "x" });
  assert.equal(calls, 1);
  assert.deepEqual(getSummary(), { short: "7 tasks", label: "x" });
  off();
  publishSummary(null);
  assert.equal(calls, 1);
  assert.equal(getSummary(), null);
});
