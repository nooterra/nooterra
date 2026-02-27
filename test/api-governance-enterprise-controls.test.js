import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createEd25519Keypair } from "../src/core/crypto.js";
import { signOperatorActionV1 } from "../src/core/operator-action.js";
import { request } from "./api-test-harness.js";

const OPS_WRITE_HEADERS = { "x-proxy-ops-token": "tok_opsw" };
let operatorActionSeq = 0;

function createGovernanceApi() {
  return createApi({
    opsTokens: ["tok_opsw:ops_write", "tok_opsr:ops_read"].join(";")
  });
}

async function registerSignerKey(api, { purpose = "operator", description = "governance signer" } = {}) {
  const keypair = createEd25519Keypair();
  const registered = await request(api, {
    method: "POST",
    path: "/ops/signer-keys",
    headers: OPS_WRITE_HEADERS,
    body: {
      publicKeyPem: keypair.publicKeyPem,
      purpose,
      description
    }
  });
  assert.equal(registered.statusCode, 201, registered.body);
  return {
    ...keypair,
    keyId: String(registered.json?.signerKey?.keyId ?? "")
  };
}

function buildSignedOperatorAction({
  signer,
  operatorId,
  role = "oncall",
  tenantId = "tenant_default",
  caseIdPrefix = "gov_ctrl_case",
  action = "OVERRIDE_DENY"
} = {}) {
  operatorActionSeq += 1;
  return signOperatorActionV1({
    action: {
      actionId: `oa_gov_${operatorActionSeq}`,
      caseRef: { kind: "escalation", caseId: `${caseIdPrefix}_${operatorActionSeq}` },
      action,
      justificationCode: "OPS_EMERGENCY_CONTROL",
      justification: "governance emergency control",
      actor: { operatorId, role, tenantId },
      actedAt: new Date().toISOString()
    },
    publicKeyPem: signer.publicKeyPem,
    privateKeyPem: signer.privateKeyPem
  });
}

test("governance controls: emergency pause fail-closes delegation and authority grant writes", async () => {
  const api = createGovernanceApi();
  const operatorSigner = await registerSignerKey(api, { description: "S7 pause signer" });

  const pause = await request(api, {
    method: "POST",
    path: "/ops/emergency/pause",
    headers: OPS_WRITE_HEADERS,
    body: {
      reasonCode: "OPS_EMERGENCY_PAUSE",
      reason: "S7 containment",
      operatorAction: buildSignedOperatorAction({
        signer: operatorSigner,
        operatorId: "op_s7_pause_primary"
      })
    }
  });
  assert.ok(pause.statusCode === 200 || pause.statusCode === 201, pause.body);

  const blockedDelegationGrant = await request(api, {
    method: "POST",
    path: "/delegation-grants",
    headers: {
      "x-idempotency-key": "s7_blocked_delegation_grant_1",
      "x-nooterra-protocol": "1.0",
      ...OPS_WRITE_HEADERS
    },
    body: {
      grantId: "dgrant_s7_pause_1",
      delegatorAgentId: "agt_s7_delegator_1",
      delegateeAgentId: "agt_s7_delegatee_1"
    }
  });
  assert.equal(blockedDelegationGrant.statusCode, 409, blockedDelegationGrant.body);
  assert.equal(blockedDelegationGrant.json?.code, "EMERGENCY_PAUSE_ACTIVE");

  const blockedAuthorityGrant = await request(api, {
    method: "POST",
    path: "/authority-grants",
    headers: {
      "x-idempotency-key": "s7_blocked_authority_grant_1",
      "x-nooterra-protocol": "1.0",
      ...OPS_WRITE_HEADERS
    },
    body: {
      grantId: "agrant_s7_pause_1",
      principalRef: { principalType: "service", principalId: "svc_s7_1" },
      granteeAgentId: "agt_s7_grantee_1"
    }
  });
  assert.equal(blockedAuthorityGrant.statusCode, 409, blockedAuthorityGrant.body);
  assert.equal(blockedAuthorityGrant.json?.code, "EMERGENCY_PAUSE_ACTIVE");
});

