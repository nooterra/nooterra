import test from "node:test";
import assert from "node:assert/strict";

import { runProfileSimulationPreflight } from "../scripts/setup/onboard.mjs";

test("onboard profile preflight: baseline starter profile simulates allow", async () => {
  const result = await runProfileSimulationPreflight({ profileId: "engineering-spend" });
  assert.equal(result.ok, true, result.detail);
  assert.match(String(result.detail), /decision=allow/);
  assert.match(String(result.detail), /fingerprint=[0-9a-f]{64}/);
});

test("onboard profile preflight: unknown profile fails closed with actionable detail", async () => {
  const result = await runProfileSimulationPreflight({ profileId: "missing-profile-id" });
  assert.equal(result.ok, false);
  assert.match(String(result.detail), /profile init failed/i);
});
