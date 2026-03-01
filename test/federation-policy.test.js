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

function resultEnvelope(overrides = {}) {
  return {
    version: "1.0",
    type: "coordinatorResult",
    invocationId: "inv_policy_result_1",
    originDid: "did:nooterra:coord_bravo",
    targetDid: "did:nooterra:coord_alpha",
    status: "success",
    result: { ok: true },
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
  assert.equal(checked.routingReasonCode, "FEDERATION_NAMESPACE_ROUTE_RESOLVED");
});

test("federation policy: namespace registry resolves delegation deterministically", () => {
  const registry = [
    {
      recordId: "route_a",
      namespaceDid: "did:nooterra:coord_bravo",
      ownerDid: "did:nooterra:coord_bravo",
      delegateDid: "did:nooterra:coord_charlie",
      routeBaseUrl: "https://charlie.nooterra.test/fed",
      observedAt: "2026-02-27T00:00:00.000Z",
      ttlSeconds: 86400,
      priority: 10
    }
  ];
  const policy = buildFederationProxyPolicy({
    env: {
      COORDINATOR_DID: "did:nooterra:coord_alpha",
      PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS: "did:nooterra:coord_bravo,did:nooterra:coord_charlie",
      PROXY_FEDERATION_NAMESPACE_AS_OF: "2026-02-27T01:00:00.000Z",
      PROXY_FEDERATION_NAMESPACE_REGISTRY: JSON.stringify(registry)
    },
    fallbackBaseUrl: "https://fallback.nooterra.test"
  });

  const first = evaluateFederationTrustAndRoute({
    endpoint: "invoke",
    envelope: validateFederationEnvelope({ endpoint: "invoke", body: invokeEnvelope() }).envelope,
    policy
  });
  const second = evaluateFederationTrustAndRoute({
    endpoint: "invoke",
    envelope: validateFederationEnvelope({ endpoint: "invoke", body: invokeEnvelope() }).envelope,
    policy
  });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.resolvedCoordinatorDid, "did:nooterra:coord_charlie");
  assert.equal(second.resolvedCoordinatorDid, "did:nooterra:coord_charlie");
  assert.equal(first.upstreamBaseUrl, "https://charlie.nooterra.test/fed");
  assert.equal(second.upstreamBaseUrl, "https://charlie.nooterra.test/fed");
  assert.equal(first.routingReasonCode, "FEDERATION_NAMESPACE_ROUTE_RESOLVED");
  assert.equal(first.namespaceLineage?.decisionId, second.namespaceLineage?.decisionId);
});

test("federation policy: namespace registry fails closed when records are stale", () => {
  const policy = buildFederationProxyPolicy({
    env: {
      COORDINATOR_DID: "did:nooterra:coord_alpha",
      PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS: "did:nooterra:coord_bravo",
      PROXY_FEDERATION_NAMESPACE_REGISTRY: JSON.stringify([
        {
          recordId: "stale_route_1",
          namespaceDid: "did:nooterra:coord_bravo",
          ownerDid: "did:nooterra:coord_bravo",
          routeBaseUrl: "https://bravo.nooterra.test",
          observedAt: "2020-01-01T00:00:00.000Z",
          ttlSeconds: 60
        }
      ])
    },
    fallbackBaseUrl: "https://fallback.nooterra.test"
  });

  const checked = evaluateFederationTrustAndRoute({
    endpoint: "invoke",
    envelope: validateFederationEnvelope({ endpoint: "invoke", body: invokeEnvelope() }).envelope,
    policy
  });
  assert.equal(checked.ok, false);
  assert.equal(checked.code, FEDERATION_ERROR_CODE.NAMESPACE_RECORD_STALE);
});

test("federation policy: namespace registry fails closed when top-priority records are ambiguous", () => {
  const policy = buildFederationProxyPolicy({
    env: {
      COORDINATOR_DID: "did:nooterra:coord_alpha",
      PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS: "did:nooterra:coord_bravo,did:nooterra:coord_charlie",
      PROXY_FEDERATION_NAMESPACE_AS_OF: "2026-02-27T01:00:00.000Z",
      PROXY_FEDERATION_NAMESPACE_REGISTRY: JSON.stringify([
        {
          recordId: "amb_1",
          namespaceDid: "did:nooterra:coord_bravo",
          ownerDid: "did:nooterra:coord_bravo",
          routeBaseUrl: "https://bravo-a.nooterra.test",
          observedAt: "2026-02-27T00:00:00.000Z",
          ttlSeconds: 86400,
          priority: 50
        },
        {
          recordId: "amb_2",
          namespaceDid: "did:nooterra:coord_bravo",
          ownerDid: "did:nooterra:coord_charlie",
          routeBaseUrl: "https://charlie.nooterra.test",
          observedAt: "2026-02-27T00:00:00.000Z",
          ttlSeconds: 86400,
          priority: 50
        }
      ])
    }
  });

  const checked = evaluateFederationTrustAndRoute({
    endpoint: "invoke",
    envelope: validateFederationEnvelope({ endpoint: "invoke", body: invokeEnvelope() }).envelope,
    policy
  });
  assert.equal(checked.ok, false);
  assert.equal(checked.code, FEDERATION_ERROR_CODE.NAMESPACE_ROUTE_AMBIGUOUS);
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

test("federation policy: incoming result does not require outbound namespace transport", () => {
  const policy = buildFederationProxyPolicy({
    env: {
      COORDINATOR_DID: "did:nooterra:coord_alpha",
      PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS: "did:nooterra:coord_bravo"
    },
    fallbackBaseUrl: null
  });
  const checked = evaluateFederationTrustAndRoute({
    endpoint: "result",
    envelope: validateFederationEnvelope({
      endpoint: "result",
      body: resultEnvelope({
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

test("federation policy: namespace registry conflict codes are documented in 409 catalogs", () => {
  assert.ok(FEDERATION_OPENAPI_ERROR_CODES.invoke[409].includes(FEDERATION_ERROR_CODE.NAMESPACE_ROUTE_CONFLICT));
  assert.ok(FEDERATION_OPENAPI_ERROR_CODES.invoke[409].includes(FEDERATION_ERROR_CODE.NAMESPACE_ROUTE_AMBIGUOUS));
  assert.ok(FEDERATION_OPENAPI_ERROR_CODES.invoke[409].includes(FEDERATION_ERROR_CODE.NAMESPACE_RECORD_STALE));
  assert.ok(FEDERATION_OPENAPI_ERROR_CODES.result[409].includes(FEDERATION_ERROR_CODE.NAMESPACE_ROUTE_CONFLICT));
  assert.ok(FEDERATION_OPENAPI_ERROR_CODES.result[409].includes(FEDERATION_ERROR_CODE.NAMESPACE_ROUTE_AMBIGUOUS));
  assert.ok(FEDERATION_OPENAPI_ERROR_CODES.result[409].includes(FEDERATION_ERROR_CODE.NAMESPACE_RECORD_STALE));
});
