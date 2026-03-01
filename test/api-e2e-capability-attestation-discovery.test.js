import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createStore } from "../src/api/store.js";
import { createEd25519Keypair } from "../src/core/crypto.js";
import { request } from "./api-test-harness.js";

const CAPABILITY_NAMESPACE_ERROR_PATTERN = Object.freeze({
  scheme: /(CAPABILITY_[A-Z0-9_]*SCHEME[A-Z0-9_]*|scheme)/i,
  format: /(CAPABILITY_[A-Z0-9_]*(FORMAT|NAMESPACE)[A-Z0-9_]*|format|lowercase|namespace)/i,
  reserved: /(CAPABILITY_[A-Z0-9_]*RESERVED[A-Z0-9_]*|reserved)/i,
  segmentLength: /(CAPABILITY_[A-Z0-9_]*(SEGMENT|LENGTH)[A-Z0-9_]*|segment|length)/i
});

async function registerAgent(api, { agentId, capabilities = [] }) {
  const { publicKeyPem } = createEd25519Keypair();
  const response = await request(api, {
    method: "POST",
    path: "/agents/register",
    headers: { "x-idempotency-key": `agent_register_${agentId}` },
    body: {
      agentId,
      displayName: `Agent ${agentId}`,
      owner: { ownerType: "service", ownerId: "svc_test" },
      publicKeyPem,
      capabilities
    }
  });
  assert.equal(response.statusCode, 201, response.body);
}

function assertCapabilityNamespaceErrorResponse(response, expectedPattern) {
  assert.equal(response.statusCode, 400, response.body);
  assert.equal(response.json?.code, "SCHEMA_INVALID");
  assert.match(String(response.json?.details?.message ?? ""), expectedPattern);
}

async function upsertAgentCard(api, { agentId, runtime = "openclaw", capability = "travel.booking", idem }) {
  const response = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": idem },
    body: {
      agentId,
      displayName: `Card ${agentId}`,
      capabilities: [capability],
      visibility: "public",
      host: {
        runtime,
        endpoint: `https://example.test/${agentId}`,
        protocols: ["mcp", "http"]
      }
    }
  });
  assert.equal(response.statusCode, 201, response.body);
}

