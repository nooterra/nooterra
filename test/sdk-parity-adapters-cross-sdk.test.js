import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import { NooterraClient } from "../packages/api-sdk/src/index.js";

const OPERATION_ID = "run_dispute_evidence_submit";
const MAIN_IDEMPOTENCY_KEY = "idem_cross_sdk_parity_1";
const RETRYABLE_IDEMPOTENCY_KEY = "idem_cross_sdk_retryable_1";
const EXPECTED_PREV_CHAIN_HASH = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const PAYLOAD = Object.freeze({
  disputeId: "dsp_cross_sdk_1",
  evidenceRef: "evidence://run_cross_sdk_1/output.json"
});
const EXPECTED_VALIDATION_CODES = Object.freeze({
  httpMissingField: "PARITY_REQUIRED_FIELD_MISSING",
  mcpMissingField: "PARITY_REQUIRED_FIELD_MISSING",
  httpMissingIdempotency: "PARITY_IDEMPOTENCY_KEY_REQUIRED",
  mcpMissingIdempotency: "PARITY_IDEMPOTENCY_KEY_REQUIRED",
  httpMissingExpectedPrevChainHash: "PARITY_EXPECTED_PREV_CHAIN_HASH_REQUIRED",
  mcpMissingExpectedPrevChainHash: "PARITY_EXPECTED_PREV_CHAIN_HASH_REQUIRED"
});

function pythonAvailable() {
  const probe = spawnSync("python3", ["--version"], { encoding: "utf8" });
  return probe.status === 0;
}

function makeJsonResponse(body, { status = 200, requestId = "req_cross_sdk_1" } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "x-request-id": requestId
    }
  });
}

function httpOperation() {
  return {
    operationId: OPERATION_ID,
    method: "POST",
    path: "/runs/run_cross_sdk_1/dispute/evidence",
    requiredFields: ["disputeId", "evidenceRef"],
    idempotencyRequired: true,
    expectedPrevChainHashRequired: true
  };
}

function mcpOperation() {
  return {
    operationId: OPERATION_ID,
    toolName: "nooterra.run_dispute_evidence_submit",
    requiredFields: ["disputeId", "evidenceRef"],
    idempotencyRequired: true,
    expectedPrevChainHashRequired: true
  };
}

async function captureParityError(run) {
  try {
    await run;
    assert.fail("expected parity error");
  } catch (error) {
    assert.ok(error?.nooterra, "expected parity error with nooterra metadata");
    return {
      status: error?.nooterra?.status ?? null,
      code: error?.nooterra?.code ?? null,
      retryable: Boolean(error?.nooterra?.retryable),
      attempts: error?.nooterra?.attempts ?? null,
      idempotencyKey: error?.nooterra?.idempotencyKey ?? null
    };
  }
}

async function captureParityCode(run) {
  const parityError = await captureParityError(run);
  return parityError.code;
}

