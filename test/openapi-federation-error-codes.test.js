import test from "node:test";
import assert from "node:assert/strict";

import { buildOpenApiSpec } from "../src/api/openapi.js";
import { FEDERATION_ERROR_CODE, FEDERATION_OPENAPI_ERROR_CODES } from "../src/federation/error-codes.js";

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

test("OpenAPI federation error-code parity: invoke endpoint codes match shared federation constants", () => {
  const spec = buildOpenApiSpec();
  assertKnownCodes(spec, {
    path: "/v1/federation/invoke",
    status: 400,
    expected: FEDERATION_OPENAPI_ERROR_CODES.invoke[400]
  });
  assertKnownCodes(spec, {
    path: "/v1/federation/invoke",
    status: 403,
    expected: FEDERATION_OPENAPI_ERROR_CODES.invoke[403]
  });
  assertKnownCodes(spec, {
    path: "/v1/federation/invoke",
    status: 409,
    expected: FEDERATION_OPENAPI_ERROR_CODES.invoke[409]
  });
  assertKnownCodes(spec, {
    path: "/v1/federation/invoke",
    status: 500,
    expected: FEDERATION_OPENAPI_ERROR_CODES.invoke[500]
  });
  assertKnownCodes(spec, {
    path: "/v1/federation/invoke",
    status: 502,
    expected: FEDERATION_OPENAPI_ERROR_CODES.invoke[502]
  });
  assertKnownCodes(spec, {
    path: "/v1/federation/invoke",
    status: 503,
    expected: FEDERATION_OPENAPI_ERROR_CODES.invoke[503]
  });
});

test("OpenAPI federation error-code parity: result endpoint codes match shared federation constants", () => {
  const spec = buildOpenApiSpec();
  assertKnownCodes(spec, {
    path: "/v1/federation/result",
    status: 400,
    expected: FEDERATION_OPENAPI_ERROR_CODES.result[400]
  });
  assertKnownCodes(spec, {
    path: "/v1/federation/result",
    status: 403,
    expected: FEDERATION_OPENAPI_ERROR_CODES.result[403]
  });
  assertKnownCodes(spec, {
    path: "/v1/federation/result",
    status: 409,
    expected: FEDERATION_OPENAPI_ERROR_CODES.result[409]
  });
  assertKnownCodes(spec, {
    path: "/v1/federation/result",
    status: 500,
    expected: FEDERATION_OPENAPI_ERROR_CODES.result[500]
  });
  assertKnownCodes(spec, {
    path: "/v1/federation/result",
    status: 502,
    expected: FEDERATION_OPENAPI_ERROR_CODES.result[502]
  });
  assertKnownCodes(spec, {
    path: "/v1/federation/result",
    status: 503,
    expected: FEDERATION_OPENAPI_ERROR_CODES.result[503]
  });
});

test("OpenAPI federation error-code parity: fallback denied code remains documented for backward compatibility", () => {
  const spec = buildOpenApiSpec();
  const invoke403 = spec?.paths?.["/v1/federation/invoke"]?.post?.responses?.["403"]?.["x-nooterra-known-error-codes"] ?? [];
  const result403 = spec?.paths?.["/v1/federation/result"]?.post?.responses?.["403"]?.["x-nooterra-known-error-codes"] ?? [];
  assert.ok(invoke403.includes(FEDERATION_ERROR_CODE.REQUEST_DENIED));
  assert.ok(result403.includes(FEDERATION_ERROR_CODE.REQUEST_DENIED));
});
