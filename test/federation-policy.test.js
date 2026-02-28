import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFederationProxyPolicy,
  evaluateFederationTrustAndRoute,
  isTrustedFederationCoordinatorDid,
  validateFederationEnvelope
} from "../src/federation/proxy-policy.js";
import { FEDERATION_ERROR_CODE, FEDERATION_OPENAPI_ERROR_CODES } from "../src/federation/error-codes.js";

function invokeEnvelope(overrides = {}) {
  return {
    version: "1.0",
    type: "coordinatorInvoke",
    invocationId: "inv_policy_1",
    originDid: "did:nooterra:coord_alpha",
    targetDid: "did:nooterra:coord_bravo",
    capabilityId: "capability.dispatch.v1",
    payload: { op: "ping" },
    ...overrides
  };
}

test("federation policy: validates invoke envelope", () => {
  const ok = validateFederationEnvelope({ endpoint: "invoke", body: invokeEnvelope() });
  assert.equal(ok.ok, true);

  const bad = validateFederationEnvelope({ endpoint: "invoke", body: { ...invokeEnvelope(), version: "2.0" } });
  assert.equal(bad.ok, false);
  assert.equal(bad.code, FEDERATION_ERROR_CODE.PROTOCOL_VERSION_MISMATCH);
});

test("federation policy: parses namespace routes deterministically", () => {
  const policy = buildFederationProxyPolicy({
    env: {
      COORDINATOR_DID: "did:nooterra:coord_alpha",
      PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS: "did:nooterra:coord_bravo,did:nooterra:coord_charlie",
      PROXY_FEDERATION_NAMESPACE_ROUTES: JSON.stringify({
        "did:nooterra:coord_charlie": "https://charlie.nooterra.test/root/",
        "did:nooterra:coord_bravo": "https://bravo.nooterra.test/base/"
      })
    },
    fallbackBaseUrl: null
  });

  assert.equal(policy.namespaceRoutes.get("did:nooterra:coord_bravo"), "https://bravo.nooterra.test/base");
  assert.equal(policy.namespaceRoutes.get("did:nooterra:coord_charlie"), "https://charlie.nooterra.test/root");
});

test("federation policy: fails closed when peer is not trusted", () => {
  const policy = buildFederationProxyPolicy({
    env: {
      COORDINATOR_DID: "did:nooterra:coord_alpha",
      PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS: "did:nooterra:coord_charlie"
    },
    fallbackBaseUrl: "https://federation.nooterra.test"
  });

  const checked = evaluateFederationTrustAndRoute({
    endpoint: "invoke",
    envelope: validateFederationEnvelope({ endpoint: "invoke", body: invokeEnvelope() }).envelope,
    policy
  });

  assert.equal(checked.ok, false);
  assert.equal(checked.code, FEDERATION_ERROR_CODE.UNTRUSTED_COORDINATOR);
});

test("federation policy: trusted coordinator helper is deterministic and strict", () => {
  const policy = buildFederationProxyPolicy({
    env: {
      COORDINATOR_DID: "did:nooterra:coord_alpha",
      PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS: "did:nooterra:coord_bravo,did:nooterra:coord_charlie"
    },
    fallbackBaseUrl: "https://federation.nooterra.test"
  });
  assert.equal(
    isTrustedFederationCoordinatorDid({
      policy,
      did: "did:nooterra:coord_bravo"
    }),
    true
  );
  assert.equal(
    isTrustedFederationCoordinatorDid({
      policy,
      did: " did:nooterra:coord_bravo "
    }),
    true
  );
  assert.equal(
    isTrustedFederationCoordinatorDid({
      policy,
      did: "did:nooterra:coord_delta"
    }),
    false
  );
  assert.equal(
    isTrustedFederationCoordinatorDid({
      policy,
      did: "coord_delta"
    }),
    false
  );
});

