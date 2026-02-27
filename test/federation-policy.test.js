import test from "node:test";
import assert from "node:assert/strict";

import { buildFederationProxyPolicy, evaluateFederationTrustAndRoute, validateFederationEnvelope } from "../src/federation/proxy-policy.js";

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
  assert.equal(bad.code, "FEDERATION_PROTOCOL_VERSION_MISMATCH");
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
  assert.equal(checked.code, "FEDERATION_UNTRUSTED_COORDINATOR");
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

