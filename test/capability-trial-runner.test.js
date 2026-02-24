import test from "node:test";
import assert from "node:assert/strict";

import { computeDeterministicTrialReportHash, parseArgs } from "../scripts/trials/run-capability-trial.mjs";

test("capability trials runner: parseArgs supports positional trial id", () => {
  const args = parseArgs(["work_order_worker_protocol.v1", "--bootstrap-local"]);
  assert.equal(args.trialId, "work_order_worker_protocol.v1");
  assert.equal(args.bootstrapLocal, true);
});

test("capability trials runner: deterministic report hash ignores volatile check fields", () => {
  const trial = { trialId: "work_order_worker_protocol.v1" };
  const base = {
    trial,
    subjectAgentId: "agt_trial_worker_1",
    ok: true,
    checks: [{ id: "check_a", ok: true, code: null, message: "volatile" }],
    issuedAttestationId: null
  };
  const h1 = computeDeterministicTrialReportHash(base);
  const h2 = computeDeterministicTrialReportHash({
    ...base,
    checks: [{ id: "check_a", ok: true, code: null, message: "different volatile text" }]
  });
  assert.equal(h1, h2);

  const h3 = computeDeterministicTrialReportHash({
    ...base,
    checks: [{ id: "check_a", ok: false, code: "FAILED" }]
  });
  assert.notEqual(h1, h3);
});

