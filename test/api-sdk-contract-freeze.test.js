import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { SettldClient } from "../packages/api-sdk/src/index.js";

function readFile(relativePath) {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

test("api-sdk contract freeze: manual-review + dispute lifecycle methods and types remain published", () => {
  const client = new SettldClient({
    baseUrl: "https://api.settld.local",
    tenantId: "tenant_sdk_freeze",
    fetch: async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
  });

  assert.equal(typeof client.getRunSettlementPolicyReplay, "function");
  assert.equal(typeof client.resolveRunSettlement, "function");
  assert.equal(typeof client.openRunDispute, "function");
  assert.equal(typeof client.submitRunDisputeEvidence, "function");
  assert.equal(typeof client.escalateRunDispute, "function");
  assert.equal(typeof client.closeRunDispute, "function");

  const dts = readFile("packages/api-sdk/src/index.d.ts");
  assert.match(dts, /manual_review_required/);
  assert.match(dts, /manual_resolved/);
  assert.match(dts, /disputeWindowDays\?: number/);
  assert.match(dts, /disputeWindowEndsAt\?: string \| null/);
  assert.match(dts, /openRunDispute\(/);
  assert.match(dts, /submitRunDisputeEvidence\(/);
  assert.match(dts, /escalateRunDispute\(/);
  assert.match(dts, /closeRunDispute\(/);

  const jsClient = readFile("packages/api-sdk/src/client.js");
  assert.match(jsClient, /\/runs\/\$\{encodeURIComponent\(runId\)\}\/settlement\/policy-replay/);
  assert.match(jsClient, /\/runs\/\$\{encodeURIComponent\(runId\)\}\/settlement\/resolve/);
  assert.match(jsClient, /\/runs\/\$\{encodeURIComponent\(runId\)\}\/dispute\/open/);
  assert.match(jsClient, /\/runs\/\$\{encodeURIComponent\(runId\)\}\/dispute\/evidence/);
  assert.match(jsClient, /\/runs\/\$\{encodeURIComponent\(runId\)\}\/dispute\/escalate/);
  assert.match(jsClient, /\/runs\/\$\{encodeURIComponent\(runId\)\}\/dispute\/close/);
});
