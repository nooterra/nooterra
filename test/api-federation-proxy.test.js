import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { createApi } from "../src/api/app.js";
import { canonicalJsonStringify, normalizeForCanonicalJson } from "../src/core/canonical-json.js";
import { createEd25519Keypair, keyIdFromPublicKeyPem, sha256Hex, signHashHexEd25519 } from "../src/core/crypto.js";
import { request } from "./api-test-harness.js";

const FED_KEYS = [
  "FEDERATION_PROXY_BASE_URL",
  "PROXY_FEDERATION_BASE_URL",
  "COORDINATOR_DID",
  "PROXY_COORDINATOR_DID",
  "PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS",
  "PROXY_FEDERATION_NAMESPACE_ROUTES",
  "PROXY_FEDERATION_TRUST_REGISTRY",
  "PROXY_FEDERATION_TRUST_REGISTRY_STRICT"
];

function withEnvMap(overrides = {}) {
  const prev = new Map();
  for (const key of FED_KEYS) {
    prev.set(key, Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined);
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined || value === null) delete process.env[key];
    else process.env[key] = String(value);
  }
  return () => {
    for (const key of FED_KEYS) {
      const value = prev.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address !== "object") throw new TypeError("failed to bind test server");
  return `http://127.0.0.1:${address.port}`;
}

function invokeEnvelope({ invocationId = "inv_1", originDid = "did:nooterra:coord_alpha", targetDid = "did:nooterra:coord_bravo" } = {}) {
  return {
    version: "1.0",
    type: "coordinatorInvoke",
    invocationId,
    originDid,
    targetDid,
    capabilityId: "capability.dispatch.v1",
    payload: { op: "ping" }
  };
}

function resultEnvelope({ invocationId = "inv_1", originDid = "did:nooterra:coord_bravo", targetDid = "did:nooterra:coord_alpha" } = {}) {
  return {
    version: "1.0",
    type: "coordinatorResult",
    invocationId,
    originDid,
    targetDid,
    status: "success",
    result: { ok: true }
  };
}

function signFederationEnvelope(payload, { keyId, privateKeyPem }) {
  const normalized = normalizeForCanonicalJson(
    Object.fromEntries(Object.entries(payload ?? {}).filter(([key]) => key !== "signature")),
    { path: "$" }
  );
  const payloadHash = sha256Hex(canonicalJsonStringify(normalized));
  const signature = signHashHexEd25519(payloadHash, privateKeyPem);
  return {
    ...payload,
    signature: {
      algorithm: "ed25519",
      keyId,
      signature
    }
  };
}

test("api federation proxy: fails closed when federation base URL is not configured", async () => {
  const restore = withEnvMap({
    COORDINATOR_DID: "did:nooterra:coord_alpha",
    PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS: "did:nooterra:coord_bravo"
  });
  try {
    const api = createApi();
    const res = await request(api, {
      method: "POST",
      path: "/v1/federation/invoke",
      body: invokeEnvelope(),
      auth: "none"
    });

    assert.equal(res.statusCode, 503);
    assert.equal(res.json?.code, "FEDERATION_NOT_CONFIGURED");
  } finally {
    restore();
  }
});

test("api federation proxy: fails closed when fetch is unavailable", { concurrency: false }, async () => {
  const restoreEnv = withEnvMap({
    FEDERATION_PROXY_BASE_URL: "https://federation.nooterra.test",
    COORDINATOR_DID: "did:nooterra:coord_alpha",
    PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS: "did:nooterra:coord_bravo"
  });
  const prevFetch = globalThis.fetch;
  try {
    const api = createApi();
    globalThis.fetch = undefined;
    const res = await request(api, {
      method: "POST",
      path: "/v1/federation/result",
      body: resultEnvelope(),
      auth: "none"
    });

    assert.equal(res.statusCode, 500);
    assert.equal(res.json?.code, "FEDERATION_FETCH_UNAVAILABLE");
  } finally {
    globalThis.fetch = prevFetch;
    restoreEnv();
  }
});

test("api federation proxy: fails closed when envelope is malformed", async () => {
  const restore = withEnvMap({
    FEDERATION_PROXY_BASE_URL: "https://federation.nooterra.test",
    COORDINATOR_DID: "did:nooterra:coord_alpha",
    PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS: "did:nooterra:coord_bravo"
  });
  try {
    const api = createApi();
    const res = await request(api, {
      method: "POST",
      path: "/v1/federation/invoke",
      body: { not: "envelope" },
      auth: "none"
    });

    assert.equal(res.statusCode, 400);
    assert.equal(res.json?.code, "FEDERATION_PROTOCOL_VERSION_MISMATCH");
  } finally {
    restore();
  }
});

