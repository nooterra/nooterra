import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function pythonAvailable() {
  const probe = spawnSync("python3", ["--version"], { encoding: "utf8" });
  return probe.status === 0;
}

function readFile(relativePath) {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

test("api-sdk-python contract freeze: manual-review + dispute lifecycle methods remain published", () => {
  const source = readFile("packages/api-sdk-python/settld_api_sdk/client.py");
  const readme = readFile("packages/api-sdk-python/README.md");

  assert.match(source, /def get_run_settlement_policy_replay\(/);
  assert.match(source, /def resolve_run_settlement\(/);
  assert.match(source, /def open_run_dispute\(/);
  assert.match(source, /def submit_run_dispute_evidence\(/);
  assert.match(source, /def escalate_run_dispute\(/);
  assert.match(source, /def close_run_dispute\(/);

  assert.match(source, /\/settlement\/policy-replay/);
  assert.match(source, /\/settlement\/resolve/);
  assert.match(source, /\/dispute\/open/);
  assert.match(source, /\/dispute\/evidence/);
  assert.match(source, /\/dispute\/escalate/);
  assert.match(source, /\/dispute\/close/);

  assert.match(readme, /get_run_settlement_policy_replay/);
  assert.match(readme, /resolve_run_settlement/);
  assert.match(readme, /open_run_dispute/);
  assert.match(readme, /submit_run_dispute_evidence/);
  assert.match(readme, /escalate_run_dispute/);
  assert.match(readme, /close_run_dispute/);
});

test("api-sdk-python contract freeze: dispute lifecycle dispatch wiring remains stable", { skip: !pythonAvailable() }, () => {
  const script = [
    "import json, pathlib, sys",
    "repo = pathlib.Path.cwd()",
    "sys.path.insert(0, str(repo / 'packages' / 'api-sdk-python'))",
    "from settld_api_sdk import SettldClient",
    "calls = []",
    "def fake(method, path, **kwargs):",
    "    calls.append({",
    "        'method': method,",
    "        'path': path,",
    "        'idempotencyKey': kwargs.get('idempotency_key'),",
    "        'body': kwargs.get('body')",
    "    })",
    "    return {'ok': True, 'status': 200, 'requestId': 'req_py_sdk_1', 'body': {'settlement': {'disputeStatus': 'open'}}}",
    "client = SettldClient(base_url='https://api.settld.local', tenant_id='tenant_py_sdk')",
    "client._request = fake",
    "client.get_run_settlement_policy_replay('run_py_1')",
    "client.resolve_run_settlement('run_py_1', {'status': 'released'}, idempotency_key='py_resolve_1')",
    "client.open_run_dispute('run_py_1', {'disputeId': 'dsp_py_1', 'escalationLevel': 'l1_counterparty'}, idempotency_key='py_open_1')",
    "client.submit_run_dispute_evidence('run_py_1', {'disputeId': 'dsp_py_1', 'evidenceRef': 'evidence://run_py_1/output.json'}, idempotency_key='py_evidence_1')",
    "client.escalate_run_dispute('run_py_1', {'disputeId': 'dsp_py_1', 'escalationLevel': 'l2_arbiter'}, idempotency_key='py_escalate_1')",
    "client.close_run_dispute('run_py_1', {'disputeId': 'dsp_py_1', 'resolutionOutcome': 'partial'}, idempotency_key='py_close_1')",
    "print(json.dumps(calls))"
  ].join("\n");

  const run = spawnSync("python3", ["-c", script], { encoding: "utf8" });
  assert.equal(
    run.status,
    0,
    `python lifecycle contract check failed\n\nstdout:\n${run.stdout ?? ""}\n\nstderr:\n${run.stderr ?? ""}`
  );

  const calls = JSON.parse(String(run.stdout ?? "[]"));
  assert.equal(calls.length, 6);
  assert.deepEqual(
    calls.map((entry) => [entry.method, entry.path]),
    [
      ["GET", "/runs/run_py_1/settlement/policy-replay"],
      ["POST", "/runs/run_py_1/settlement/resolve"],
      ["POST", "/runs/run_py_1/dispute/open"],
      ["POST", "/runs/run_py_1/dispute/evidence"],
      ["POST", "/runs/run_py_1/dispute/escalate"],
      ["POST", "/runs/run_py_1/dispute/close"]
    ]
  );
  assert.equal(calls[1].idempotencyKey, "py_resolve_1");
  assert.equal(calls[2].idempotencyKey, "py_open_1");
  assert.equal(calls[3].idempotencyKey, "py_evidence_1");
  assert.equal(calls[4].idempotencyKey, "py_escalate_1");
  assert.equal(calls[5].idempotencyKey, "py_close_1");
});
