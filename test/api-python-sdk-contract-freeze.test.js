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

test("api-python-sdk contract freeze: parity adapter surface remains published", () => {
  const source = readFile("packages/api-sdk-python/nooterra_api_sdk/client.py");
  const readme = readFile("packages/api-sdk-python/README.md");

  assert.match(source, /class NooterraParityError/);
  assert.match(source, /class NooterraHttpParityAdapter/);
  assert.match(source, /class NooterraMcpParityAdapter/);
  assert.match(source, /def create_http_parity_adapter\(/);
  assert.match(source, /def create_mcp_parity_adapter\(/);
  assert.match(source, /PARITY_IDEMPOTENCY_KEY_REQUIRED/);
  assert.match(source, /PARITY_EXPECTED_PREV_CHAIN_HASH_REQUIRED/);
  assert.match(source, /retry_status_codes/);
  assert.match(source, /idempotencyRequired/);
  assert.match(source, /expectedPrevChainHashRequired/);

  assert.match(readme, /Transport Parity Adapters \(HTTP \+ MCP\)/);
  assert.match(readme, /create_http_parity_adapter/);
  assert.match(readme, /create_mcp_parity_adapter/);
  assert.match(readme, /PARITY_\*/);
  assert.match(readme, /idempotencyRequired=True/);
});

test("api-python-sdk contract freeze: parity adapter request wiring remains stable", { skip: !pythonAvailable() }, () => {
  const script = [
    "import json, pathlib, sys",
    "repo = pathlib.Path.cwd()",
    "sys.path.insert(0, str(repo / 'packages' / 'api-sdk-python'))",
    "from nooterra_api_sdk import NooterraClient",
    "from nooterra_api_sdk.client import NooterraParityError",
    "calls = []",
    "def fake_request(method, path, **kwargs):",
    "    calls.append({'transport': 'http', 'method': method, 'path': path, 'idempotencyKey': kwargs.get('idempotency_key')})",
    "    return {'ok': True, 'status': 201, 'requestId': 'req_http_1', 'body': {'delegationGrant': {'grantId': 'dg_py_1'}}, 'headers': {'x-request-id': 'req_http_1'}}",
    "def call_tool(tool_name, request_payload):",
    "    calls.append({'transport': 'mcp', 'toolName': tool_name, 'idempotencyKey': request_payload.get('idempotencyKey')})",
    "    return {'ok': True, 'status': 201, 'requestId': 'req_mcp_1', 'body': {'delegationGrant': {'grantId': 'dg_py_1'}}, 'headers': {'x-request-id': 'req_mcp_1'}}",
    "client = NooterraClient(base_url='https://api.nooterra.local', tenant_id='tenant_py_freeze')",
    "client._request = fake_request",
    "http_adapter = client.create_http_parity_adapter(max_attempts=1)",
    "mcp_adapter = client.create_mcp_parity_adapter(call_tool=call_tool, max_attempts=1)",
    "op_http = {'operationId': 'delegation_grant_issue', 'method': 'POST', 'path': '/delegation-grants', 'requiredFields': ['grantId', 'delegatorAgentId', 'delegateeAgentId'], 'idempotencyRequired': True}",
    "op_mcp = {'operationId': 'delegation_grant_issue', 'toolName': 'nooterra.delegation_grant_issue', 'requiredFields': ['grantId', 'delegatorAgentId', 'delegateeAgentId'], 'idempotencyRequired': True}",
    "payload = {'grantId': 'dg_py_1', 'delegatorAgentId': 'agt_principal', 'delegateeAgentId': 'agt_worker'}",
    "http_result = http_adapter.invoke(op_http, payload, request_id='req_py_freeze_1', idempotency_key='idem_py_freeze_1')",
    "mcp_result = mcp_adapter.invoke(op_mcp, payload, request_id='req_py_freeze_1', idempotency_key='idem_py_freeze_1')",
    "validation_codes = {}",
    "try:",
    "    http_adapter.invoke(op_http, payload, request_id='req_py_freeze_2')",
    "except NooterraParityError as exc:",
    "    validation_codes['http'] = exc.code",
    "try:",
    "    mcp_adapter.invoke(op_mcp, payload, request_id='req_py_freeze_3')",
    "except NooterraParityError as exc:",
    "    validation_codes['mcp'] = exc.code",
    "print(json.dumps({'calls': calls, 'httpResult': http_result, 'mcpResult': mcp_result, 'validationCodes': validation_codes}, sort_keys=True))",
  ].join("\n");

  const run = spawnSync("python3", ["-c", script], { encoding: "utf8" });
  assert.equal(
    run.status,
    0,
    `python parity freeze script failed\\n\\nstdout:\\n${run.stdout ?? ""}\\n\\nstderr:\\n${run.stderr ?? ""}`
  );
  const parsed = JSON.parse(String(run.stdout ?? "{}"));
  assert.equal(parsed?.httpResult?.operationId, "delegation_grant_issue");
  assert.equal(parsed?.mcpResult?.operationId, "delegation_grant_issue");
  assert.equal(parsed?.httpResult?.idempotencyKey, "idem_py_freeze_1");
  assert.equal(parsed?.mcpResult?.idempotencyKey, "idem_py_freeze_1");
  assert.equal(parsed?.validationCodes?.http, "PARITY_IDEMPOTENCY_KEY_REQUIRED");
  assert.equal(parsed?.validationCodes?.mcp, "PARITY_IDEMPOTENCY_KEY_REQUIRED");

  const calls = Array.isArray(parsed?.calls) ? parsed.calls : [];
  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map((entry) => [entry.transport, entry.idempotencyKey]),
    [
      ["http", "idem_py_freeze_1"],
      ["mcp", "idem_py_freeze_1"]
    ]
  );
});