test("API e2e: capability attestation registry + discovery filter with exclusion reasons", async () => {
  const api = createApi({ opsToken: "tok_ops" });

  const attestedAgentId = "agt_attested_travel_1";
  const plainAgentId = "agt_plain_travel_1";
  const issuerAgentId = "agt_issuer_1";

  await registerAgent(api, {
    agentId: attestedAgentId,
    capabilities: ["travel.booking"]
  });
  await registerAgent(api, {
    agentId: plainAgentId,
    capabilities: ["travel.booking"]
  });
  await registerAgent(api, {
    agentId: issuerAgentId,
    capabilities: ["attestation.issue"]
  });

  await upsertAgentCard(api, { agentId: attestedAgentId, idem: "agent_card_upsert_attested_1" });
  await upsertAgentCard(api, { agentId: plainAgentId, idem: "agent_card_upsert_plain_1" });

  const createdAttestation = await request(api, {
    method: "POST",
    path: "/capability-attestations",
    headers: { "x-idempotency-key": "capability_attest_issue_1" },
    body: {
      attestationId: "catt_travel_1",
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
        signature: "sig_attested_travel_1"
      },
      verificationMethod: {
        mode: "attested",
        source: "issuer_registry"
      },
      evidenceRefs: ["artifact://attestation/proof/1"]
    }
  });
  assert.equal(createdAttestation.statusCode, 201, createdAttestation.body);
  assert.equal(createdAttestation.json?.capabilityAttestation?.attestationId, "catt_travel_1");
  assert.equal(createdAttestation.json?.runtime?.status, "valid");

  const listedValid = await request(api, {
    method: "GET",
    path: `/capability-attestations?subjectAgentId=${encodeURIComponent(attestedAgentId)}&capability=travel.booking&status=valid&limit=10&offset=0`
  });
  assert.equal(listedValid.statusCode, 200, listedValid.body);
  assert.equal(listedValid.json?.attestations?.length, 1);

  const discoverNoFilter = await request(api, {
    method: "GET",
    path: "/agent-cards/discover?capability=travel.booking&visibility=public&runtime=openclaw&status=active&includeReputation=false&limit=10&offset=0"
  });
  assert.equal(discoverNoFilter.statusCode, 200, discoverNoFilter.body);
  assert.equal(discoverNoFilter.json?.results?.length, 2);

  const discoverRequireAttestation = await request(api, {
    method: "GET",
    path:
      `/agent-cards/discover?capability=travel.booking&visibility=public&runtime=openclaw&status=active&includeReputation=false` +
      `&requireCapabilityAttestation=true&attestationMinLevel=attested&attestationIssuerAgentId=${encodeURIComponent(issuerAgentId)}` +
      `&includeAttestationMetadata=true&limit=10&offset=0`
  });
  assert.equal(discoverRequireAttestation.statusCode, 200, discoverRequireAttestation.body);
  assert.equal(discoverRequireAttestation.json?.results?.length, 1);
  assert.equal(discoverRequireAttestation.json?.results?.[0]?.agentCard?.agentId, attestedAgentId);
  assert.equal(discoverRequireAttestation.json?.results?.[0]?.capabilityAttestation?.attestationId, "catt_travel_1");
  const excludedAfterRequire = discoverRequireAttestation.json?.excludedAttestationCandidates ?? [];
  assert.equal(Array.isArray(excludedAfterRequire), true);
  assert.equal(excludedAfterRequire.some((entry) => entry.agentId === plainAgentId && entry.reasonCode === "CAPABILITY_ATTESTATION_MISSING"), true);

  const revoked = await request(api, {
    method: "POST",
    path: "/capability-attestations/catt_travel_1/revoke",
    headers: { "x-idempotency-key": "capability_attest_revoke_1" },
    body: {
      revokedAt: "2026-02-24T00:00:00.000Z",
      reasonCode: "MANUAL_REVOKE"
    }
  });
  assert.equal(revoked.statusCode, 200, revoked.body);
  assert.equal(revoked.json?.runtime?.status, "revoked");

  const discoverAfterRevoke = await request(api, {
    method: "GET",
    path:
      `/agent-cards/discover?capability=travel.booking&visibility=public&runtime=openclaw&status=active&includeReputation=false` +
      `&requireCapabilityAttestation=true&attestationMinLevel=attested&attestationIssuerAgentId=${encodeURIComponent(issuerAgentId)}` +
      `&includeAttestationMetadata=true&limit=10&offset=0`
  });
  assert.equal(discoverAfterRevoke.statusCode, 200, discoverAfterRevoke.body);
  assert.equal(discoverAfterRevoke.json?.results?.length, 0);
  const excludedAfterRevoke = discoverAfterRevoke.json?.excludedAttestationCandidates ?? [];
  assert.equal(excludedAfterRevoke.some((entry) => entry.agentId === attestedAgentId && entry.reasonCode === "CAPABILITY_ATTESTATION_REVOKED"), true);
  assert.equal(excludedAfterRevoke.some((entry) => entry.agentId === plainAgentId && entry.reasonCode === "CAPABILITY_ATTESTATION_MISSING"), true);
});