test("api federation proxy: fails closed when federation peer is untrusted", async () => {
  const restore = withEnvMap({
    FEDERATION_PROXY_BASE_URL: "https://federation.nooterra.test",
    COORDINATOR_DID: "did:nooterra:coord_alpha",
    PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS: "did:nooterra:coord_charlie"
  });
  try {
    const api = createApi();
    const res = await request(api, {
      method: "POST",
      path: "/v1/federation/invoke",
      body: invokeEnvelope(),
      auth: "none"
    });

    assert.equal(res.statusCode, 403);
    assert.equal(res.json?.code, "FEDERATION_UNTRUSTED_COORDINATOR");
  } finally {
    restore();
  }
});

test("api federation proxy: fails closed when signature block is malformed", async () => {
  const restore = withEnvMap({
    FEDERATION_PROXY_BASE_URL: "https://federation.nooterra.test",
    COORDINATOR_DID: "did:nooterra:coord_alpha",
    PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS: "did:nooterra:coord_bravo"
  });
  try {
    const api = createApi();
    const res = await request(api, {
      method: "POST",
      path: "/v1/federation/invoke",
      body: {
        ...invokeEnvelope({ invocationId: "inv_sig_invalid_1" }),
        signature: { algorithm: "ed25519", keyId: "key_coord_bravo_1" }
      },
      auth: "none"
    });

    assert.equal(res.statusCode, 403);
    assert.equal(res.json?.code, "FEDERATION_REQUEST_DENIED");
    assert.equal(res.json?.details?.reason, "signature_value_required");
  } finally {
    restore();
  }
});

test("api federation proxy: verifies detached signature when present", async () => {
  const restore = withEnvMap({
    COORDINATOR_DID: "did:nooterra:coord_alpha",
    PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS: "did:nooterra:coord_bravo"
  });
  try {
    const api = createApi();
    const { publicKeyPem, privateKeyPem } = createEd25519Keypair();
    const keyId = keyIdFromPublicKeyPem(publicKeyPem);
    api.store.publicKeyByKeyId.set(keyId, publicKeyPem);

    const validPayload = signFederationEnvelope(
      invokeEnvelope({
        invocationId: "inv_sig_verify_ok_1",
        originDid: "did:nooterra:coord_bravo",
        targetDid: "did:nooterra:coord_alpha"
      }),
      { keyId, privateKeyPem }
    );
    const accepted = await request(api, {
      method: "POST",
      path: "/v1/federation/invoke",
      body: validPayload,
      auth: "none"
    });
    assert.equal(accepted.statusCode, 202);
    assert.equal(accepted.json?.status, "queued");

    const tamperedPayload = {
      ...validPayload,
      invocationId: "inv_sig_verify_fail_1",
      payload: { op: "tampered" }
    };
    const denied = await request(api, {
      method: "POST",
      path: "/v1/federation/invoke",
      body: tamperedPayload,
      auth: "none"
    });
    assert.equal(denied.statusCode, 403);
    assert.equal(denied.json?.code, "FEDERATION_REQUEST_DENIED");
    assert.equal(denied.json?.details?.reason, "signature_verification_failed");
  } finally {
    restore();
  }
});

test("api federation proxy: strict trust registry fails closed for unknown trust anchor key", async () => {
  const restore = withEnvMap({
    COORDINATOR_DID: "did:nooterra:coord_alpha",
    PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS: "did:nooterra:coord_bravo",
    PROXY_FEDERATION_TRUST_REGISTRY_STRICT: "true",
    PROXY_FEDERATION_TRUST_REGISTRY: JSON.stringify({})
  });
  try {
    const api = createApi();
    const { publicKeyPem, privateKeyPem } = createEd25519Keypair();
    const keyId = keyIdFromPublicKeyPem(publicKeyPem);
    api.store.publicKeyByKeyId.set(keyId, publicKeyPem);

    const payload = signFederationEnvelope(
      invokeEnvelope({
        invocationId: "inv_trust_unknown_anchor_1",
        originDid: "did:nooterra:coord_bravo",
        targetDid: "did:nooterra:coord_alpha"
      }),
      { keyId, privateKeyPem }
    );
    const denied = await request(api, {
      method: "POST",
      path: "/v1/federation/invoke",
      body: payload,
      auth: "none"
    });

    assert.equal(denied.statusCode, 403);
    assert.equal(denied.json?.code, "FEDERATION_REQUEST_DENIED");
    assert.equal(denied.json?.details?.reason, "trust_anchor_unknown");
    assert.equal(denied.json?.details?.reasonCode, "FEDERATION_TRUST_ANCHOR_UNKNOWN");
  } finally {
    restore();
  }
});

