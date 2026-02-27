import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createEd25519Keypair, keyIdFromPublicKeyPem } from "../src/core/crypto.js";
import { request } from "./api-test-harness.js";

async function registerAgent(api, { agentId, capabilities = [] }) {
  const { publicKeyPem } = createEd25519Keypair();
  const response = await request(api, {
    method: "POST",
    path: "/agents/register",
    headers: { "x-idempotency-key": `agent_register_${agentId}` },
    body: {
      agentId,
      displayName: `Agent ${agentId}`,
      owner: { ownerType: "service", ownerId: "svc_state_checkpoint" },
      publicKeyPem,
      capabilities
    }
  });
  assert.equal(response.statusCode, 201, response.body);
}

async function registerAgentWithKey(api, { agentId, capabilities = [] }) {
  const { publicKeyPem } = createEd25519Keypair();
  const response = await request(api, {
    method: "POST",
    path: "/agents/register",
    headers: { "x-idempotency-key": `agent_register_${agentId}` },
    body: {
      agentId,
      displayName: `Agent ${agentId}`,
      owner: { ownerType: "service", ownerId: "svc_state_checkpoint" },
      publicKeyPem,
      capabilities
    }
  });
  assert.equal(response.statusCode, 201, response.body);
  return { agentId, keyId: keyIdFromPublicKeyPem(publicKeyPem), publicKeyPem };
}

async function registerSignerKey(api, { keyId, publicKeyPem, purpose = "robot", description = "state checkpoint signer key" }) {
  const response = await request(api, {
    method: "POST",
    path: "/ops/signer-keys",
    body: {
      keyId,
      publicKeyPem,
      purpose,
      status: "active",
      description
    }
  });
  assert.equal(response.statusCode, 201, response.body);
  assert.equal(response.json?.signerKey?.keyId, keyId);
}