test("federation policy: selects namespace route by exact target DID", () => {
  const policy = buildFederationProxyPolicy({
    env: {
      COORDINATOR_DID: "did:nooterra:coord_alpha",
      PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS: "did:nooterra:coord_bravo",
      PROXY_FEDERATION_NAMESPACE_ROUTES: JSON.stringify({
        "did:nooterra:coord_bravo": "https://bravo.nooterra.test"
      })
    },
    fallbackBaseUrl: "https://fallback.nooterra.test"
  });

  const checked = evaluateFederationTrustAndRoute({
    endpoint: "invoke",
    envelope: validateFederationEnvelope({ endpoint: "invoke", body: invokeEnvelope() }).envelope,
    policy
  });

  assert.equal(checked.ok, true);
  assert.equal(checked.namespaceDid, "did:nooterra:coord_bravo");
  assert.equal(checked.upstreamBaseUrl, "https://bravo.nooterra.test");
});

test("federation policy: incoming invoke does not require outbound namespace transport", () => {
  const policy = buildFederationProxyPolicy({
    env: {
      COORDINATOR_DID: "did:nooterra:coord_alpha",
      PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS: "did:nooterra:coord_bravo"
    },
    fallbackBaseUrl: null
  });
  const checked = evaluateFederationTrustAndRoute({
    endpoint: "invoke",
    envelope: validateFederationEnvelope({
      endpoint: "invoke",
      body: invokeEnvelope({
        originDid: "did:nooterra:coord_bravo",
        targetDid: "did:nooterra:coord_alpha"
      })
    }).envelope,
    policy
  });
  assert.equal(checked.ok, true);
  assert.equal(checked.direction, "incoming");
  assert.equal(checked.upstreamBaseUrl, null);
});

test("federation policy: validate envelope bad-request codes stay aligned with shared OpenAPI constants", () => {
  const invokeCases = [
    null,
    { ...invokeEnvelope(), version: "2.0" },
    { ...invokeEnvelope(), type: "coordinatorResult" },
    { ...invokeEnvelope(), invocationId: "" },
    { ...invokeEnvelope(), originDid: "bad-did" },
    { ...invokeEnvelope(), targetDid: "bad-did" },
    { ...invokeEnvelope(), capabilityId: "" }
  ];
  const resultCases = [
    null,
    { ...invokeEnvelope({ type: "coordinatorResult" }), version: "2.0" },
    { ...invokeEnvelope({ type: "coordinatorResult" }), type: "coordinatorInvoke" },
    { ...invokeEnvelope({ type: "coordinatorResult" }), invocationId: "" },
    { ...invokeEnvelope({ type: "coordinatorResult" }), originDid: "bad-did" },
    { ...invokeEnvelope({ type: "coordinatorResult" }), targetDid: "bad-did" },
    { ...invokeEnvelope({ type: "coordinatorResult", status: "invalid" }) }
  ];

  const invokeCodes = new Set(
    invokeCases.map((body) => validateFederationEnvelope({ endpoint: "invoke", body })).map((outcome) => outcome.code)
  );
  const resultCodes = new Set(
    resultCases.map((body) => validateFederationEnvelope({ endpoint: "result", body })).map((outcome) => outcome.code)
  );

  const invokeExpected = FEDERATION_OPENAPI_ERROR_CODES.invoke[400].filter((code) => code !== FEDERATION_ERROR_CODE.ENVELOPE_INVALID_JSON);
  const resultExpected = FEDERATION_OPENAPI_ERROR_CODES.result[400].filter((code) => code !== FEDERATION_ERROR_CODE.ENVELOPE_INVALID_JSON);
  assert.deepEqual([...invokeCodes].sort(), [...invokeExpected].sort());
  assert.deepEqual([...resultCodes].sort(), [...resultExpected].sort());
});

test("federation policy: explicit fallback denied code is documented in 403 catalogs", () => {
  assert.ok(FEDERATION_OPENAPI_ERROR_CODES.invoke[403].includes(FEDERATION_ERROR_CODE.REQUEST_DENIED));
  assert.ok(FEDERATION_OPENAPI_ERROR_CODES.result[403].includes(FEDERATION_ERROR_CODE.REQUEST_DENIED));
});