test("api federation proxy: trust anchor revocation supports historical signedAt and blocks post-revocation signedAt", async () => {
  const { publicKeyPem, privateKeyPem } = createEd25519Keypair();
  const keyId = keyIdFromPublicKeyPem(publicKeyPem);
  const restore = withEnvMap({
    COORDINATOR_DID: "did:nooterra:coord_alpha",
    PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS: "did:nooterra:coord_bravo",
    PROXY_FEDERATION_TRUST_REGISTRY_STRICT: "true",
    PROXY_FEDERATION_TRUST_REGISTRY: JSON.stringify({
      [keyId]: {
        coordinatorDid: "did:nooterra:coord_bravo",
        status: "active",
        revokedAt: "2026-01-01T00:00:10.000Z"
      }
    })
  });
  try {
    const api = createApi();
    api.store.publicKeyByKeyId.set(keyId, publicKeyPem);

    const historicalPayload = signFederationEnvelope(
      {
        ...invokeEnvelope({
          invocationId: "inv_trust_revocation_historical_1",
          originDid: "did:nooterra:coord_bravo",
          targetDid: "did:nooterra:coord_alpha"
        }),
        signedAt: "2026-01-01T00:00:05.000Z"
      },
      { keyId, privateKeyPem }
    );
    const historicalAccepted = await request(api, {
      method: "POST",
      path: "/v1/federation/invoke",
      body: historicalPayload,
      auth: "none"
    });
    assert.equal(historicalAccepted.statusCode, 202);

    const revokedPayload = signFederationEnvelope(
      {
        ...invokeEnvelope({
          invocationId: "inv_trust_revocation_blocked_1",
          originDid: "did:nooterra:coord_bravo",
          targetDid: "did:nooterra:coord_alpha"
        }),
        signedAt: "2026-01-01T00:00:20.000Z"
      },
      { keyId, privateKeyPem }
    );
    const revokedDenied = await request(api, {
      method: "POST",
      path: "/v1/federation/invoke",
      body: revokedPayload,
      auth: "none"
    });
    assert.equal(revokedDenied.statusCode, 403);
    assert.equal(revokedDenied.json?.details?.reason, "trust_anchor_revoked");
    assert.equal(revokedDenied.json?.details?.reasonCode, "FEDERATION_TRUST_ANCHOR_REVOKED");
  } finally {
    restore();
  }
});

test("api federation proxy: trust anchor rotation supports historical signedAt and blocks post-rotation signedAt", async () => {
  const { publicKeyPem, privateKeyPem } = createEd25519Keypair();
  const keyId = keyIdFromPublicKeyPem(publicKeyPem);
  const restore = withEnvMap({
    COORDINATOR_DID: "did:nooterra:coord_alpha",
    PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS: "did:nooterra:coord_bravo",
    PROXY_FEDERATION_TRUST_REGISTRY_STRICT: "true",
    PROXY_FEDERATION_TRUST_REGISTRY: JSON.stringify({
      [keyId]: {
        coordinatorDid: "did:nooterra:coord_bravo",
        status: "active",
        rotatedAt: "2026-01-01T00:00:10.000Z"
      }
    })
  });
  try {
    const api = createApi();
    api.store.publicKeyByKeyId.set(keyId, publicKeyPem);

    const historicalPayload = signFederationEnvelope(
      {
        ...invokeEnvelope({
          invocationId: "inv_trust_rotation_historical_1",
          originDid: "did:nooterra:coord_bravo",
          targetDid: "did:nooterra:coord_alpha"
        }),
        signedAt: "2026-01-01T00:00:05.000Z"
      },
      { keyId, privateKeyPem }
    );
    const historicalAccepted = await request(api, {
      method: "POST",
      path: "/v1/federation/invoke",
      body: historicalPayload,
      auth: "none"
    });
    assert.equal(historicalAccepted.statusCode, 202);

    const rotatedPayload = signFederationEnvelope(
      {
        ...invokeEnvelope({
          invocationId: "inv_trust_rotation_blocked_1",
          originDid: "did:nooterra:coord_bravo",
          targetDid: "did:nooterra:coord_alpha"
        }),
        signedAt: "2026-01-01T00:00:20.000Z"
      },
      { keyId, privateKeyPem }
    );
    const rotatedDenied = await request(api, {
      method: "POST",
      path: "/v1/federation/invoke",
      body: rotatedPayload,
      auth: "none"
    });
    assert.equal(rotatedDenied.statusCode, 403);
    assert.equal(rotatedDenied.json?.details?.reason, "trust_anchor_rotated");
    assert.equal(rotatedDenied.json?.details?.reasonCode, "FEDERATION_TRUST_ANCHOR_ROTATED");
  } finally {
    restore();
  }
});