async function runNodeScenario() {
  const attemptsByTransportAndIdempotency = new Map();
  const httpCalls = [];
  const mcpCalls = [];

  const fetchStub = async (_url, init) => {
    const idempotencyKey = init?.headers?.["x-idempotency-key"] ?? null;
    const attemptKey = `http:${idempotencyKey}`;
    const attempt = (attemptsByTransportAndIdempotency.get(attemptKey) ?? 0) + 1;
    attemptsByTransportAndIdempotency.set(attemptKey, attempt);
    httpCalls.push({ idempotencyKey, attempt });
    if (idempotencyKey === RETRYABLE_IDEMPOTENCY_KEY || attempt === 1) {
      return makeJsonResponse(
        { code: "TEMP_UNAVAILABLE", error: "temporary outage", details: { attempt } },
        { status: 503, requestId: `req_http_${attempt}` }
      );
    }
    return makeJsonResponse(
      { dispute: { disputeId: PAYLOAD.disputeId, status: "open" } },
      { status: 201, requestId: `req_http_${attempt}` }
    );
  };

  const callTool = async (_toolName, requestPayload) => {
    const idempotencyKey = requestPayload?.idempotencyKey ?? null;
    const attemptKey = `mcp:${idempotencyKey}`;
    const attempt = (attemptsByTransportAndIdempotency.get(attemptKey) ?? 0) + 1;
    attemptsByTransportAndIdempotency.set(attemptKey, attempt);
    mcpCalls.push({ idempotencyKey, attempt });
    if (idempotencyKey === RETRYABLE_IDEMPOTENCY_KEY || attempt === 1) {
      return {
        ok: false,
        status: 503,
        requestId: `req_mcp_${attempt}`,
        error: { code: "TEMP_UNAVAILABLE", message: "temporary outage", details: { attempt } }
      };
    }
    return {
      ok: true,
      status: 201,
      requestId: `req_mcp_${attempt}`,
      body: { dispute: { disputeId: PAYLOAD.disputeId, status: "open" } },
      headers: { "x-request-id": `req_mcp_${attempt}` }
    };
  };

  const client = new NooterraClient({
    baseUrl: "https://api.nooterra.local",
    tenantId: "tenant_cross_sdk_parity",
    fetch: fetchStub
  });

  const retryingHttpAdapter = client.createHttpParityAdapter({
    maxAttempts: 2,
    retryStatusCodes: [503],
    retryDelayMs: 0
  });
  const retryingMcpAdapter = client.createMcpParityAdapter({
    maxAttempts: 2,
    retryStatusCodes: [503],
    retryDelayMs: 0,
    callTool
  });
  const failFastHttpAdapter = client.createHttpParityAdapter({
    maxAttempts: 1,
    retryStatusCodes: [503],
    retryDelayMs: 0
  });
  const failFastMcpAdapter = client.createMcpParityAdapter({
    maxAttempts: 1,
    retryStatusCodes: [503],
    retryDelayMs: 0,
    callTool
  });

  const httpResult = await retryingHttpAdapter.invoke(httpOperation(), PAYLOAD, {
    requestId: "req_cross_sdk_success_1",
    idempotencyKey: MAIN_IDEMPOTENCY_KEY,
    expectedPrevChainHash: EXPECTED_PREV_CHAIN_HASH
  });
  const mcpResult = await retryingMcpAdapter.invoke(mcpOperation(), PAYLOAD, {
    requestId: "req_cross_sdk_success_1",
    idempotencyKey: MAIN_IDEMPOTENCY_KEY,
    expectedPrevChainHash: EXPECTED_PREV_CHAIN_HASH
  });

  const retryableErrors = {
    http: await captureParityError(
      failFastHttpAdapter.invoke(httpOperation(), PAYLOAD, {
        requestId: "req_cross_sdk_retryable_http_1",
        idempotencyKey: RETRYABLE_IDEMPOTENCY_KEY,
        expectedPrevChainHash: EXPECTED_PREV_CHAIN_HASH
      })
    ),
    mcp: await captureParityError(
      failFastMcpAdapter.invoke(mcpOperation(), PAYLOAD, {
        requestId: "req_cross_sdk_retryable_mcp_1",
        idempotencyKey: RETRYABLE_IDEMPOTENCY_KEY,
        expectedPrevChainHash: EXPECTED_PREV_CHAIN_HASH
      })
    )
  };

  const validationErrorCodes = {
    httpMissingField: await captureParityCode(
      retryingHttpAdapter.invoke(httpOperation(), { disputeId: PAYLOAD.disputeId }, {
        requestId: "req_cross_sdk_validation_http_field_1",
        idempotencyKey: "idem_cross_sdk_validation_http_field_1",
        expectedPrevChainHash: EXPECTED_PREV_CHAIN_HASH
      })
    ),
    mcpMissingField: await captureParityCode(
      retryingMcpAdapter.invoke(mcpOperation(), { disputeId: PAYLOAD.disputeId }, {
        requestId: "req_cross_sdk_validation_mcp_field_1",
        idempotencyKey: "idem_cross_sdk_validation_mcp_field_1",
        expectedPrevChainHash: EXPECTED_PREV_CHAIN_HASH
      })
    ),
    httpMissingIdempotency: await captureParityCode(
      retryingHttpAdapter.invoke(httpOperation(), PAYLOAD, {
        requestId: "req_cross_sdk_validation_http_idem_1",
        expectedPrevChainHash: EXPECTED_PREV_CHAIN_HASH
      })
    ),
    mcpMissingIdempotency: await captureParityCode(
      retryingMcpAdapter.invoke(mcpOperation(), PAYLOAD, {
        requestId: "req_cross_sdk_validation_mcp_idem_1",
        expectedPrevChainHash: EXPECTED_PREV_CHAIN_HASH
      })
    ),
    httpMissingExpectedPrevChainHash: await captureParityCode(
      retryingHttpAdapter.invoke(httpOperation(), PAYLOAD, {
        requestId: "req_cross_sdk_validation_http_prev_1",
        idempotencyKey: "idem_cross_sdk_validation_http_prev_1"
      })
    ),
    mcpMissingExpectedPrevChainHash: await captureParityCode(
      retryingMcpAdapter.invoke(mcpOperation(), PAYLOAD, {
        requestId: "req_cross_sdk_validation_mcp_prev_1",
        idempotencyKey: "idem_cross_sdk_validation_mcp_prev_1"
      })
    )
  };

  return {
    success: {
      http: {
        status: httpResult.status,
        attempts: httpResult.attempts,
        idempotencyKey: httpResult.idempotencyKey
      },
      mcp: {
        status: mcpResult.status,
        attempts: mcpResult.attempts,
        idempotencyKey: mcpResult.idempotencyKey
      }
    },
    idempotencyReuse: {
      http: httpCalls.filter((entry) => entry.idempotencyKey === MAIN_IDEMPOTENCY_KEY).map((entry) => entry.idempotencyKey),
      mcp: mcpCalls.filter((entry) => entry.idempotencyKey === MAIN_IDEMPOTENCY_KEY).map((entry) => entry.idempotencyKey)
    },
    retryableErrors,
    validationErrorCodes
  };
}