test("API e2e: capability attestation accepts legacy + capability URI forms", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  const subjectAgentId = "agt_cap_ns_subject_1";
  const issuerAgentId = "agt_cap_ns_issuer_1";

  await registerAgent(api, {
    agentId: subjectAgentId,
    capabilities: ["travel.booking", "capability://travel.booking", "capability://travel.booking@v2"]
  });
  await registerAgent(api, {
    agentId: issuerAgentId,
    capabilities: ["attestation.issue"]
  });

  const legacy = await request(api, {
    method: "POST",
    path: "/capability-attestations",
    headers: { "x-idempotency-key": "capability_attest_cap_ns_legacy_1" },
    body: {
      attestationId: "catt_cap_ns_legacy_1",
      subjectAgentId,
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
        signature: "sig_cap_ns_legacy_1"
      }
    }
  });
  assert.equal(legacy.statusCode, 201, legacy.body);
  assert.equal(legacy.json?.capabilityAttestation?.capability, "travel.booking");

  const uriVersioned = await request(api, {
    method: "POST",
    path: "/capability-attestations",
    headers: { "x-idempotency-key": "capability_attest_cap_ns_uri_1" },
    body: {
      attestationId: "catt_cap_ns_uri_1",
      subjectAgentId,
      capability: "capability://travel.booking@v2",
      level: "attested",
      issuerAgentId,
      validity: {
        issuedAt: "2026-02-23T00:00:00.000Z",
        notBefore: "2026-02-23T00:00:00.000Z",
        expiresAt: "2027-02-23T00:00:00.000Z"
      },
      signature: {
        keyId: `key_${issuerAgentId}`,
        signature: "sig_cap_ns_uri_1"
      }
    }
  });
  assert.equal(uriVersioned.statusCode, 201, uriVersioned.body);
  assert.equal(uriVersioned.json?.capabilityAttestation?.capability, "capability://travel.booking@v2");

  const listedUriVersioned = await request(api, {
    method: "GET",
    path:
      `/capability-attestations?subjectAgentId=${encodeURIComponent(subjectAgentId)}` +
      `&capability=${encodeURIComponent("capability://travel.booking@v2")}&status=valid&limit=10&offset=0`
  });
  assert.equal(listedUriVersioned.statusCode, 200, listedUriVersioned.body);
  assert.equal(listedUriVersioned.json?.attestations?.length, 1);
  assert.equal(listedUriVersioned.json?.attestations?.[0]?.capabilityAttestation?.attestationId, "catt_cap_ns_uri_1");
});

test("API e2e: capability attestation capability namespace validation fails closed deterministically", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  const subjectAgentId = "agt_cap_ns_invalid_subject_1";
  const issuerAgentId = "agt_cap_ns_invalid_issuer_1";

  await registerAgent(api, { agentId: subjectAgentId, capabilities: ["travel.booking"] });
  await registerAgent(api, { agentId: issuerAgentId, capabilities: ["attestation.issue"] });

  const invalidCases = [
    {
      name: "scheme",
      capability: "https://travel.booking",
      pattern: CAPABILITY_NAMESPACE_ERROR_PATTERN.scheme
    },
    {
      name: "format",
      capability: "capability://Travel.booking",
      pattern: CAPABILITY_NAMESPACE_ERROR_PATTERN.format
    },
    {
      name: "reserved",
      capability: "capability://reserved.travel",
      pattern: CAPABILITY_NAMESPACE_ERROR_PATTERN.reserved
    },
    {
      name: "segment-length",
      capability: `capability://travel.${"a".repeat(80)}`,
      pattern: CAPABILITY_NAMESPACE_ERROR_PATTERN.segmentLength
    }
  ];

  for (const invalidCase of invalidCases) {
    const first = await request(api, {
      method: "POST",
      path: "/capability-attestations",
      headers: { "x-idempotency-key": `capability_attest_cap_ns_invalid_${invalidCase.name}_1` },
      body: {
        attestationId: `catt_cap_ns_invalid_${invalidCase.name}_1`,
        subjectAgentId,
        capability: invalidCase.capability,
        level: "attested",
        issuerAgentId,
        validity: {
          issuedAt: "2026-02-23T00:00:00.000Z",
          notBefore: "2026-02-23T00:00:00.000Z",
          expiresAt: "2027-02-23T00:00:00.000Z"
        },
        signature: {
          keyId: `key_${issuerAgentId}`,
          signature: `sig_cap_ns_invalid_${invalidCase.name}_1`
        }
      }
    });
    assertCapabilityNamespaceErrorResponse(first, invalidCase.pattern);

    const second = await request(api, {
      method: "POST",
      path: "/capability-attestations",
      headers: { "x-idempotency-key": `capability_attest_cap_ns_invalid_${invalidCase.name}_2` },
      body: {
        attestationId: `catt_cap_ns_invalid_${invalidCase.name}_2`,
        subjectAgentId,
        capability: invalidCase.capability,
        level: "attested",
        issuerAgentId,
        validity: {
          issuedAt: "2026-02-23T00:00:00.000Z",
          notBefore: "2026-02-23T00:00:00.000Z",
          expiresAt: "2027-02-23T00:00:00.000Z"
        },
        signature: {
          keyId: `key_${issuerAgentId}`,
          signature: `sig_cap_ns_invalid_${invalidCase.name}_2`
        }
      }
    });
    assertCapabilityNamespaceErrorResponse(second, invalidCase.pattern);
    assert.equal(first.json?.details?.message, second.json?.details?.message);
  }
});