test("api federation proxy: trust propagation stale and trust version mismatch fail closed with reason codes", async () => {
  const { publicKeyPem, privateKeyPem } = createEd25519Keypair();
  const keyId = keyIdFromPublicKeyPem(publicKeyPem);
  const restore = withEnvMap({
    COORDINATOR_DID: "did:nooterra:coord_alpha",
    PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS: "did:nooterra:coord_bravo",
    PROXY_FEDERATION_TRUST_REGISTRY_STRICT: "true",
    PROXY_FEDERATION_TRUST_REGISTRY: JSON.stringify({
      [keyId]: {
        coordinatorDid: "did:nooterra:coord_bravo",
        status: "active",
        version: 3,
        propagatedAt: "2026-01-01T00:00:10.000Z"
      }
    })
  });
  try {
    const staleApi = createApi({
      now: () => "2026-01-01T00:00:05.000Z"
    });
    staleApi.store.publicKeyByKeyId.set(keyId, publicKeyPem);

    const stalePayload = signFederationEnvelope(
      invokeEnvelope({
        invocationId: "inv_trust_stale_1",
        originDid: "did:nooterra:coord_bravo",
        targetDid: "did:nooterra:coord_alpha"
      }),
      { keyId, privateKeyPem }
    );
    const staleDenied = await request(staleApi, {
      method: "POST",
      path: "/v1/federation/invoke",
      body: stalePayload,
      auth: "none"
    });
    assert.equal(staleDenied.statusCode, 403);
    assert.equal(staleDenied.json?.details?.reason, "trust_anchor_stale");
    assert.equal(staleDenied.json?.details?.reasonCode, "FEDERATION_TRUST_ANCHOR_STALE");

    const versionApi = createApi({
      now: () => "2026-01-01T00:00:20.000Z"
    });
    versionApi.store.publicKeyByKeyId.set(keyId, publicKeyPem);
    const versionMismatchPayload = signFederationEnvelope(
      {
        ...invokeEnvelope({
          invocationId: "inv_trust_version_mismatch_1",
          originDid: "did:nooterra:coord_bravo",
          targetDid: "did:nooterra:coord_alpha"
        }),
        trust: {
          anchorVersion: 2
        }
      },
      { keyId, privateKeyPem }
    );
    const versionDenied = await request(versionApi, {
      method: "POST",
      path: "/v1/federation/invoke",
      body: versionMismatchPayload,
      auth: "none"
    });
    assert.equal(versionDenied.statusCode, 403);
    assert.equal(versionDenied.json?.details?.reason, "trust_anchor_version_mismatch");
    assert.equal(versionDenied.json?.details?.reasonCode, "FEDERATION_TRUST_ANCHOR_VERSION_MISMATCH");
  } finally {
    restore();
  }
});

test("api federation proxy: trust metadata version fields remain compatible across consumer versions", async () => {
  const { publicKeyPem, privateKeyPem } = createEd25519Keypair();
  const keyId = keyIdFromPublicKeyPem(publicKeyPem);
  const restore = withEnvMap({
    COORDINATOR_DID: "did:nooterra:coord_alpha",
    PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS: "did:nooterra:coord_bravo",
    PROXY_FEDERATION_TRUST_REGISTRY_STRICT: "true",
    PROXY_FEDERATION_TRUST_REGISTRY: JSON.stringify({
      [keyId]: {
        coordinatorDid: "did:nooterra:coord_bravo",
        status: "active",
        version: 4
      }
    })
  });
  try {
    const api = createApi();
    api.store.publicKeyByKeyId.set(keyId, publicKeyPem);

    const legacyFieldPayload = signFederationEnvelope(
      {
        ...invokeEnvelope({
          invocationId: "inv_trust_version_legacy_ok_1",
          originDid: "did:nooterra:coord_bravo",
          targetDid: "did:nooterra:coord_alpha"
        }),
        trustAnchorVersion: 4
      },
      { keyId, privateKeyPem }
    );
    const legacyAccepted = await request(api, {
      method: "POST",
      path: "/v1/federation/invoke",
      body: legacyFieldPayload,
      auth: "none"
    });
    assert.equal(legacyAccepted.statusCode, 202);

    const modernFieldPayload = signFederationEnvelope(
      {
        ...invokeEnvelope({
          invocationId: "inv_trust_version_modern_ok_1",
          originDid: "did:nooterra:coord_bravo",
          targetDid: "did:nooterra:coord_alpha"
        }),
        trust: { anchorVersion: 4 }
      },
      { keyId, privateKeyPem }
    );
    const modernAccepted = await request(api, {
      method: "POST",
      path: "/v1/federation/invoke",
      body: modernFieldPayload,
      auth: "none"
    });
    assert.equal(modernAccepted.statusCode, 202);

    const invalidVersionPayload = signFederationEnvelope(
      {
        ...invokeEnvelope({
          invocationId: "inv_trust_version_invalid_1",
          originDid: "did:nooterra:coord_bravo",
          targetDid: "did:nooterra:coord_alpha"
        }),
        trustAnchorVersion: "not-an-integer"
      },
      { keyId, privateKeyPem }
    );
    const invalidDenied = await request(api, {
      method: "POST",
      path: "/v1/federation/invoke",
      body: invalidVersionPayload,
      auth: "none"
    });
    assert.equal(invalidDenied.statusCode, 403);
    assert.equal(invalidDenied.json?.details?.reason, "trust_anchor_version_invalid");
    assert.equal(invalidDenied.json?.details?.reasonCode, "FEDERATION_TRUST_ANCHOR_VERSION_INVALID");
  } finally {
    restore();
  }
});

