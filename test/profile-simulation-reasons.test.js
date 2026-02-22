import test from "node:test";
import assert from "node:assert/strict";

import {
  listProfileSimulationReasonDefinitions,
  mapProfileSimulationReasons
} from "../src/core/profile-simulation-reasons.js";

test("profile simulation reasons: registry contains stable entries", () => {
  const entries = listProfileSimulationReasonDefinitions();
  assert.equal(entries.length >= 8, true);
  const byCheckId = new Map(entries.map((entry) => [entry.checkId, entry]));
  assert.equal(byCheckId.get("approval_required")?.code, "PROFILE_APPROVAL_REQUIRED");
  assert.equal(byCheckId.get("monthly_limit")?.severity, "error");
});

test("profile simulation reasons: mapping returns deterministic reason codes and hints", () => {
  const mapped = mapProfileSimulationReasons(["tool_allowlisted", "approval_required", "tool_allowlisted"]);
  assert.deepEqual(
    mapped.map((entry) => entry.code),
    ["PROFILE_TOOL_NOT_ALLOWLISTED", "PROFILE_APPROVAL_REQUIRED"]
  );
  assert.equal(mapped[1].remediationHint.length > 0, true);
});

test("profile simulation reasons: unknown reason id fails closed by default", () => {
  assert.throws(
    () => mapProfileSimulationReasons(["tool_allowlisted", "unknown_reason_id"]),
    /unknown profile simulation reason id/
  );
});

test("profile simulation reasons: unknown reason id can be ignored when requested", () => {
  const mapped = mapProfileSimulationReasons(["tool_allowlisted", "unknown_reason_id"], { failOnUnknown: false });
  assert.deepEqual(mapped.map((entry) => entry.code), ["PROFILE_TOOL_NOT_ALLOWLISTED"]);
});