test("API e2e: public agent-card publish fails closed without required capability attestations", async () => {
  const issuerAgentId = "agt_card_pub_att_issuer_1";
  const subjectAgentId = "agt_card_pub_att_subject_1";
  const api = createApi({
    opsToken: "tok_ops",
    agentCardPublicRequireCapabilityAttestation: true,
    agentCardPublicAttestationMinLevel: "attested",
    agentCardPublicAttestationIssuerAgentId: issuerAgentId
  });

  await registerAgent(api, { agentId: issuerAgentId, capabilities: ["attestation.issue"] });
  await registerAgent(api, { agentId: subjectAgentId, capabilities: ["travel.booking", "travel.search"] });

  const missingAll = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_pub_att_missing_all_1" },
    body: {
      agentId: subjectAgentId,
      displayName: "Subject Agent",
      capabilities: ["travel.booking", "travel.search"],
      visibility: "public"
    }
  });
  assert.equal(missingAll.statusCode, 409, missingAll.body);
  assert.equal(missingAll.json?.code, "AGENT_CARD_PUBLIC_ATTESTATION_REQUIRED");
  assert.equal(missingAll.json?.details?.minLevel, "attested");
  assert.equal(missingAll.json?.details?.issuerAgentId, issuerAgentId);
  assert.equal(
    missingAll.json?.details?.blockingCapabilities?.some(
      (row) => row.capability === "travel.booking" && row.reasonCode === "CAPABILITY_ATTESTATION_MISSING"
    ),
    true
  );
  assert.equal(
    missingAll.json?.details?.blockingCapabilities?.some(
      (row) => row.capability === "travel.search" && row.reasonCode === "CAPABILITY_ATTESTATION_MISSING"
    ),
    true
  );

  const bookingAttested = await request(api, {
    method: "POST",
    path: "/capability-attestations",
    headers: { "x-idempotency-key": "capability_attest_pub_booking_1" },
    body: {
      attestationId: "catt_pub_booking_1",
      subjectAgentId,
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
        signature: "sig_pub_booking_1"
      }
    }
  });
  assert.equal(bookingAttested.statusCode, 201, bookingAttested.body);

  const searchTooLow = await request(api, {
    method: "POST",
    path: "/capability-attestations",
    headers: { "x-idempotency-key": "capability_attest_pub_search_low_1" },
    body: {
      attestationId: "catt_pub_search_low_1",
      subjectAgentId,
      capability: "travel.search",
      level: "self_claim",
      issuerAgentId,
      validity: {
        issuedAt: "2026-02-23T00:00:00.000Z",
        notBefore: "2026-02-23T00:00:00.000Z",
        expiresAt: "2027-02-23T00:00:00.000Z"
      },
      signature: {
        keyId: `key_${issuerAgentId}`,
        signature: "sig_pub_search_low_1"
      }
    }
  });
  assert.equal(searchTooLow.statusCode, 201, searchTooLow.body);

  const levelBlocked = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_pub_att_level_blocked_1" },
    body: {
      agentId: subjectAgentId,
      displayName: "Subject Agent",
      capabilities: ["travel.booking", "travel.search"],
      visibility: "public"
    }
  });
  assert.equal(levelBlocked.statusCode, 409, levelBlocked.body);
  assert.equal(levelBlocked.json?.code, "AGENT_CARD_PUBLIC_ATTESTATION_REQUIRED");
  assert.equal(
    levelBlocked.json?.details?.blockingCapabilities?.some(
      (row) => row.capability === "travel.search" && row.reasonCode === "CAPABILITY_ATTESTATION_LEVEL_MISMATCH"
    ),
    true
  );

  const searchAttested = await request(api, {
    method: "POST",
    path: "/capability-attestations",
    headers: { "x-idempotency-key": "capability_attest_pub_search_attested_1" },
    body: {
      attestationId: "catt_pub_search_attested_1",
      subjectAgentId,
      capability: "travel.search",
      level: "attested",
      issuerAgentId,
      validity: {
        issuedAt: "2026-02-23T00:00:00.000Z",
        notBefore: "2026-02-23T00:00:00.000Z",
        expiresAt: "2027-02-23T00:00:00.000Z"
      },
      signature: {
        keyId: `key_${issuerAgentId}`,
        signature: "sig_pub_search_attested_1"
      }
    }
  });
  assert.equal(searchAttested.statusCode, 201, searchAttested.body);

  const publishAllowed = await request(api, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_pub_att_allowed_1" },
    body: {
      agentId: subjectAgentId,
      displayName: "Subject Agent",
      capabilities: ["travel.booking", "travel.search"],
      visibility: "public",
      host: { runtime: "openclaw", endpoint: "https://example.test/subject-agent", protocols: ["mcp"] }
    }
  });
  assert.equal(publishAllowed.statusCode, 201, publishAllowed.body);
  assert.equal(publishAllowed.json?.agentCard?.visibility, "public");
});