test("api federation proxy: incoming invoke enqueues locally with deterministic replay", async () => {
  const restore = withEnvMap({
    COORDINATOR_DID: "did:nooterra:coord_alpha",
    PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS: "did:nooterra:coord_bravo"
  });
  try {
    const api = createApi();
    const payload = invokeEnvelope({
      invocationId: "inv_incoming_queued_1",
      originDid: "did:nooterra:coord_bravo",
      targetDid: "did:nooterra:coord_alpha"
    });
    const first = await request(api, {
      method: "POST",
      path: "/v1/federation/invoke",
      body: payload,
      auth: "none"
    });
    const second = await request(api, {
      method: "POST",
      path: "/v1/federation/invoke",
      body: payload,
      auth: "none"
    });

    assert.equal(first.statusCode, 202);
    assert.equal(first.json?.ok, true);
    assert.equal(first.json?.invocationId, "inv_incoming_queued_1");
    assert.equal(first.json?.status, "queued");
    assert.equal(typeof first.json?.queuedAt, "string");
    assert.equal(second.statusCode, 202);
    assert.equal(second.headers?.get?.("x-federation-replay"), "duplicate");
    assert.equal(second.json?.invocationId, "inv_incoming_queued_1");
    assert.equal(second.json?.status, "queued");
    assert.equal(second.json?.queuedAt, first.json?.queuedAt);
  } finally {
    restore();
  }
});

test("api federation proxy: incoming result ingests once with deterministic replay", async () => {
  const restore = withEnvMap({
    COORDINATOR_DID: "did:nooterra:coord_alpha",
    PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS: "did:nooterra:coord_bravo"
  });
  try {
    const api = createApi();
    const payload = resultEnvelope({
      invocationId: "inv_incoming_result_1",
      originDid: "did:nooterra:coord_bravo",
      targetDid: "did:nooterra:coord_alpha"
    });
    const first = await request(api, {
      method: "POST",
      path: "/v1/federation/result",
      body: payload,
      auth: "none"
    });
    const second = await request(api, {
      method: "POST",
      path: "/v1/federation/result",
      body: payload,
      auth: "none"
    });
    const conflict = await request(api, {
      method: "POST",
      path: "/v1/federation/result",
      body: {
        ...payload,
        result: { ok: false, changed: true }
      },
      auth: "none"
    });

    assert.equal(first.statusCode, 200);
    assert.equal(first.json?.ok, true);
    assert.equal(first.json?.invocationId, "inv_incoming_result_1");
    assert.equal(first.json?.status, "success");
    assert.equal(typeof first.json?.receiptId, "string");
    assert.equal(typeof first.json?.acceptedAt, "string");
    assert.equal(typeof first.json?.evidenceRefsHash, "string");
    assert.equal(typeof first.json?.resultPayloadHash, "string");
    assert.equal(first.json?.settlementApplied, true);
    assert.equal(typeof first.json?.settlementLedgerEntryId, "string");
    assert.equal(typeof first.json?.settlementPayloadHash, "string");
    assert.equal(typeof first.json?.settlementBindingHash, "string");
    assert.equal(typeof first.json?.settledAt, "string");
    assert.equal(second.statusCode, 200);
    assert.equal(second.headers?.get?.("x-federation-replay"), "duplicate");
    assert.equal(second.json?.receiptId, first.json?.receiptId);
    assert.equal(second.json?.acceptedAt, first.json?.acceptedAt);
    assert.equal(second.json?.evidenceRefsHash, first.json?.evidenceRefsHash);
    assert.equal(second.json?.resultPayloadHash, first.json?.resultPayloadHash);
    assert.equal(second.json?.settlementLedgerEntryId, first.json?.settlementLedgerEntryId);
    assert.equal(second.json?.settlementPayloadHash, first.json?.settlementPayloadHash);
    assert.equal(second.json?.settlementBindingHash, first.json?.settlementBindingHash);
    assert.equal(second.json?.settledAt, first.json?.settledAt);
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.json?.code, "FEDERATION_ENVELOPE_CONFLICT");
  } finally {
    restore();
  }
});

