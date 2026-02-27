import test from "node:test";
import assert from "node:assert/strict";

import { buildOpenApiSpec } from "../src/api/openapi.js";

function assertKnownCodes(spec, { path, status, expected }) {
  const operation = spec?.paths?.[path]?.post ?? null;
  assert.ok(operation, `missing POST ${path}`);
  const codes = operation?.responses?.[String(status)]?.["x-nooterra-known-error-codes"] ?? [];
  assert.deepEqual(
    [...codes].sort(),
    [...expected].sort(),
    `known federation codes mismatch for POST ${path} ${status}`
  );
}

test("OpenAPI federation error-code parity: invoke endpoint codes match runtime fail-closed surface", () => {
  const spec = buildOpenApiSpec();
  assertKnownCodes(spec, {
    path: "/v1/federation/invoke",
    status: 400,
    expected: [
      "FEDERATION_ENVELOPE_INVALID",
      "FEDERATION_ENVELOPE_INVALID_JSON",
      "FEDERATION_PROTOCOL_VERSION_MISMATCH",
      "FEDERATION_ENVELOPE_TYPE_MISMATCH",
      "FEDERATION_INVOCATION_ID_REQUIRED",
      "FEDERATION_ORIGIN_DID_INVALID",
      "FEDERATION_TARGET_DID_INVALID",
      "FEDERATION_CAPABILITY_ID_REQUIRED"
    ]
  });
  assertKnownCodes(spec, {
    path: "/v1/federation/invoke",
    status: 403,
    expected: ["FEDERATION_IDENTITY_MISMATCH", "FEDERATION_UNTRUSTED_COORDINATOR"]
  });
  assertKnownCodes(spec, {
    path: "/v1/federation/invoke",
    status: 409,
    expected: ["FEDERATION_ENVELOPE_CONFLICT", "FEDERATION_ENVELOPE_IN_FLIGHT"]
  });
  assertKnownCodes(spec, {
    path: "/v1/federation/invoke",
    status: 500,
    expected: ["FEDERATION_FETCH_UNAVAILABLE"]
  });
  assertKnownCodes(spec, {
    path: "/v1/federation/invoke",
    status: 502,
    expected: ["FEDERATION_UPSTREAM_UNREACHABLE"]
  });
  assertKnownCodes(spec, {
    path: "/v1/federation/invoke",
    status: 503,
    expected: [
      "FEDERATION_NOT_CONFIGURED",
      "FEDERATION_IDENTITY_NOT_CONFIGURED",
      "FEDERATION_TRUST_NOT_CONFIGURED",
      "FEDERATION_NAMESPACE_ROUTE_MISSING"
    ]
  });
});

test("OpenAPI federation error-code parity: result endpoint codes match runtime fail-closed surface", () => {
  const spec = buildOpenApiSpec();
  assertKnownCodes(spec, {
    path: "/v1/federation/result",
    status: 400,
    expected: [
      "FEDERATION_ENVELOPE_INVALID",
      "FEDERATION_ENVELOPE_INVALID_JSON",
      "FEDERATION_PROTOCOL_VERSION_MISMATCH",
      "FEDERATION_ENVELOPE_TYPE_MISMATCH",
      "FEDERATION_INVOCATION_ID_REQUIRED",
      "FEDERATION_ORIGIN_DID_INVALID",
      "FEDERATION_TARGET_DID_INVALID",
      "FEDERATION_RESULT_STATUS_INVALID"
    ]
  });
  assertKnownCodes(spec, {
    path: "/v1/federation/result",
    status: 403,
    expected: ["FEDERATION_IDENTITY_MISMATCH", "FEDERATION_UNTRUSTED_COORDINATOR"]
  });
  assertKnownCodes(spec, {
    path: "/v1/federation/result",
    status: 409,
    expected: ["FEDERATION_ENVELOPE_CONFLICT", "FEDERATION_ENVELOPE_IN_FLIGHT"]
  });
  assertKnownCodes(spec, {
    path: "/v1/federation/result",
    status: 500,
    expected: ["FEDERATION_FETCH_UNAVAILABLE"]
  });
  assertKnownCodes(spec, {
    path: "/v1/federation/result",
    status: 502,
    expected: ["FEDERATION_UPSTREAM_UNREACHABLE"]
  });
  assertKnownCodes(spec, {
    path: "/v1/federation/result",
    status: 503,
    expected: [
      "FEDERATION_NOT_CONFIGURED",
      "FEDERATION_IDENTITY_NOT_CONFIGURED",
      "FEDERATION_TRUST_NOT_CONFIGURED",
      "FEDERATION_NAMESPACE_ROUTE_MISSING"
    ]
  });
});