test("API e2e: public discover auto-applies capability attestation policy", async () => {
  const issuerAgentId = "agt_disc_policy_issuer_1";
  const attestedAgentId = "agt_disc_policy_attested_1";
  const plainAgentId = "agt_disc_policy_plain_1";
  const sharedStore = createStore();
  const setupApi = createApi({
    opsToken: "tok_ops",
    store: sharedStore
  });
  const policyApi = createApi({
    opsToken: "tok_ops",
    store: sharedStore,
    agentCardPublicRequireCapabilityAttestation: true,
    agentCardPublicAttestationMinLevel: "attested",
    agentCardPublicAttestationIssuerAgentId: issuerAgentId
  });

  await registerAgent(setupApi, { agentId: issuerAgentId, capabilities: ["attestation.issue"] });
  await registerAgent(setupApi, { agentId: attestedAgentId, capabilities: ["travel.booking"] });
  await registerAgent(setupApi, { agentId: plainAgentId, capabilities: ["travel.booking"] });

  await upsertAgentCard(setupApi, { agentId: attestedAgentId, capability: "travel.booking", idem: "agent_card_disc_policy_attested_1" });
  await upsertAgentCard(setupApi, { agentId: plainAgentId, capability: "travel.booking", idem: "agent_card_disc_policy_plain_1" });

  const attestationIssued = await request(setupApi, {
    method: "POST",
    path: "/capability-attestations",
    headers: { "x-idempotency-key": "capability_attest_disc_policy_1" },
    body: {
      attestationId: "catt_disc_policy_1",
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
        signature: "sig_disc_policy_1"
      }
    }
  });
  assert.equal(attestationIssued.statusCode, 201, attestationIssued.body);

  const discoverAuto = await request(policyApi, {
    method: "GET",
    path: "/agent-cards/discover?capability=travel.booking&visibility=public&runtime=openclaw&status=active&includeReputation=false&limit=10&offset=0"
  });
  assert.equal(discoverAuto.statusCode, 200, discoverAuto.body);
  assert.equal(discoverAuto.json?.results?.length, 1);
  assert.equal(discoverAuto.json?.results?.[0]?.agentCard?.agentId, attestedAgentId);
  assert.equal(discoverAuto.json?.attestationPolicy?.schemaVersion, "AgentCardPublicDiscoveryAttestationPolicy.v1");
  assert.equal(discoverAuto.json?.attestationPolicy?.source, "public_discovery_policy");
  assert.equal(discoverAuto.json?.attestationPolicy?.minLevel, "attested");
  assert.equal(discoverAuto.json?.attestationPolicy?.issuerAgentId, issuerAgentId);
  assert.equal(
    discoverAuto.json?.excludedAttestationCandidates?.some(
      (entry) => entry.agentId === plainAgentId && entry.reasonCode === "CAPABILITY_ATTESTATION_MISSING"
    ),
    true
  );
});