test("api federation proxy: routes by namespace DID with explicit route map", async () => {
  const callsA = [];
  const callsB = [];
  const upstreamA = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      callsA.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
      res.statusCode = 201;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: true, route: "A" }));
    });
  });
  const upstreamB = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      callsB.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
      res.statusCode = 202;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: true, route: "B" }));
    });
  });

  const baseUrlA = await listen(upstreamA);
  const baseUrlB = await listen(upstreamB);

  const restore = withEnvMap({
    COORDINATOR_DID: "did:nooterra:coord_alpha",
    PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS: "did:nooterra:coord_bravo,did:nooterra:coord_charlie",
    PROXY_FEDERATION_NAMESPACE_ROUTES: JSON.stringify({
      "did:nooterra:coord_bravo": baseUrlA,
      "did:nooterra:coord_charlie": baseUrlB
    })
  });

  try {
    const api = createApi();

    const toBravo = await request(api, {
      method: "POST",
      path: "/v1/federation/invoke",
      body: invokeEnvelope({ invocationId: "inv_route_1", targetDid: "did:nooterra:coord_bravo" }),
      auth: "none"
    });
    const toCharlie = await request(api, {
      method: "POST",
      path: "/v1/federation/invoke",
      body: invokeEnvelope({ invocationId: "inv_route_2", targetDid: "did:nooterra:coord_charlie" }),
      auth: "none"
    });

    assert.equal(toBravo.statusCode, 201);
    assert.equal(toCharlie.statusCode, 202);
    assert.equal(callsA.length, 1);
    assert.equal(callsB.length, 1);
    assert.equal(callsA[0].headers["x-federation-namespace-did"], "did:nooterra:coord_bravo");
    assert.equal(callsB[0].headers["x-federation-namespace-did"], "did:nooterra:coord_charlie");
  } finally {
    restore();
    await new Promise((resolve) => upstreamA.close(resolve));
    await new Promise((resolve) => upstreamB.close(resolve));
  }
});

test("api federation proxy: deterministic replay returns stored response without second upstream call", async () => {
  const calls = [];
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      calls.push({ url: req.url, body: Buffer.concat(chunks).toString("utf8") });
      res.statusCode = 201;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: true, upstream: "federation", call: calls.length }));
    });
  });

  const baseUrl = await listen(upstream);
  const restore = withEnvMap({
    FEDERATION_PROXY_BASE_URL: baseUrl,
    COORDINATOR_DID: "did:nooterra:coord_alpha",
    PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS: "did:nooterra:coord_bravo"
  });

  try {
    const api = createApi();
    const payload = invokeEnvelope({ invocationId: "inv_replay_1" });

    const first = await request(api, {
      method: "POST",
      path: "/v1/federation/invoke",
      body: payload,
      auth: "none"
    });
    const second = await request(api, {
      method: "POST",
      path: "/v1/federation/invoke",
      body: payload,
      auth: "none"
    });

    assert.equal(first.statusCode, 201);
    assert.equal(second.statusCode, 201);
    assert.equal(second.json?.call, 1);
    assert.equal(second.headers?.get?.("x-federation-replay"), "duplicate");
    assert.equal(calls.length, 1);
  } finally {
    restore();
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test("api federation proxy: conflict on same invocation identity with different payload hash", async () => {
  const calls = [];
  const upstream = http.createServer((req, res) => {
    req.resume();
    calls.push(req.url);
    res.statusCode = 201;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: true }));
  });

  const baseUrl = await listen(upstream);
  const restore = withEnvMap({
    FEDERATION_PROXY_BASE_URL: baseUrl,
    COORDINATOR_DID: "did:nooterra:coord_alpha",
    PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS: "did:nooterra:coord_bravo"
  });

  try {
    const api = createApi();

    const first = await request(api, {
      method: "POST",
      path: "/v1/federation/invoke",
      body: invokeEnvelope({ invocationId: "inv_conflict_1", capabilityId: "capability.dispatch.v1" }),
      auth: "none"
    });

    const second = await request(api, {
      method: "POST",
      path: "/v1/federation/invoke",
      body: {
        ...invokeEnvelope({ invocationId: "inv_conflict_1", capabilityId: "capability.dispatch.v1" }),
        payload: { op: "different" }
      },
      auth: "none"
    });

    assert.equal(first.statusCode, 201);
    assert.equal(second.statusCode, 409);
    assert.equal(second.json?.code, "FEDERATION_ENVELOPE_CONFLICT");
    assert.equal(Array.isArray(second.json?.details?.requestSha256Values), true);
    assert.equal(second.json.details.requestSha256Values.length, 2);
    assert.equal(calls.length, 1);
  } finally {
    restore();
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test("api federation proxy: fails closed when upstream attempts redirect", async () => {
  let redirectedHitCount = 0;
  const redirectedTarget = http.createServer((req, res) => {
    redirectedHitCount += 1;
    res.statusCode = 200;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: true, source: "redirect-target" }));
  });
  const redirectingUpstream = http.createServer((req, res) => {
    res.statusCode = 307;
    res.setHeader("location", `${redirectedTargetBaseUrl}/capture`);
    res.end();
  });

  const redirectedTargetBaseUrl = await listen(redirectedTarget);
  const redirectingBaseUrl = await listen(redirectingUpstream);
  const restore = withEnvMap({
    FEDERATION_PROXY_BASE_URL: redirectingBaseUrl,
    COORDINATOR_DID: "did:nooterra:coord_alpha",
    PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS: "did:nooterra:coord_bravo"
  });
  try {
    const api = createApi();
    const res = await request(api, {
      method: "POST",
      path: "/v1/federation/invoke",
      body: invokeEnvelope({ invocationId: "inv_redirect_1" }),
      auth: "none"
    });

    assert.equal(res.statusCode, 502);
    assert.equal(res.json?.code, "FEDERATION_UPSTREAM_UNREACHABLE");
    assert.equal(redirectedHitCount, 0);
  } finally {
    restore();
    await new Promise((resolve) => redirectingUpstream.close(resolve));
    await new Promise((resolve) => redirectedTarget.close(resolve));
  }
});