async function rotateSignerKey(api, { keyId }) {
  const response = await request(api, {
    method: "POST",
    path: `/ops/signer-keys/${encodeURIComponent(keyId)}/rotate`,
    body: {}
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json?.signerKey?.status, "rotated");
}

async function revokeSignerKey(api, { keyId }) {
  const response = await request(api, {
    method: "POST",
    path: `/ops/signer-keys/${encodeURIComponent(keyId)}/revoke`,
    body: {}
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json?.signerKey?.status, "revoked");
}

async function issueAuthorityGrant(
  api,
  { grantId, granteeAgentId, allowedRiskClasses = ["action"], allowedToolIds = ["state_checkpoint_create"] }
) {
  const response = await request(api, {
    method: "POST",
    path: "/authority-grants",
    headers: { "x-idempotency-key": `authority_grant_state_checkpoint_${grantId}` },
    body: {
      grantId,
      principalRef: {
        principalType: "org",
        principalId: "org_state_checkpoint"
      },
      granteeAgentId,
      scope: {
        sideEffectingAllowed: true,
        allowedRiskClasses,
        allowedToolIds
      },
      spendEnvelope: {
        currency: "USD",
        maxPerCallCents: 1_000,
        maxTotalCents: 100_000
      },
      chainBinding: {
        depth: 0,
        maxDelegationDepth: 2
      },
      validity: {
        issuedAt: "2026-02-01T00:00:00.000Z",
        notBefore: "2026-02-01T00:00:00.000Z",
        expiresAt: "2027-02-01T00:00:00.000Z"
      }
    }
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json?.authorityGrant;
}

async function issueDelegationGrant(
  api,
  {
    grantId,
    delegatorAgentId,
    delegateeAgentId,
    allowedRiskClasses = ["action"],
    allowedToolIds = ["state_checkpoint_create"],
    chainBinding = null
  }
) {
  const resolvedChainBinding =
    chainBinding && typeof chainBinding === "object" && !Array.isArray(chainBinding)
      ? chainBinding
      : {
          depth: 0,
          maxDelegationDepth: 1
        };
  const response = await request(api, {
    method: "POST",
    path: "/delegation-grants",
    headers: { "x-idempotency-key": `delegation_grant_state_checkpoint_${grantId}` },
    body: {
      grantId,
      delegatorAgentId,
      delegateeAgentId,
      scope: {
        sideEffectingAllowed: true,
        allowedRiskClasses,
        allowedToolIds
      },
      spendLimit: {
        currency: "USD",
        maxPerCallCents: 1_000,
        maxTotalCents: 100_000
      },
      chainBinding: resolvedChainBinding,
      validity: {
        issuedAt: "2026-02-01T00:00:00.000Z",
        notBefore: "2026-02-01T00:00:00.000Z",
        expiresAt: "2027-02-01T00:00:00.000Z"
      }
    }
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json?.delegationGrant;
}

test("API e2e: state checkpoint create/list/get lifecycle", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  const ownerAgentId = "agt_state_owner_1";
  await registerAgent(api, { agentId: ownerAgentId, capabilities: ["state.manage"] });

  const created = await request(api, {
    method: "POST",
    path: "/state-checkpoints",
    headers: { "x-idempotency-key": "state_checkpoint_create_1" },
    body: {
      checkpointId: "chkpt_state_1",
      ownerAgentId,
      projectId: "proj_state_1",
      sessionId: "sess_state_1",
      traceId: "trace_state_1",
      stateRef: {
        schemaVersion: "ArtifactRef.v1",
        artifactId: "art_state_root_1",
        artifactHash: "1".repeat(64),
        artifactType: "StateSnapshot.v1"
      },
      diffRefs: [
        {
          schemaVersion: "ArtifactRef.v1",
          artifactId: "art_diff_b",
          artifactHash: "b".repeat(64),
          artifactType: "StateDiff.v1"
        },
        {
          schemaVersion: "ArtifactRef.v1",
          artifactId: "art_diff_a",
          artifactHash: "a".repeat(64),
          artifactType: "StateDiff.v1"
        },
        {
          schemaVersion: "ArtifactRef.v1",
          artifactId: "art_diff_b",
          artifactHash: "b".repeat(64),
          artifactType: "StateDiff.v1"
        }
      ],
      metadata: { step: 1 }
    }
  });
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.json?.stateCheckpoint?.schemaVersion, "StateCheckpoint.v1");
  assert.equal(created.json?.stateCheckpoint?.checkpointId, "chkpt_state_1");
  assert.equal(typeof created.json?.stateCheckpoint?.checkpointHash, "string");
  assert.equal(created.json?.stateCheckpoint?.diffRefs?.length, 2);
  assert.equal(created.json?.stateCheckpoint?.diffRefs?.[0]?.artifactId, "art_diff_a");

  const listed = await request(api, {
    method: "GET",
    path: `/state-checkpoints?ownerAgentId=${encodeURIComponent(ownerAgentId)}&traceId=trace_state_1&limit=10&offset=0`
  });
  assert.equal(listed.statusCode, 200, listed.body);
  assert.equal(Array.isArray(listed.json?.stateCheckpoints), true);
  assert.equal(listed.json?.stateCheckpoints?.length, 1);
  assert.equal(listed.json?.stateCheckpoints?.[0]?.checkpointId, "chkpt_state_1");

  const fetched = await request(api, {
    method: "GET",
    path: "/state-checkpoints/chkpt_state_1"
  });
  assert.equal(fetched.statusCode, 200, fetched.body);
  assert.equal(fetched.json?.stateCheckpoint?.checkpointId, "chkpt_state_1");
});

test("API e2e: state checkpoint fail-closed behaviors", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  const ownerAgentId = "agt_state_owner_2";
  await registerAgent(api, { agentId: ownerAgentId, capabilities: ["state.manage"] });

  const badHash = await request(api, {
    method: "POST",
    path: "/state-checkpoints",
    headers: { "x-idempotency-key": "state_checkpoint_bad_hash_1" },
    body: {
      checkpointId: "chkpt_state_bad_hash_1",
      ownerAgentId,
      stateRef: {
        schemaVersion: "ArtifactRef.v1",
        artifactId: "art_state_bad_1",
        artifactHash: "bad_hash",
        artifactType: "StateSnapshot.v1"
      }
    }
  });
  assert.equal(badHash.statusCode, 400, badHash.body);
  assert.equal(badHash.json?.code, "SCHEMA_INVALID");

  const created = await request(api, {
    method: "POST",
    path: "/state-checkpoints",
    headers: { "x-idempotency-key": "state_checkpoint_conflict_1" },
    body: {
      checkpointId: "chkpt_state_conflict_1",
      ownerAgentId,
      stateRef: {
        schemaVersion: "ArtifactRef.v1",
        artifactId: "art_state_ok_1",
        artifactHash: "2".repeat(64),
        artifactType: "StateSnapshot.v1"
      }
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  const conflict = await request(api, {
    method: "POST",
    path: "/state-checkpoints",
    headers: { "x-idempotency-key": "state_checkpoint_conflict_2" },
    body: {
      checkpointId: "chkpt_state_conflict_1",
      ownerAgentId,
      stateRef: {
        schemaVersion: "ArtifactRef.v1",
        artifactId: "art_state_ok_2",
        artifactHash: "3".repeat(64),
        artifactType: "StateSnapshot.v1"
      }
    }
  });
  assert.equal(conflict.statusCode, 409, conflict.body);
  assert.equal(conflict.json?.code, "CONFLICT");
});

test("API e2e: state checkpoint create enforces delegation/authority grant chain when provided", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  const ownerAgentId = "agt_state_owner_grant_1";
  const delegatorAgentId = "agt_state_delegator_grant_1";
  await registerAgent(api, { agentId: ownerAgentId, capabilities: ["state.manage"] });
  await registerAgent(api, { agentId: delegatorAgentId, capabilities: ["orchestrate"] });

  const authorityGrant = await issueAuthorityGrant(api, {
    grantId: "ag_state_checkpoint_1",
    granteeAgentId: ownerAgentId
  });
  const delegationGrant = await issueDelegationGrant(api, {
    grantId: "dg_state_checkpoint_1",
    delegatorAgentId,
    delegateeAgentId: ownerAgentId,
    chainBinding: {
      rootGrantHash: authorityGrant.chainBinding.rootGrantHash,
      parentGrantHash: authorityGrant.grantHash,
      depth: 1,
      maxDelegationDepth: 2
    }
  });
  assert.equal(delegationGrant.chainBinding.rootGrantHash, authorityGrant.chainBinding.rootGrantHash);
  assert.equal(delegationGrant.chainBinding.parentGrantHash, authorityGrant.grantHash);

  const created = await request(api, {
    method: "POST",
    path: "/state-checkpoints",
    headers: { "x-idempotency-key": "state_checkpoint_grants_create_1" },
    body: {
      checkpointId: "chkpt_state_with_grants_1",
      ownerAgentId,
      delegationGrantRef: delegationGrant.grantId,
      authorityGrantRef: authorityGrant.grantId,
      stateRef: {
        schemaVersion: "ArtifactRef.v1",
        artifactId: "art_state_with_grants_1",
        artifactHash: "4".repeat(64),
        artifactType: "StateSnapshot.v1"
      }
    }
  });
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.json?.stateCheckpoint?.delegationGrantRef, delegationGrant.grantId);
  assert.equal(created.json?.stateCheckpoint?.authorityGrantRef, authorityGrant.grantId);
});

test("API e2e: state checkpoint create fails closed on grant actor mismatch and revoked grants", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  const ownerAgentId = "agt_state_owner_grant_2";
  const wrongOwnerAgentId = "agt_state_owner_grant_3";
  const delegatorAgentId = "agt_state_delegator_grant_2";
  await registerAgent(api, { agentId: ownerAgentId, capabilities: ["state.manage"] });
  await registerAgent(api, { agentId: wrongOwnerAgentId, capabilities: ["state.manage"] });
  await registerAgent(api, { agentId: delegatorAgentId, capabilities: ["orchestrate"] });

  await issueAuthorityGrant(api, {
    grantId: "ag_state_checkpoint_2",
    granteeAgentId: ownerAgentId
  });
  const delegationGrant = await issueDelegationGrant(api, {
    grantId: "dg_state_checkpoint_2",
    delegatorAgentId,
    delegateeAgentId: ownerAgentId
  });

  const mismatch = await request(api, {
    method: "POST",
    path: "/state-checkpoints",
    headers: { "x-idempotency-key": "state_checkpoint_grants_mismatch_1" },
    body: {
      checkpointId: "chkpt_state_grant_mismatch_1",
      ownerAgentId: wrongOwnerAgentId,
      delegationGrantRef: delegationGrant.grantId,
      stateRef: {
        schemaVersion: "ArtifactRef.v1",
        artifactId: "art_state_grant_mismatch_1",
        artifactHash: "5".repeat(64),
        artifactType: "StateSnapshot.v1"
      }
    }
  });
  assert.equal(mismatch.statusCode, 409, mismatch.body);
  assert.equal(mismatch.json?.code, "X402_DELEGATION_GRANT_ACTOR_MISMATCH");

  const revokedGrant = await request(api, {
    method: "POST",
    path: `/delegation-grants/${encodeURIComponent(delegationGrant.grantId)}/revoke`,
    headers: { "x-idempotency-key": "state_checkpoint_grants_revoke_1" },
    body: {
      revocationReasonCode: "MANUAL_REVOKE"
    }
  });
  assert.equal(revokedGrant.statusCode, 200, revokedGrant.body);

  const blockedRevoked = await request(api, {
    method: "POST",
    path: "/state-checkpoints",
    headers: { "x-idempotency-key": "state_checkpoint_grants_revoked_1" },
    body: {
      checkpointId: "chkpt_state_grant_revoked_1",
      ownerAgentId,
      delegationGrantRef: delegationGrant.grantId,
      stateRef: {
        schemaVersion: "ArtifactRef.v1",
        artifactId: "art_state_grant_revoked_1",
        artifactHash: "6".repeat(64),
        artifactType: "StateSnapshot.v1"
      }
    }
  });
  assert.equal(blockedRevoked.statusCode, 409, blockedRevoked.body);
  assert.equal(blockedRevoked.json?.code, "X402_DELEGATION_GRANT_REVOKED");
});

test("API e2e: state checkpoint create fails closed when delegation grant participant signer lifecycle is non-active", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  const owner = await registerAgentWithKey(api, {
    agentId: "agt_state_owner_signer_delegation_1",
    capabilities: ["state.manage"]
  });
  const delegatorAgentId = "agt_state_delegator_signer_delegation_1";
  await registerAgent(api, { agentId: delegatorAgentId, capabilities: ["orchestrate"] });

  const delegationGrant = await issueDelegationGrant(api, {
    grantId: "dg_state_checkpoint_signer_delegation_1",
    delegatorAgentId,
    delegateeAgentId: owner.agentId
  });

  await registerSignerKey(api, {
    keyId: owner.keyId,
    publicKeyPem: owner.publicKeyPem,
    description: "state checkpoint delegation signer lifecycle test"
  });
  await rotateSignerKey(api, { keyId: owner.keyId });

  const blocked = await request(api, {
    method: "POST",
    path: "/state-checkpoints",
    headers: { "x-idempotency-key": "state_checkpoint_signer_delegation_blocked_1" },
    body: {
      checkpointId: "chkpt_state_signer_delegation_blocked_1",
      ownerAgentId: owner.agentId,
      delegationGrantRef: delegationGrant.grantId,
      stateRef: {
        schemaVersion: "ArtifactRef.v1",
        artifactId: "art_state_signer_delegation_blocked_1",
        artifactHash: "9".repeat(64),
        artifactType: "StateSnapshot.v1"
      }
    }
  });
  assert.equal(blocked.statusCode, 409, blocked.body);
  assert.equal(blocked.json?.code, "X402_DELEGATION_GRANT_SIGNER_KEY_INVALID");
  assert.equal(blocked.json?.details?.operation, "state_checkpoint.create");
  assert.equal(blocked.json?.details?.role, "delegatee");
  assert.equal(blocked.json?.details?.reasonCode, "SIGNER_KEY_NOT_ACTIVE");
  assert.equal(blocked.json?.details?.signerStatus, "rotated");
});

test("API e2e: state checkpoint create fails closed when authority grant grantee signer lifecycle is non-active", async () => {
  const api = createApi({ opsToken: "tok_ops" });
  const owner = await registerAgentWithKey(api, {
    agentId: "agt_state_owner_signer_authority_1",
    capabilities: ["state.manage"]
  });

  const authorityGrant = await issueAuthorityGrant(api, {
    grantId: "ag_state_checkpoint_signer_authority_1",
    granteeAgentId: owner.agentId
  });

  await registerSignerKey(api, {
    keyId: owner.keyId,
    publicKeyPem: owner.publicKeyPem,
    description: "state checkpoint authority signer lifecycle test"
  });
  await revokeSignerKey(api, { keyId: owner.keyId });

  const blocked = await request(api, {
    method: "POST",
    path: "/state-checkpoints",
    headers: { "x-idempotency-key": "state_checkpoint_signer_authority_blocked_1" },
    body: {
      checkpointId: "chkpt_state_signer_authority_blocked_1",
      ownerAgentId: owner.agentId,
      authorityGrantRef: authorityGrant.grantId,
      stateRef: {
        schemaVersion: "ArtifactRef.v1",
        artifactId: "art_state_signer_authority_blocked_1",
        artifactHash: "a".repeat(64),
        artifactType: "StateSnapshot.v1"
      }
    }
  });
  assert.equal(blocked.statusCode, 409, blocked.body);
  assert.equal(blocked.json?.code, "X402_AUTHORITY_GRANT_SIGNER_KEY_INVALID");
  assert.equal(blocked.json?.details?.operation, "state_checkpoint.create");
  assert.equal(blocked.json?.details?.role, "grantee");
  assert.equal(blocked.json?.details?.reasonCode, "SIGNER_KEY_REVOKED");
  assert.equal(blocked.json?.details?.signerStatus, "revoked");
});

test("API e2e: state checkpoint create fails closed without authority grant when required", async () => {
  const api = createApi({ x402RequireAuthorityGrant: true });
  const ownerAgentId = "agt_state_owner_authority_required_1";
  await registerAgent(api, { agentId: ownerAgentId, capabilities: ["state.manage"] });

  const blocked = await request(api, {
    method: "POST",
    path: "/state-checkpoints",
    headers: { "x-idempotency-key": "state_checkpoint_auth_required_blocked_1" },
    body: {
      checkpointId: "chkpt_state_auth_required_blocked_1",
      ownerAgentId,
      stateRef: {
        schemaVersion: "ArtifactRef.v1",
        artifactId: "art_state_auth_required_blocked_1",
        artifactHash: "7".repeat(64),
        artifactType: "StateSnapshot.v1"
      }
    }
  });
  assert.equal(blocked.statusCode, 409, blocked.body);
  assert.equal(blocked.json?.code, "X402_AUTHORITY_GRANT_REQUIRED");

  const authorityGrant = await issueAuthorityGrant(api, {
    grantId: "ag_state_checkpoint_required_1",
    granteeAgentId: ownerAgentId
  });
  const allowed = await request(api, {
    method: "POST",
    path: "/state-checkpoints",
    headers: { "x-idempotency-key": "state_checkpoint_auth_required_allowed_1" },
    body: {
      checkpointId: "chkpt_state_auth_required_allowed_1",
      ownerAgentId,
      authorityGrantRef: authorityGrant.grantId,
      stateRef: {
        schemaVersion: "ArtifactRef.v1",
        artifactId: "art_state_auth_required_allowed_1",
        artifactHash: "8".repeat(64),
        artifactType: "StateSnapshot.v1"
      }
    }
  });
  assert.equal(allowed.statusCode, 201, allowed.body);
  assert.equal(allowed.json?.stateCheckpoint?.authorityGrantRef, authorityGrant.grantId);
});