test("API e2e: public discover reports null capability for excluded candidates without declared capabilities", async () => {
  const issuerAgentId = "agt_disc_policy_null_cap_issuer_1";
  const noCapabilityAgentId = "agt_disc_policy_null_cap_subject_1";
  const sharedStore = createStore();
  const setupApi = createApi({
    opsToken: "tok_ops",
    store: sharedStore
  });
  const policyApi = createApi({
    opsToken: "tok_ops",
    store: sharedStore,
    agentCardPublicRequireCapabilityAttestation: true,
    agentCardPublicAttestationMinLevel: "attested",
    agentCardPublicAttestationIssuerAgentId: issuerAgentId
  });

  await registerAgent(setupApi, { agentId: issuerAgentId, capabilities: ["attestation.issue"] });
  await registerAgent(setupApi, { agentId: noCapabilityAgentId });

  const upsertNoCapabilityCard = await request(setupApi, {
    method: "POST",
    path: "/agent-cards",
    headers: { "x-idempotency-key": "agent_card_disc_policy_null_cap_subject_1" },
    body: {
      agentId: noCapabilityAgentId,
      displayName: "No Capability Subject",
      visibility: "public",
      host: { runtime: "openclaw", endpoint: "https://example.test/discovery/null-capability", protocols: ["mcp"] }
    }
  });
  assert.equal(upsertNoCapabilityCard.statusCode, 201, upsertNoCapabilityCard.body);

  const discoverAuto = await request(policyApi, {
    method: "GET",
    path: "/agent-cards/discover?visibility=public&runtime=openclaw&status=active&includeReputation=false&limit=10&offset=0"
  });
  assert.equal(discoverAuto.statusCode, 200, discoverAuto.body);
  assert.equal(discoverAuto.json?.results?.length, 0);
  assert.equal(
    discoverAuto.json?.excludedAttestationCandidates?.some(
      (entry) =>
        entry.agentId === noCapabilityAgentId &&
        entry.capability === null &&
        entry.reasonCode === "CAPABILITY_ATTESTATION_MISSING"
    ),
    true
  );
});