test("governance controls: /ops/audit/export emits deterministic governance export with reason-coded denials", async () => {
  const api = createGovernanceApi();
  const signerA = await registerSignerKey(api, { description: "S7 export signer A" });
  const signerB = await registerSignerKey(api, { description: "S7 export signer B" });

  const revoke = await request(api, {
    method: "POST",
    path: "/ops/emergency/revoke",
    headers: OPS_WRITE_HEADERS,
    body: {
      scope: { type: "agent", id: "agt_s7_export_1" },
      reasonCode: "OPS_EMERGENCY_REVOKE",
      reason: "S7 revoke for export",
      operatorAction: buildSignedOperatorAction({
        signer: signerA,
        operatorId: "op_s7_export_primary",
        role: "incident_commander",
        caseIdPrefix: "s7_export_revoke"
      }),
      secondOperatorAction: buildSignedOperatorAction({
        signer: signerB,
        operatorId: "op_s7_export_secondary",
        role: "ops_admin",
        caseIdPrefix: "s7_export_revoke_secondary"
      })
    }
  });
  assert.ok(revoke.statusCode === 200 || revoke.statusCode === 201, revoke.body);

  const first = await request(api, {
    method: "GET",
    path: "/ops/audit/export?domain=governance&limit=200",
    headers: { "x-proxy-ops-token": "tok_opsr" }
  });
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.json?.export?.schemaVersion, "OpsAuditExport.v1");
  assert.ok(Array.isArray(first.json?.export?.rows));
  assert.ok(first.json.export.rows.length >= 1);
  assert.match(String(first.json?.export?.exportHash ?? ""), /^[a-f0-9]{64}$/);

  const revokeRows = first.json.export.rows.filter((row) => String(row?.action ?? "").includes("EMERGENCY_CONTROL_REVOKE"));
  assert.ok(revokeRows.length >= 1);
  for (const row of revokeRows) {
    assert.equal(row?.decision?.reasonCode, "OPS_EMERGENCY_REVOKE");
    assert.equal(typeof row?.linkedRefs?.emergencyControlRef, "string");
    assert.ok(row.linkedRefs.emergencyControlRef.length > 0);
  }

  const second = await request(api, {
    method: "GET",
    path: "/ops/audit/export?domain=governance&limit=200",
    headers: { "x-proxy-ops-token": "tok_opsr" }
  });
  assert.equal(second.statusCode, 200, second.body);
  assert.equal(second.json?.export?.exportHash, first.json?.export?.exportHash);
  assert.deepEqual(second.json?.export?.rows, first.json?.export?.rows);
});

test("governance controls: /ops/audit/export fails closed on missing denial reason codes", async () => {
  const api = createGovernanceApi();
  const operatorSigner = await registerSignerKey(api, { description: "S7 missing reason signer" });

  const pauseWithoutReasonCode = await request(api, {
    method: "POST",
    path: "/ops/emergency/pause",
    headers: OPS_WRITE_HEADERS,
    body: {
      reason: "legacy pause without explicit reason code",
      operatorAction: buildSignedOperatorAction({
        signer: operatorSigner,
        operatorId: "op_s7_missing_reason"
      })
    }
  });
  assert.ok(pauseWithoutReasonCode.statusCode === 200 || pauseWithoutReasonCode.statusCode === 201, pauseWithoutReasonCode.body);

  const exportAttempt = await request(api, {
    method: "GET",
    path: "/ops/audit/export?domain=governance&limit=200",
    headers: { "x-proxy-ops-token": "tok_opsr" }
  });
  assert.equal(exportAttempt.statusCode, 409, exportAttempt.body);
  assert.equal(exportAttempt.json?.code, "AUDIT_EXPORT_REASON_CODE_REQUIRED");
});