test("api federation proxy: internal federation stats reports per-pair and status aggregates", async () => {
  const upstream = http.createServer((req, res) => {
    req.resume();
    res.statusCode = 201;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: true }));
  });
  const baseUrl = await listen(upstream);
  const restore = withEnvMap({
    FEDERATION_PROXY_BASE_URL: baseUrl,
    COORDINATOR_DID: "did:nooterra:coord_alpha",
    PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS: "did:nooterra:coord_bravo"
  });
  try {
    const api = createApi();
    const envelope = invokeEnvelope({ invocationId: "inv_stats_1" });

    const first = await request(api, {
      method: "POST",
      path: "/v1/federation/invoke",
      body: envelope,
      auth: "none"
    });
    const duplicate = await request(api, {
      method: "POST",
      path: "/v1/federation/invoke",
      body: envelope,
      auth: "none"
    });
    const conflict = await request(api, {
      method: "POST",
      path: "/v1/federation/invoke",
      body: {
        ...envelope,
        payload: { op: "different" }
      },
      auth: "none"
    });
    const stats = await request(api, {
      method: "GET",
      path: "/internal/federation/stats"
    });

    assert.equal(first.statusCode, 201);
    assert.equal(duplicate.statusCode, 201);
    assert.equal(conflict.statusCode, 409);
    assert.equal(stats.statusCode, 200);
    assert.equal(stats.json?.ok, true);
    assert.equal(stats.json?.stats?.schemaVersion, "FederationStats.v1");
    assert.equal(stats.json?.stats?.totals?.requestCount, 3);
    assert.equal(stats.json?.stats?.totals?.invokeCount, 3);
    assert.equal(stats.json?.stats?.totals?.resultCount, 0);
    assert.deepEqual(stats.json?.stats?.totals?.statusCounts, {
      replay_conflict: 1,
      replay_duplicate: 1,
      upstream_201: 1
    });
    assert.deepEqual(stats.json?.ingress?.trust, {
      schemaVersion: "FederationTrustRegistrySnapshot.v1",
      strictMode: false,
      anchorCount: 0,
      staleAnchorCount: 0,
      statusCounts: {}
    });
    assert.deepEqual(stats.json?.stats?.pairs, [
      {
        originDid: "did:nooterra:coord_alpha",
        targetDid: "did:nooterra:coord_bravo",
        requestCount: 3,
        invokeCount: 3,
        resultCount: 0,
        statusCounts: {
          replay_conflict: 1,
          replay_duplicate: 1,
          upstream_201: 1
        }
      }
    ]);
  } finally {
    restore();
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test("api federation proxy: internal federation stats exposes auditable trust propagation status", async () => {
  const { publicKeyPem } = createEd25519Keypair();
  const keyId = keyIdFromPublicKeyPem(publicKeyPem);
  const restore = withEnvMap({
    COORDINATOR_DID: "did:nooterra:coord_alpha",
    PROXY_FEDERATION_TRUST_REGISTRY_STRICT: "true",
    PROXY_FEDERATION_TRUST_REGISTRY: JSON.stringify({
      [keyId]: {
        coordinatorDid: "did:nooterra:coord_bravo",
        status: "active"
      },
      key_stale_1: {
        coordinatorDid: "did:nooterra:coord_charlie",
        status: "rotated",
        propagatedAt: "2026-01-01T00:01:00.000Z"
      },
      key_revoked_1: {
        coordinatorDid: "did:nooterra:coord_delta",
        status: "revoked"
      }
    })
  });
  try {
    const api = createApi({
      now: () => "2026-01-01T00:00:00.000Z"
    });
    const stats = await request(api, {
      method: "GET",
      path: "/internal/federation/stats"
    });
    assert.equal(stats.statusCode, 200);
    assert.deepEqual(stats.json?.ingress?.trust, {
      schemaVersion: "FederationTrustRegistrySnapshot.v1",
      strictMode: true,
      anchorCount: 3,
      staleAnchorCount: 1,
      statusCounts: {
        active: 1,
        revoked: 1,
        rotated: 1
      }
    });
  } finally {
    restore();
  }
});

test("api federation proxy: retries retryable upstream responses and records completed replay terminal", async () => {
  let callCount = 0;
  const upstream = http.createServer((req, res) => {
    req.resume();
    callCount += 1;
    if (callCount === 1) {
      res.statusCode = 503;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: false, transient: true }));
      return;
    }
    res.statusCode = 201;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: true, callCount }));
  });
  const baseUrl = await listen(upstream);
  const restore = withEnvMap({
    FEDERATION_PROXY_BASE_URL: baseUrl,
    COORDINATOR_DID: "did:nooterra:coord_alpha",
    PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS: "did:nooterra:coord_bravo"
  });
  try {
    const api = createApi({
      federationForwardMaxAttempts: 2,
      federationForwardRetryBaseMs: 1,
      federationForwardRetryMaxMs: 1
    });
    const invocationId = "inv_retryable_forward_1";
    const invoke = await request(api, {
      method: "POST",
      path: "/v1/federation/invoke",
      body: invokeEnvelope({ invocationId }),
      auth: "none"
    });
    assert.equal(invoke.statusCode, 201);
    assert.equal(callCount, 2);

    const replay = await request(api, {
      method: "GET",
      path: `/internal/federation/invocations/replay?invocationId=${encodeURIComponent(invocationId)}&originDid=${encodeURIComponent("did:nooterra:coord_alpha")}&targetDid=${encodeURIComponent("did:nooterra:coord_bravo")}`
    });
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.json?.ok, true);
    assert.equal(replay.json?.replayPack?.schemaVersion, "FederationInvocationReplayPack.v1");
    assert.equal(replay.json?.replayPack?.terminal?.state, "completed");
    assert.equal(replay.json?.replayPack?.terminal?.attempts, 2);
    const statuses = Array.isArray(replay.json?.replayPack?.events) ? replay.json.replayPack.events.map((event) => event.status) : [];
    assert.ok(statuses.includes("upstream_503"));
    assert.ok(statuses.includes("upstream_201"));
  } finally {
    restore();
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test("api federation proxy: timeout retries fail closed and replay terminal is timeout", async () => {
  let callCount = 0;
  const upstream = http.createServer((req, res) => {
    req.resume();
    callCount += 1;
    setTimeout(() => {
      res.statusCode = 201;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: true, delayed: true }));
    }, 120);
  });
  const baseUrl = await listen(upstream);
  const restore = withEnvMap({
    FEDERATION_PROXY_BASE_URL: baseUrl,
    COORDINATOR_DID: "did:nooterra:coord_alpha",
    PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS: "did:nooterra:coord_bravo"
  });
  try {
    const api = createApi({
      federationForwardMaxAttempts: 2,
      federationForwardTimeoutMs: 25,
      federationForwardRetryBaseMs: 1,
      federationForwardRetryMaxMs: 1
    });
    const invocationId = "inv_retry_timeout_1";
    const invoke = await request(api, {
      method: "POST",
      path: "/v1/federation/invoke",
      body: invokeEnvelope({ invocationId }),
      auth: "none"
    });
    assert.equal(invoke.statusCode, 502);
    assert.equal(invoke.json?.code, "FEDERATION_UPSTREAM_UNREACHABLE");
    assert.equal(invoke.json?.details?.timeout, true);
    assert.ok(callCount >= 2);

    const replay = await request(api, {
      method: "GET",
      path: `/internal/federation/invocations/replay?invocationId=${encodeURIComponent(invocationId)}&originDid=${encodeURIComponent("did:nooterra:coord_alpha")}&targetDid=${encodeURIComponent("did:nooterra:coord_bravo")}`
    });
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.json?.replayPack?.terminal?.state, "timeout");
    assert.equal(replay.json?.replayPack?.terminal?.attempts, 2);
  } finally {
    restore();
    await new Promise((resolve) => upstream.close(resolve));
  }
});