test("API e2e: public discover policy min attestation level cannot be weakened by query", async () => {
  const issuerAgentId = "agt_disc_policy_floor_issuer_1";
  const strongAgentId = "agt_disc_policy_floor_strong_1";
  const weakAgentId = "agt_disc_policy_floor_weak_1";
  const sharedStore = createStore();
  const setupApi = createApi({
    opsToken: "tok_ops",
    store: sharedStore
  });
  const policyApi = createApi({
    opsToken: "tok_ops",
    store: sharedStore,
    agentCardPublicRequireCapabilityAttestation: true,
    agentCardPublicAttestationMinLevel: "attested",
    agentCardPublicAttestationIssuerAgentId: issuerAgentId
  });

  await registerAgent(setupApi, { agentId: issuerAgentId, capabilities: ["attestation.issue"] });
  await registerAgent(setupApi, { agentId: strongAgentId, capabilities: ["travel.booking"] });
  await registerAgent(setupApi, { agentId: weakAgentId, capabilities: ["travel.booking"] });

  await upsertAgentCard(setupApi, { agentId: strongAgentId, capability: "travel.booking", idem: "agent_card_disc_policy_floor_strong_1" });
  await upsertAgentCard(setupApi, { agentId: weakAgentId, capability: "travel.booking", idem: "agent_card_disc_policy_floor_weak_1" });

  const strongAttestation = await request(setupApi, {
    method: "POST",
    path: "/capability-attestations",
    headers: { "x-idempotency-key": "capability_attest_disc_policy_floor_strong_1" },
    body: {
      attestationId: "catt_disc_policy_floor_strong_1",
      subjectAgentId: strongAgentId,
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
        signature: "sig_disc_policy_floor_strong_1"
      }
    }
  });
  assert.equal(strongAttestation.statusCode, 201, strongAttestation.body);

  const weakAttestation = await request(setupApi, {
    method: "POST",
    path: "/capability-attestations",
    headers: { "x-idempotency-key": "capability_attest_disc_policy_floor_weak_1" },
    body: {
      attestationId: "catt_disc_policy_floor_weak_1",
      subjectAgentId: weakAgentId,
      capability: "travel.booking",
      level: "self_claim",
      issuerAgentId,
      validity: {
        issuedAt: "2026-02-23T00:00:00.000Z",
        notBefore: "2026-02-23T00:00:00.000Z",
        expiresAt: "2027-02-23T00:00:00.000Z"
      },
      signature: {
        keyId: `key_${issuerAgentId}`,
        signature: "sig_disc_policy_floor_weak_1"
      }
    }
  });
  assert.equal(weakAttestation.statusCode, 201, weakAttestation.body);

  const discoverAttemptedBypass = await request(policyApi, {
    method: "GET",
    path:
      `/agent-cards/discover?capability=travel.booking&visibility=public&runtime=openclaw&status=active&includeReputation=false` +
      `&requireCapabilityAttestation=true&attestationMinLevel=self_claim&attestationIssuerAgentId=${encodeURIComponent(issuerAgentId)}` +
      `&includeAttestationMetadata=true&limit=10&offset=0`
  });
  assert.equal(discoverAttemptedBypass.statusCode, 200, discoverAttemptedBypass.body);
  assert.equal(discoverAttemptedBypass.json?.results?.length, 1);
  assert.equal(discoverAttemptedBypass.json?.results?.[0]?.agentCard?.agentId, strongAgentId);
  assert.equal(discoverAttemptedBypass.json?.attestationPolicy?.minLevel, "attested");
  assert.equal(
    discoverAttemptedBypass.json?.excludedAttestationCandidates?.some(
      (entry) => entry.agentId === weakAgentId && entry.reasonCode === "CAPABILITY_ATTESTATION_LEVEL_MISMATCH"
    ),
    true
  );
});

