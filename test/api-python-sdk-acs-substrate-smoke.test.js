import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { createApi } from "../src/api/app.js";
import { authKeyId, authKeySecret, hashAuthKeySecret } from "../src/core/auth.js";
import { listenOnEphemeralLoopback } from "./lib/listen.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function pythonAvailable() {
  const probe = spawnSync("python3", ["--version"], { encoding: "utf8" });
  return probe.status === 0;
}

function uniqueSuffix() {
  return `${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
}

test("api-sdk-python: ACS substrate wrappers execute a live end-to-end collaboration flow", { skip: !pythonAvailable() }, async (t) => {
  const api = createApi();
  const tenantId = `tenant_sdk_py_acs_${uniqueSuffix()}`;

  const keyId = authKeyId();
  const secret = authKeySecret();
  await api.store.putAuthKey({
    tenantId,
    authKey: {
      keyId,
      secretHash: hashAuthKeySecret(secret),
      scopes: ["ops_read", "ops_write", "finance_read", "finance_write", "audit_read"],
      status: "active",
      createdAt: typeof api.store.nowIso === "function" ? api.store.nowIso() : new Date().toISOString(),
    },
  });

  const server = http.createServer(api.handle);
  let port = null;
  try {
    ({ port } = await listenOnEphemeralLoopback(server, { hosts: ["127.0.0.1"] }));
  } catch (err) {
    const cause = err?.cause ?? err;
    if (cause?.code === "EPERM" || cause?.code === "EACCES") {
      t.skip(`loopback listen not permitted (${cause.code})`);
      return;
    }
    throw err;
  }

  try {
    const run = await new Promise((resolve, reject) => {
      const child = spawn("python3", [path.join(REPO_ROOT, "scripts", "examples", "sdk-acs-substrate-smoke.py")], {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          PYTHONDONTWRITEBYTECODE: "1",
          NOOTERRA_BASE_URL: `http://127.0.0.1:${port}`,
          NOOTERRA_TENANT_ID: tenantId,
          NOOTERRA_API_KEY: `${keyId}.${secret}`,
        },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", reject);
      child.on("close", (status) => resolve({ status: status ?? 1, stdout, stderr }));
    });
    assert.equal(
      run.status,
      0,
      `python sdk ACS substrate smoke failed\n\nstdout:\n${run.stdout ?? ""}\n\nstderr:\n${run.stderr ?? ""}`
    );

    const summary = JSON.parse(String(run.stdout ?? "{}"));
    assert.ok(typeof summary.principalAgentId === "string" && summary.principalAgentId.length > 0);
    assert.ok(typeof summary.workerAgentId === "string" && summary.workerAgentId.length > 0);
    assert.ok(typeof summary.delegationGrantId === "string" && summary.delegationGrantId.length > 0);
    assert.ok(typeof summary.authorityGrantId === "string" && summary.authorityGrantId.length > 0);
    assert.ok(typeof summary.workOrderId === "string" && summary.workOrderId.length > 0);
    assert.equal(summary.workOrderStatus, "completed");
    assert.equal(summary.completionStatus, "success");
    assert.ok(Number(summary.workOrderReceiptCount) >= 1);
    assert.ok(Number(summary.workOrderMeterCount) >= 1);
    assert.ok(typeof summary.workOrderMeterDigest === "string" && summary.workOrderMeterDigest.length === 64);
    assert.ok(typeof summary.sessionId === "string" && summary.sessionId.length > 0);
    assert.ok(Number(summary.sessionEventCount) >= 1);
    assert.ok(typeof summary.checkpointId === "string" && summary.checkpointId.length > 0);
    assert.ok(typeof summary.checkpointHash === "string" && summary.checkpointHash.length === 64);
    assert.ok(Number(summary.checkpointListCount) >= 1);
    assert.ok(typeof summary.checkpointDelegationGrantRef === "string" && summary.checkpointDelegationGrantRef.length > 0);
    assert.equal(summary.checkpointAuthorityGrantRef, summary.authorityGrantId);
    assert.ok(typeof summary.attestationId === "string" && summary.attestationId.length > 0);
    assert.equal(summary.attestationRuntimeStatus, "valid");
    assert.ok(Number(summary.attestationListCount) >= 1);
    assert.equal(summary.publicReputationSummaryAgentId, summary.workerAgentId);
    assert.ok(Number(summary.publicReputationRelationshipCount) >= 0);
    assert.ok(Number(summary.interactionGraphRelationshipCount) >= 0);
    assert.ok(Number(summary.relationshipsCount) >= 0);
    assert.ok(typeof summary.delegationRevokedAt === "string" && summary.delegationRevokedAt.length > 0);
    assert.ok(typeof summary.authorityRevokedAt === "string" && summary.authorityRevokedAt.length > 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("api-sdk-python: parity adapters align HTTP + MCP semantics under failure injection", { skip: !pythonAvailable() }, () => {
  const script = [
    "import json, pathlib, sys",
    "repo = pathlib.Path.cwd()",
    "sys.path.insert(0, str(repo / 'packages' / 'api-sdk-python'))",
    "from nooterra_api_sdk import NooterraApiError, NooterraClient",
    "from nooterra_api_sdk.client import NooterraParityError",
    "attempts = {}",
    "http_calls = []",
    "mcp_calls = []",
    "def fake_request(method, path, **kwargs):",
    "    idempotency_key = kwargs.get('idempotency_key')",
    "    key = f\"http:{idempotency_key}\"",
    "    attempt = attempts.get(key, 0) + 1",
    "    attempts[key] = attempt",
    "    http_calls.append({'method': method, 'path': path, 'idempotencyKey': idempotency_key, 'attempt': attempt})",
    "    if attempt == 1:",
    "        raise NooterraApiError(status=503, code='TEMP_UNAVAILABLE', message='temporary outage', details={'attempt': attempt}, request_id=f'req_http_{attempt}')",
    "    return {'ok': True, 'status': 201, 'requestId': f'req_http_{attempt}', 'body': {'delegationGrant': {'grantId': 'dg_py_1', 'status': 'active'}}, 'headers': {'x-request-id': f'req_http_{attempt}'}}",
    "def call_tool(tool_name, request_payload):",
    "    idempotency_key = request_payload.get('idempotencyKey')",
    "    key = f\"mcp:{idempotency_key}\"",
    "    attempt = attempts.get(key, 0) + 1",
    "    attempts[key] = attempt",
    "    mcp_calls.append({'toolName': tool_name, 'idempotencyKey': idempotency_key, 'attempt': attempt})",
    "    if attempt == 1:",
    "        return {'ok': False, 'status': 503, 'requestId': f'req_mcp_{attempt}', 'error': {'code': 'TEMP_UNAVAILABLE', 'message': 'temporary outage', 'details': {'attempt': attempt}}}",
    "    return {'ok': True, 'status': 201, 'requestId': f'req_mcp_{attempt}', 'body': {'delegationGrant': {'grantId': 'dg_py_1', 'status': 'active'}}, 'headers': {'x-request-id': f'req_mcp_{attempt}'}}",
    "client = NooterraClient(base_url='https://api.nooterra.local', tenant_id='tenant_py_parity')",
    "client._request = fake_request",
    "http_adapter = client.create_http_parity_adapter(max_attempts=2, retry_status_codes=[503], retry_delay_seconds=0)",
    "mcp_adapter = client.create_mcp_parity_adapter(call_tool=call_tool, max_attempts=2, retry_status_codes=[503], retry_delay_seconds=0)",
    "operation_http = {'operationId': 'delegation_grant_issue', 'method': 'POST', 'path': '/delegation-grants', 'requiredFields': ['grantId', 'delegatorAgentId', 'delegateeAgentId'], 'idempotencyRequired': True}",
    "operation_mcp = {'operationId': 'delegation_grant_issue', 'toolName': 'nooterra.delegation_grant_issue', 'requiredFields': ['grantId', 'delegatorAgentId', 'delegateeAgentId'], 'idempotencyRequired': True}",
    "payload = {'grantId': 'dg_py_1', 'delegatorAgentId': 'agt_principal', 'delegateeAgentId': 'agt_worker'}",
    "http_result = http_adapter.invoke(operation_http, payload, request_id='req_py_parity_1', idempotency_key='idem_py_parity_1')",
    "mcp_result = mcp_adapter.invoke(operation_mcp, payload, request_id='req_py_parity_1', idempotency_key='idem_py_parity_1')",
    "errors = {}",
    "try:",
    "    http_adapter.invoke(operation_http, {'grantId': 'dg_py_1'}, request_id='req_py_fail_1', idempotency_key='idem_py_fail_1')",
    "except NooterraParityError as exc:",
    "    errors['httpMissingField'] = exc.to_dict()",
    "try:",
    "    mcp_adapter.invoke(operation_mcp, {'grantId': 'dg_py_1'}, request_id='req_py_fail_2', idempotency_key='idem_py_fail_2')",
    "except NooterraParityError as exc:",
    "    errors['mcpMissingField'] = exc.to_dict()",
    "try:",
    "    http_adapter.invoke(operation_http, payload, request_id='req_py_fail_3')",
    "except NooterraParityError as exc:",
    "    errors['httpMissingIdempotency'] = exc.to_dict()",
    "try:",
    "    mcp_adapter.invoke(operation_mcp, payload, request_id='req_py_fail_4')",
    "except NooterraParityError as exc:",
    "    errors['mcpMissingIdempotency'] = exc.to_dict()",
    "print(json.dumps({'httpResult': http_result, 'mcpResult': mcp_result, 'httpCalls': http_calls, 'mcpCalls': mcp_calls, 'errors': errors}, sort_keys=True))",
  ].join("\n");

  const run = spawnSync("python3", ["-c", script], { encoding: "utf8" });
  assert.equal(
    run.status,
    0,
    `python parity adapter contract check failed\\n\\nstdout:\\n${run.stdout ?? ""}\\n\\nstderr:\\n${run.stderr ?? ""}`
  );
  const parsed = JSON.parse(String(run.stdout ?? "{}"));
  const httpResult = parsed?.httpResult ?? {};
  const mcpResult = parsed?.mcpResult ?? {};
  assert.equal(httpResult.transport, "http");
  assert.equal(mcpResult.transport, "mcp");
  assert.equal(httpResult.status, 201);
  assert.equal(mcpResult.status, 201);
  assert.equal(httpResult.attempts, 2);
  assert.equal(mcpResult.attempts, 2);
  assert.equal(httpResult.idempotencyKey, "idem_py_parity_1");
  assert.equal(mcpResult.idempotencyKey, "idem_py_parity_1");
  assert.deepEqual(httpResult.body, mcpResult.body);

  const httpCalls = Array.isArray(parsed?.httpCalls) ? parsed.httpCalls : [];
  const mcpCalls = Array.isArray(parsed?.mcpCalls) ? parsed.mcpCalls : [];
  assert.equal(httpCalls.length, 2);
  assert.equal(mcpCalls.length, 2);
  assert.equal(httpCalls[0]?.idempotencyKey, "idem_py_parity_1");
  assert.equal(httpCalls[1]?.idempotencyKey, "idem_py_parity_1");
  assert.equal(mcpCalls[0]?.idempotencyKey, "idem_py_parity_1");
  assert.equal(mcpCalls[1]?.idempotencyKey, "idem_py_parity_1");

  const errors = parsed?.errors ?? {};
  assert.equal(errors?.httpMissingField?.code, "PARITY_REQUIRED_FIELD_MISSING");
  assert.equal(errors?.mcpMissingField?.code, "PARITY_REQUIRED_FIELD_MISSING");
  assert.equal(errors?.httpMissingIdempotency?.code, "PARITY_IDEMPOTENCY_KEY_REQUIRED");
  assert.equal(errors?.mcpMissingIdempotency?.code, "PARITY_IDEMPOTENCY_KEY_REQUIRED");
});
