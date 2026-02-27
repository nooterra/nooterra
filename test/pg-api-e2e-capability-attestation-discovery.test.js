import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createPgStore } from "../src/db/store-pg.js";
import { createEd25519Keypair } from "../src/core/crypto.js";
import { request } from "./api-test-harness.js";

const databaseUrl = process.env.DATABASE_URL ?? null;

function makeSchema() {
  return `t_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function tenantRequest(api, { tenantId, method, path, headers = null, body = undefined, auth = "auto" }) {
  return request(api, {
    method,
    path,
    headers: {
      "x-proxy-tenant-id": tenantId,
      ...(headers ?? {})
    },
    body,
    auth
  });
}

async function registerAgent(api, { tenantId, agentId, capabilities = [] }) {
  const { publicKeyPem } = createEd25519Keypair();
  const response = await tenantRequest(api, {
    tenantId,
    method: "POST",
    path: "/agents/register",
    headers: { "x-idempotency-key": `pg_capatt_register_${agentId}` },
    body: {
      agentId,
      displayName: `Agent ${agentId}`,
      owner: { ownerType: "service", ownerId: `svc_${tenantId}` },
      publicKeyPem,
      capabilities
    }
  });
  assert.equal(response.statusCode, 201, response.body);
}

async function upsertAgentCard(api, { tenantId, agentId, idempotencyKey }) {
  const response = await tenantRequest(api, {
    tenantId,
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": idempotencyKey },
    body: {
      agentId,
      displayName: `Card ${agentId}`,
      capabilities: ["travel.booking"],
      visibility: "public",
      host: {
        runtime: "openclaw",
        endpoint: `https://example.test/${agentId}`,
        protocols: ["mcp", "http"]
      }
    }
  });
  assert.equal(response.statusCode, 201, response.body);
}

(databaseUrl ? test : test.skip)(
  "pg api e2e: capability-attestation discovery excludes missing and revoked candidates deterministically",
  async () => {
    const schema = makeSchema();
    const tenantId = "tenant_pg_capatt_discovery_1";
    const attestedAgentId = "agt_pg_attested_travel_1";
    const plainAgentId = "agt_pg_plain_travel_1";
    const issuerAgentId = "agt_pg_issuer_1";

    const store = await createPgStore({ databaseUrl, schema, dropSchemaOnClose: true });
    try {
      const api = createApi({ store });

      await registerAgent(api, {
        tenantId,
        agentId: attestedAgentId,
        capabilities: ["travel.booking"]
      });
      await registerAgent(api, {
        tenantId,
        agentId: plainAgentId,
        capabilities: ["travel.booking"]
      });
      await registerAgent(api, {
        tenantId,
        agentId: issuerAgentId,
        capabilities: ["attestation.issue"]
      });

      await upsertAgentCard(api, {
        tenantId,
        agentId: attestedAgentId,
        idempotencyKey: "pg_capatt_card_attested_1"
      });
      await upsertAgentCard(api, {
        tenantId,
        agentId: plainAgentId,
        idempotencyKey: "pg_capatt_card_plain_1"
      });

      const created = await tenantRequest(api, {
        tenantId,
        method: "POST",
        path: "/capability-attestations",
        headers: { "x-idempotency-key": "pg_capatt_issue_1" },
        body: {
          attestationId: "pg_catt_travel_1",
          subjectAgentId: attestedAgentId,
          capability: "travel.booking",
          level: "attested",
          issuerAgentId,
          validity: {
            issuedAt: "2026-02-23T00:00:00.000Z",
            notBefore: "2026-02-23T00:00:00.000Z",
            expiresAt: "2027-02-23T00:00:00.000Z"
          },
          signature: {
            keyId: `key_${issuerAgentId}`,
            signature: "sig_pg_catt_travel_1"
          },
          verificationMethod: {
            mode: "attested",
            source: "issuer_registry"
          },
          evidenceRefs: ["artifact://attestation/proof/pg/1"]
        }
      });
      assert.equal(created.statusCode, 201, created.body);
      assert.equal(created.json?.runtime?.status, "valid");

      const discoverRequireAttestation = await tenantRequest(api, {
        tenantId,
        method: "GET",
        path:
          "/agent-cards/discover?capability=travel.booking&visibility=public&runtime=openclaw&status=active&includeReputation=false" +
          `&requireCapabilityAttestation=true&attestationMinLevel=attested&attestationIssuerAgentId=${encodeURIComponent(issuerAgentId)}` +
          "&includeAttestationMetadata=true&limit=10&offset=0"
      });
      assert.equal(discoverRequireAttestation.statusCode, 200, discoverRequireAttestation.body);
      assert.equal(discoverRequireAttestation.json?.results?.length, 1);
      assert.equal(discoverRequireAttestation.json?.results?.[0]?.agentCard?.agentId, attestedAgentId);
      assert.equal(
        discoverRequireAttestation.json?.excludedAttestationCandidates?.some(
          (entry) => entry.agentId === plainAgentId && entry.reasonCode === "CAPABILITY_ATTESTATION_MISSING"
        ),
        true
      );

      const revoked = await tenantRequest(api, {
        tenantId,
        method: "POST",
        path: "/capability-attestations/pg_catt_travel_1/revoke",
        headers: { "x-idempotency-key": "pg_capatt_revoke_1" },
        body: {
          revokedAt: "2026-02-24T00:00:00.000Z",
          reasonCode: "MANUAL_REVOKE"
        }
      });
      assert.equal(revoked.statusCode, 200, revoked.body);
      assert.equal(revoked.json?.runtime?.status, "revoked");

      const discoverAfterRevoke = await tenantRequest(api, {
        tenantId,
        method: "GET",
        path:
          "/agent-cards/discover?capability=travel.booking&visibility=public&runtime=openclaw&status=active&includeReputation=false" +
          `&requireCapabilityAttestation=true&attestationMinLevel=attested&attestationIssuerAgentId=${encodeURIComponent(issuerAgentId)}` +
          "&includeAttestationMetadata=true&limit=10&offset=0"
      });
      assert.equal(discoverAfterRevoke.statusCode, 200, discoverAfterRevoke.body);
      assert.equal(discoverAfterRevoke.json?.results?.length, 0);
      const excluded = discoverAfterRevoke.json?.excludedAttestationCandidates ?? [];
      assert.equal(
        excluded.some((entry) => entry.agentId === attestedAgentId && entry.reasonCode === "CAPABILITY_ATTESTATION_REVOKED"),
        true
      );
      assert.equal(
        excluded.some((entry) => entry.agentId === plainAgentId && entry.reasonCode === "CAPABILITY_ATTESTATION_MISSING"),
        true
      );
    } finally {
      await store.close();
    }
  }
);