test("API e2e: public discover policy issuer cannot be overridden by query", async () => {
  const policyIssuerAgentId = "agt_disc_policy_issuer_lock_policy_1";
  const nonPolicyIssuerAgentId = "agt_disc_policy_issuer_lock_alt_1";
  const policySignedAgentId = "agt_disc_policy_issuer_lock_policy_signed_1";
  const altSignedAgentId = "agt_disc_policy_issuer_lock_alt_signed_1";
  const sharedStore = createStore();
  const setupApi = createApi({
    opsToken: "tok_ops",
    store: sharedStore
  });
  const policyApi = createApi({
    opsToken: "tok_ops",
    store: sharedStore,
    agentCardPublicRequireCapabilityAttestation: true,
    agentCardPublicAttestationMinLevel: "attested",
    agentCardPublicAttestationIssuerAgentId: policyIssuerAgentId
  });

  await registerAgent(setupApi, { agentId: policyIssuerAgentId, capabilities: ["attestation.issue"] });
  await registerAgent(setupApi, { agentId: nonPolicyIssuerAgentId, capabilities: ["attestation.issue"] });
  await registerAgent(setupApi, { agentId: policySignedAgentId, capabilities: ["travel.booking"] });
  await registerAgent(setupApi, { agentId: altSignedAgentId, capabilities: ["travel.booking"] });

  await upsertAgentCard(setupApi, {
    agentId: policySignedAgentId,
    capability: "travel.booking",
    idem: "agent_card_disc_policy_issuer_lock_policy_signed_1"
  });
  await upsertAgentCard(setupApi, {
    agentId: altSignedAgentId,
    capability: "travel.booking",
    idem: "agent_card_disc_policy_issuer_lock_alt_signed_1"
  });

  const policySignedAttestation = await request(setupApi, {
    method: "POST",
    path: "/capability-attestations",
    headers: { "x-idempotency-key": "capability_attest_disc_policy_issuer_lock_policy_1" },
    body: {
      attestationId: "catt_disc_policy_issuer_lock_policy_1",
      subjectAgentId: policySignedAgentId,
      capability: "travel.booking",
      level: "attested",
      issuerAgentId: policyIssuerAgentId,
      validity: {
        issuedAt: "2026-02-23T00:00:00.000Z",
        notBefore: "2026-02-23T00:00:00.000Z",
        expiresAt: "2027-02-23T00:00:00.000Z"
      },
      signature: {
        keyId: `key_${policyIssuerAgentId}`,
        signature: "sig_disc_policy_issuer_lock_policy_1"
      }
    }
  });
  assert.equal(policySignedAttestation.statusCode, 201, policySignedAttestation.body);

  const altSignedAttestation = await request(setupApi, {
    method: "POST",
    path: "/capability-attestations",
    headers: { "x-idempotency-key": "capability_attest_disc_policy_issuer_lock_alt_1" },
    body: {
      attestationId: "catt_disc_policy_issuer_lock_alt_1",
      subjectAgentId: altSignedAgentId,
      capability: "travel.booking",
      level: "attested",
      issuerAgentId: nonPolicyIssuerAgentId,
      validity: {
        issuedAt: "2026-02-23T00:00:00.000Z",
        notBefore: "2026-02-23T00:00:00.000Z",
        expiresAt: "2027-02-23T00:00:00.000Z"
      },
      signature: {
        keyId: `key_${nonPolicyIssuerAgentId}`,
        signature: "sig_disc_policy_issuer_lock_alt_1"
      }
    }
  });
  assert.equal(altSignedAttestation.statusCode, 201, altSignedAttestation.body);

  const discoverAttemptedIssuerBypass = await request(policyApi, {
    method: "GET",
    path:
      `/agent-cards/discover?capability=travel.booking&visibility=public&runtime=openclaw&status=active&includeReputation=false` +
      `&requireCapabilityAttestation=true&attestationIssuerAgentId=${encodeURIComponent(nonPolicyIssuerAgentId)}` +
      `&includeAttestationMetadata=true&limit=10&offset=0`
  });
  assert.equal(discoverAttemptedIssuerBypass.statusCode, 200, discoverAttemptedIssuerBypass.body);
  assert.equal(discoverAttemptedIssuerBypass.json?.results?.length, 1);
  assert.equal(discoverAttemptedIssuerBypass.json?.results?.[0]?.agentCard?.agentId, policySignedAgentId);
  assert.equal(discoverAttemptedIssuerBypass.json?.attestationPolicy?.issuerAgentId, policyIssuerAgentId);
  assert.equal(
    discoverAttemptedIssuerBypass.json?.excludedAttestationCandidates?.some(
      (entry) => entry.agentId === altSignedAgentId && entry.reasonCode === "CAPABILITY_ATTESTATION_ISSUER_MISMATCH"
    ),
    true
  );
});