function runPythonScenario() {
  const script = [
    "import json, pathlib, sys",
    "repo = pathlib.Path.cwd()",
    "sys.path.insert(0, str(repo / 'packages' / 'api-sdk-python'))",
    "from nooterra_api_sdk import NooterraApiError, NooterraClient",
    "from nooterra_api_sdk.client import NooterraParityError",
    "OPERATION_ID = 'run_dispute_evidence_submit'",
    "MAIN_IDEMPOTENCY_KEY = 'idem_cross_sdk_parity_1'",
    "RETRYABLE_IDEMPOTENCY_KEY = 'idem_cross_sdk_retryable_1'",
    "EXPECTED_PREV_CHAIN_HASH = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'",
    "PAYLOAD = {'disputeId': 'dsp_cross_sdk_1', 'evidenceRef': 'evidence://run_cross_sdk_1/output.json'}",
    "attempts = {}",
    "http_calls = []",
    "mcp_calls = []",
    "def next_attempt(prefix, idempotency_key):",
    "    key = f\"{prefix}:{idempotency_key}\"",
    "    attempt = attempts.get(key, 0) + 1",
    "    attempts[key] = attempt",
    "    return attempt",
    "def fake_request(method, path, **kwargs):",
    "    idempotency_key = kwargs.get('idempotency_key')",
    "    attempt = next_attempt('http', idempotency_key)",
    "    http_calls.append({'idempotencyKey': idempotency_key, 'attempt': attempt})",
    "    if idempotency_key == RETRYABLE_IDEMPOTENCY_KEY or attempt == 1:",
    "        raise NooterraApiError(status=503, code='TEMP_UNAVAILABLE', message='temporary outage', details={'attempt': attempt}, request_id=f'req_http_{attempt}')",
    "    return {'ok': True, 'status': 201, 'requestId': f'req_http_{attempt}', 'body': {'dispute': {'disputeId': PAYLOAD['disputeId'], 'status': 'open'}}, 'headers': {'x-request-id': f'req_http_{attempt}'}}",
    "def call_tool(_tool_name, request_payload):",
    "    idempotency_key = request_payload.get('idempotencyKey')",
    "    attempt = next_attempt('mcp', idempotency_key)",
    "    mcp_calls.append({'idempotencyKey': idempotency_key, 'attempt': attempt})",
    "    if idempotency_key == RETRYABLE_IDEMPOTENCY_KEY or attempt == 1:",
    "        return {'ok': False, 'status': 503, 'requestId': f'req_mcp_{attempt}', 'error': {'code': 'TEMP_UNAVAILABLE', 'message': 'temporary outage', 'details': {'attempt': attempt}}}",
    "    return {'ok': True, 'status': 201, 'requestId': f'req_mcp_{attempt}', 'body': {'dispute': {'disputeId': PAYLOAD['disputeId'], 'status': 'open'}}, 'headers': {'x-request-id': f'req_mcp_{attempt}'}}",
    "def capture_parity_error(run):",
    "    try:",
    "        run()",
    "    except NooterraParityError as exc:",
    "        return {",
    "            'status': exc.status,",
    "            'code': exc.code,",
    "            'retryable': bool(exc.retryable),",
    "            'attempts': exc.attempts,",
    "            'idempotencyKey': exc.idempotency_key,",
    "        }",
    "    raise RuntimeError('expected parity error')",
    "def capture_parity_code(run):",
    "    return capture_parity_error(run).get('code')",
    "client = NooterraClient(base_url='https://api.nooterra.local', tenant_id='tenant_cross_sdk_parity')",
    "client._request = fake_request",
    "retrying_http_adapter = client.create_http_parity_adapter(max_attempts=2, retry_status_codes=[503], retry_delay_seconds=0)",
    "retrying_mcp_adapter = client.create_mcp_parity_adapter(call_tool=call_tool, max_attempts=2, retry_status_codes=[503], retry_delay_seconds=0)",
    "fail_fast_http_adapter = client.create_http_parity_adapter(max_attempts=1, retry_status_codes=[503], retry_delay_seconds=0)",
    "fail_fast_mcp_adapter = client.create_mcp_parity_adapter(call_tool=call_tool, max_attempts=1, retry_status_codes=[503], retry_delay_seconds=0)",
    "http_operation = {",
    "    'operationId': OPERATION_ID,",
    "    'method': 'POST',",
    "    'path': '/runs/run_cross_sdk_1/dispute/evidence',",
    "    'requiredFields': ['disputeId', 'evidenceRef'],",
    "    'idempotencyRequired': True,",
    "    'expectedPrevChainHashRequired': True,",
    "}",
    "mcp_operation = {",
    "    'operationId': OPERATION_ID,",
    "    'toolName': 'nooterra.run_dispute_evidence_submit',",
    "    'requiredFields': ['disputeId', 'evidenceRef'],",
    "    'idempotencyRequired': True,",
    "    'expectedPrevChainHashRequired': True,",
    "}",
    "http_result = retrying_http_adapter.invoke(http_operation, PAYLOAD, request_id='req_cross_sdk_success_1', idempotency_key=MAIN_IDEMPOTENCY_KEY, expected_prev_chain_hash=EXPECTED_PREV_CHAIN_HASH)",
    "mcp_result = retrying_mcp_adapter.invoke(mcp_operation, PAYLOAD, request_id='req_cross_sdk_success_1', idempotency_key=MAIN_IDEMPOTENCY_KEY, expected_prev_chain_hash=EXPECTED_PREV_CHAIN_HASH)",
    "retryable_errors = {",
    "    'http': capture_parity_error(lambda: fail_fast_http_adapter.invoke(http_operation, PAYLOAD, request_id='req_cross_sdk_retryable_http_1', idempotency_key=RETRYABLE_IDEMPOTENCY_KEY, expected_prev_chain_hash=EXPECTED_PREV_CHAIN_HASH)),",
    "    'mcp': capture_parity_error(lambda: fail_fast_mcp_adapter.invoke(mcp_operation, PAYLOAD, request_id='req_cross_sdk_retryable_mcp_1', idempotency_key=RETRYABLE_IDEMPOTENCY_KEY, expected_prev_chain_hash=EXPECTED_PREV_CHAIN_HASH)),",
    "}",
    "validation_error_codes = {",
    "    'httpMissingField': capture_parity_code(lambda: retrying_http_adapter.invoke(http_operation, {'disputeId': PAYLOAD['disputeId']}, request_id='req_cross_sdk_validation_http_field_1', idempotency_key='idem_cross_sdk_validation_http_field_1', expected_prev_chain_hash=EXPECTED_PREV_CHAIN_HASH)),",
    "    'mcpMissingField': capture_parity_code(lambda: retrying_mcp_adapter.invoke(mcp_operation, {'disputeId': PAYLOAD['disputeId']}, request_id='req_cross_sdk_validation_mcp_field_1', idempotency_key='idem_cross_sdk_validation_mcp_field_1', expected_prev_chain_hash=EXPECTED_PREV_CHAIN_HASH)),",
    "    'httpMissingIdempotency': capture_parity_code(lambda: retrying_http_adapter.invoke(http_operation, PAYLOAD, request_id='req_cross_sdk_validation_http_idem_1', expected_prev_chain_hash=EXPECTED_PREV_CHAIN_HASH)),",
    "    'mcpMissingIdempotency': capture_parity_code(lambda: retrying_mcp_adapter.invoke(mcp_operation, PAYLOAD, request_id='req_cross_sdk_validation_mcp_idem_1', expected_prev_chain_hash=EXPECTED_PREV_CHAIN_HASH)),",
    "    'httpMissingExpectedPrevChainHash': capture_parity_code(lambda: retrying_http_adapter.invoke(http_operation, PAYLOAD, request_id='req_cross_sdk_validation_http_prev_1', idempotency_key='idem_cross_sdk_validation_http_prev_1')),",
    "    'mcpMissingExpectedPrevChainHash': capture_parity_code(lambda: retrying_mcp_adapter.invoke(mcp_operation, PAYLOAD, request_id='req_cross_sdk_validation_mcp_prev_1', idempotency_key='idem_cross_sdk_validation_mcp_prev_1')),",
    "}",
    "out = {",
    "    'success': {",
    "        'http': {'status': http_result.get('status'), 'attempts': http_result.get('attempts'), 'idempotencyKey': http_result.get('idempotencyKey')},",
    "        'mcp': {'status': mcp_result.get('status'), 'attempts': mcp_result.get('attempts'), 'idempotencyKey': mcp_result.get('idempotencyKey')},",
    "    },",
    "    'idempotencyReuse': {",
    "        'http': [entry.get('idempotencyKey') for entry in http_calls if entry.get('idempotencyKey') == MAIN_IDEMPOTENCY_KEY],",
    "        'mcp': [entry.get('idempotencyKey') for entry in mcp_calls if entry.get('idempotencyKey') == MAIN_IDEMPOTENCY_KEY],",
    "    },",
    "    'retryableErrors': retryable_errors,",
    "    'validationErrorCodes': validation_error_codes,",
    "}",
    "print(json.dumps(out, sort_keys=True))",
  ].join("\n");

  const run = spawnSync("python3", ["-c", script], { encoding: "utf8" });
  assert.equal(
    run.status,
    0,
    `python cross-sdk parity scenario failed\\n\\nstdout:\\n${run.stdout ?? ""}\\n\\nstderr:\\n${run.stderr ?? ""}`
  );
  return JSON.parse(String(run.stdout ?? "{}"));
}

test("sdk parity adapters: JS and Python stay aligned on normalized parity semantics", { skip: !pythonAvailable() }, async () => {
  const nodeOutcome = await runNodeScenario();
  const pythonOutcome = runPythonScenario();

  assert.deepEqual(nodeOutcome, pythonOutcome);
  assert.deepEqual(nodeOutcome.validationErrorCodes, EXPECTED_VALIDATION_CODES);
  assert.deepEqual(nodeOutcome.idempotencyReuse.http, [MAIN_IDEMPOTENCY_KEY, MAIN_IDEMPOTENCY_KEY]);
  assert.deepEqual(nodeOutcome.idempotencyReuse.mcp, [MAIN_IDEMPOTENCY_KEY, MAIN_IDEMPOTENCY_KEY]);
  assert.equal(nodeOutcome.retryableErrors.http.retryable, true);
  assert.equal(nodeOutcome.retryableErrors.mcp.retryable, true);
});
