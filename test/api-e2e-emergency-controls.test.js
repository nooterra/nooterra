import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createEd25519Keypair } from "../src/core/crypto.js";
import { signOperatorActionV1 } from "../src/core/operator-action.js";
import { request } from "./api-test-harness.js";

const OPS_WRITE_HEADERS = { "x-proxy-ops-token": "tok_opsw" };
let operatorActionSeq = 0;

function createEmergencyApi() {
  return createApi({
    opsTokens: ["tok_opsw:ops_write", "tok_opsr:ops_read", "tok_finw:finance_write"].join(";")
  });
}

function assertCreatedOrOk(res, { bodyMessage } = {}) {
  assert.ok(res.statusCode === 200 || res.statusCode === 201, bodyMessage ?? res.body);
}

async function registerSignerKey(api, { purpose = "operator", description = "noo57 signer" } = {}) {
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
  action = "OVERRIDE_DENY",
  justificationCode = "OPS_EMERGENCY_CONTROL",
  justification = "manual emergency control operation",
  operatorId = "op_noo57_oncall",
  caseIdPrefix = "emergency_control"
} = {}) {
  operatorActionSeq += 1;
  return signOperatorActionV1({
    action: {
      actionId: `oa_noo57_${operatorActionSeq}`,
      caseRef: { kind: "escalation", caseId: `${caseIdPrefix}_${operatorActionSeq}` },
      action,
      justificationCode,
      justification,
      actor: { operatorId, role: "oncall", tenantId: "tenant_default" },
      actedAt: new Date().toISOString()
    },
    publicKeyPem: signer.publicKeyPem,
    privateKeyPem: signer.privateKeyPem
  });
}

async function registerAgent(api, { agentId }) {
  const { publicKeyPem } = createEd25519Keypair();
  const created = await request(api, {
    method: "POST",
    path: "/agents/register",
    headers: { "x-idempotency-key": `noo57_agent_register_${agentId}` },
    body: {
      agentId,
      displayName: `Agent ${agentId}`,
      owner: { ownerType: "service", ownerId: "svc_noo57" },
      publicKeyPem
    }
  });
  assert.equal(created.statusCode, 201, created.body);
  return agentId;
}

async function createX402Gate(api, { gateId, payerAgentId, payeeAgentId, idempotencyKey }) {
  return await request(api, {
    method: "POST",
    path: "/x402/gate/create",
    headers: {
      "x-idempotency-key": idempotencyKey,
      "x-settld-protocol": "1.0"
    },
    body: {
      gateId,
      payerAgentId,
      payeeAgentId,
      amountCents: 1100,
      currency: "USD",
      autoFundPayerCents: 1100,
      holdbackBps: 0,
      disputeWindowDays: 0
    }
  });
}

async function authorizeX402Gate(api, { gateId, idempotencyKey }) {
  return await request(api, {
    method: "POST",
    path: "/x402/gate/authorize-payment",
    headers: {
      "x-idempotency-key": idempotencyKey,
      "x-settld-protocol": "1.0"
    },
    body: { gateId }
  });
}

test("API e2e: /ops/emergency endpoints enforce auth + invalid payload cases", async () => {
  const api = createEmergencyApi();
  const operatorSigner = await registerSignerKey(api, { purpose: "operator", description: "NOO-57 emergency operator signer" });

  const unauthorizedChecks = [
    { path: "/ops/emergency/pause", body: {} },
    { path: "/ops/emergency/quarantine", body: {} },
    { path: "/ops/emergency/kill-switch", body: {} },
    { path: "/ops/emergency/resume", body: {} }
  ];

  for (const check of unauthorizedChecks) {
    const unauthorized = await request(api, {
      method: "POST",
      path: check.path,
      body: check.body,
      auth: "none"
    });
    assert.equal(unauthorized.statusCode, 403, `${check.path} should reject missing auth`);
  }

  const invalidChecks = [
    { path: "/ops/emergency/pause", body: { scope: { type: "bogus" } } },
    { path: "/ops/emergency/quarantine", body: { scope: { type: "bogus" } } },
    { path: "/ops/emergency/kill-switch", body: { scope: { type: "bogus" } } },
    { path: "/ops/emergency/resume", body: { controlType: "bogus" } }
  ];

  for (const check of invalidChecks) {
    const operatorAction = buildSignedOperatorAction({
      signer: operatorSigner,
      caseIdPrefix: `invalid_${check.path.replaceAll("/", "_")}`
    });
    const invalid = await request(api, {
      method: "POST",
      path: check.path,
      headers: OPS_WRITE_HEADERS,
      body: { ...check.body, operatorAction }
    });
    assert.equal(invalid.statusCode, 400, `${check.path} should reject invalid payload`);
    assert.equal(invalid.json?.code, "SCHEMA_INVALID");
  }

  const missingOperatorAction = await request(api, {
    method: "POST",
    path: "/ops/emergency/pause",
    headers: OPS_WRITE_HEADERS,
    body: {
      reasonCode: "OPS_EMERGENCY_PAUSE",
      reason: "missing operator action"
    }
  });
  assert.equal(missingOperatorAction.statusCode, 400, missingOperatorAction.body);
  assert.equal(missingOperatorAction.json?.code, "OPERATOR_ACTION_REQUIRED");

  const unknownSigner = createEd25519Keypair();
  const operatorActionWithUnknownSigner = signOperatorActionV1({
    action: {
      actionId: "oa_unknown_signer",
      caseRef: { kind: "escalation", caseId: "unknown_signer_case" },
      action: "OVERRIDE_DENY",
      justificationCode: "OPS_EMERGENCY_CONTROL",
      justification: "unknown signer validation",
      actor: { operatorId: "op_noo57_oncall", role: "oncall", tenantId: "tenant_default" },
      actedAt: new Date().toISOString()
    },
    publicKeyPem: unknownSigner.publicKeyPem,
    privateKeyPem: unknownSigner.privateKeyPem
  });
  const unknownSignerRejected = await request(api, {
    method: "POST",
    path: "/ops/emergency/pause",
    headers: OPS_WRITE_HEADERS,
    body: {
      reasonCode: "OPS_EMERGENCY_PAUSE",
      reason: "unknown signer should be rejected",
      operatorAction: operatorActionWithUnknownSigner
    }
  });
  assert.equal(unknownSignerRejected.statusCode, 409, unknownSignerRejected.body);
  assert.equal(unknownSignerRejected.json?.code, "OPERATOR_ACTION_SIGNER_UNKNOWN");

  const revokedSigner = await registerSignerKey(api, { purpose: "operator", description: "NOO-57 revoked signer" });
  const revokeResponse = await request(api, {
    method: "POST",
    path: `/ops/signer-keys/${encodeURIComponent(revokedSigner.keyId)}/revoke`,
    headers: OPS_WRITE_HEADERS,
    body: {}
  });
  assert.equal(revokeResponse.statusCode, 200, revokeResponse.body);
  const revokedAction = buildSignedOperatorAction({ signer: revokedSigner, caseIdPrefix: "revoked_signer_case" });
  const revokedSignerRejected = await request(api, {
    method: "POST",
    path: "/ops/emergency/pause",
    headers: OPS_WRITE_HEADERS,
    body: {
      reasonCode: "OPS_EMERGENCY_PAUSE",
      reason: "revoked signer should be rejected",
      operatorAction: revokedAction
    }
  });
  assert.equal(revokedSignerRejected.statusCode, 409, revokedSignerRejected.body);
  assert.equal(revokedSignerRejected.json?.code, "OPERATOR_ACTION_SIGNER_REVOKED");
});

test("API e2e: emergency pause blocks paid execution immediately; resume unblocks", async () => {
  const api = createEmergencyApi();
  const operatorSigner = await registerSignerKey(api, { purpose: "operator", description: "NOO-57 pause signer" });

  const payerBefore = await registerAgent(api, { agentId: "agt_noo57_pause_payer_before" });
  const payeeBefore = await registerAgent(api, { agentId: "agt_noo57_pause_payee_before" });

  const gateBeforePause = await createX402Gate(api, {
    gateId: "gate_noo57_pause_before",
    payerAgentId: payerBefore,
    payeeAgentId: payeeBefore,
    idempotencyKey: "noo57_pause_gate_before"
  });
  assert.equal(gateBeforePause.statusCode, 201, gateBeforePause.body);

  const pause = await request(api, {
    method: "POST",
    path: "/ops/emergency/pause",
    headers: OPS_WRITE_HEADERS,
    body: {
      reasonCode: "OPS_EMERGENCY_PAUSE",
      reason: "manual incident response",
      operatorAction: buildSignedOperatorAction({
        signer: operatorSigner,
        caseIdPrefix: "pause_enable_case",
        justificationCode: "OPS_EMERGENCY_PAUSE"
      })
    }
  });
  assertCreatedOrOk(pause);
  assert.equal(pause.json?.action, "pause");
  assert.equal(pause.json?.controlType, "pause");

  const blocked = await createX402Gate(api, {
    gateId: "gate_noo57_pause_blocked",
    payerAgentId: payerBefore,
    payeeAgentId: payeeBefore,
    idempotencyKey: "noo57_pause_gate_blocked"
  });
  assert.equal(blocked.statusCode, 409, blocked.body);
  assert.equal(blocked.json?.code, "EMERGENCY_PAUSE_ACTIVE");

  const resume = await request(api, {
    method: "POST",
    path: "/ops/emergency/resume",
    headers: OPS_WRITE_HEADERS,
    body: {
      controlType: "pause",
      reasonCode: "OPS_EMERGENCY_RESUME",
      reason: "manual recovery complete",
      operatorAction: buildSignedOperatorAction({
        signer: operatorSigner,
        action: "OVERRIDE_ALLOW",
        caseIdPrefix: "pause_resume_case",
        justificationCode: "OPS_EMERGENCY_RESUME"
      })
    }
  });
  assert.equal(resume.statusCode, 200, resume.body);
  assert.equal(resume.json?.action, "resume");
  assert.deepEqual(resume.json?.resumeControlTypes, ["pause"]);

  const payerAfter = await registerAgent(api, { agentId: "agt_noo57_pause_payer_after" });
  const payeeAfter = await registerAgent(api, { agentId: "agt_noo57_pause_payee_after" });
  const gateAfterResume = await createX402Gate(api, {
    gateId: "gate_noo57_pause_after",
    payerAgentId: payerAfter,
    payeeAgentId: payeeAfter,
    idempotencyKey: "noo57_pause_gate_after"
  });
  assert.equal(gateAfterResume.statusCode, 201, gateAfterResume.body);
});

test("API e2e: emergency quarantine blocks paid execution immediately; resume unblocks", async () => {
  const api = createEmergencyApi();
  const operatorSigner = await registerSignerKey(api, { purpose: "operator", description: "NOO-57 quarantine signer" });

  const payerBefore = await registerAgent(api, { agentId: "agt_noo57_quarantine_payer_before" });
  const payeeBefore = await registerAgent(api, { agentId: "agt_noo57_quarantine_payee_before" });

  const gateBeforeQuarantine = await createX402Gate(api, {
    gateId: "gate_noo57_quarantine_before",
    payerAgentId: payerBefore,
    payeeAgentId: payeeBefore,
    idempotencyKey: "noo57_quarantine_gate_before"
  });
  assert.equal(gateBeforeQuarantine.statusCode, 201, gateBeforeQuarantine.body);

  const quarantine = await request(api, {
    method: "POST",
    path: "/ops/emergency/quarantine",
    headers: OPS_WRITE_HEADERS,
    body: {
      reasonCode: "OPS_EMERGENCY_QUARANTINE",
      reason: "manual incident response",
      operatorAction: buildSignedOperatorAction({
        signer: operatorSigner,
        caseIdPrefix: "quarantine_enable_case",
        justificationCode: "OPS_EMERGENCY_QUARANTINE"
      })
    }
  });
  assertCreatedOrOk(quarantine);
  assert.equal(quarantine.json?.action, "quarantine");
  assert.equal(quarantine.json?.controlType, "quarantine");

  const blocked = await createX402Gate(api, {
    gateId: "gate_noo57_quarantine_blocked",
    payerAgentId: payerBefore,
    payeeAgentId: payeeBefore,
    idempotencyKey: "noo57_quarantine_gate_blocked"
  });
  assert.equal(blocked.statusCode, 409, blocked.body);
  assert.equal(blocked.json?.code, "EMERGENCY_QUARANTINE_ACTIVE");

  const resume = await request(api, {
    method: "POST",
    path: "/ops/emergency/resume",
    headers: OPS_WRITE_HEADERS,
    body: {
      controlType: "quarantine",
      reasonCode: "OPS_EMERGENCY_RESUME",
      reason: "manual recovery complete",
      operatorAction: buildSignedOperatorAction({
        signer: operatorSigner,
        action: "OVERRIDE_ALLOW",
        caseIdPrefix: "quarantine_resume_case",
        justificationCode: "OPS_EMERGENCY_RESUME"
      })
    }
  });
  assert.equal(resume.statusCode, 200, resume.body);
  assert.equal(resume.json?.action, "resume");
  assert.deepEqual(resume.json?.resumeControlTypes, ["quarantine"]);

  const payerAfter = await registerAgent(api, { agentId: "agt_noo57_quarantine_payer_after" });
  const payeeAfter = await registerAgent(api, { agentId: "agt_noo57_quarantine_payee_after" });
  const gateAfterResume = await createX402Gate(api, {
    gateId: "gate_noo57_quarantine_after",
    payerAgentId: payerAfter,
    payeeAgentId: payeeAfter,
    idempotencyKey: "noo57_quarantine_gate_after"
  });
  assert.equal(gateAfterResume.statusCode, 201, gateAfterResume.body);
});

test("API e2e: emergency kill-switch blocks authorize path immediately; resume unblocks", async () => {
  const api = createEmergencyApi();
  const operatorSigner = await registerSignerKey(api, { purpose: "operator", description: "NOO-57 kill-switch signer" });

  const payerBefore = await registerAgent(api, { agentId: "agt_noo57_kill_switch_payer_before" });
  const payeeBefore = await registerAgent(api, { agentId: "agt_noo57_kill_switch_payee_before" });
  const gateBeforeKillSwitch = await createX402Gate(api, {
    gateId: "gate_noo57_kill_switch_before",
    payerAgentId: payerBefore,
    payeeAgentId: payeeBefore,
    idempotencyKey: "noo57_kill_switch_gate_before"
  });
  assert.equal(gateBeforeKillSwitch.statusCode, 201, gateBeforeKillSwitch.body);

  const enableKillSwitch = await request(api, {
    method: "POST",
    path: "/ops/emergency/kill-switch",
    headers: OPS_WRITE_HEADERS,
    body: {
      reasonCode: "OPS_EMERGENCY_KILL_SWITCH",
      reason: "manual incident response",
      operatorAction: buildSignedOperatorAction({
        signer: operatorSigner,
        caseIdPrefix: "kill_switch_enable_case",
        justificationCode: "OPS_EMERGENCY_KILL_SWITCH"
      })
    }
  });
  assertCreatedOrOk(enableKillSwitch);
  assert.equal(enableKillSwitch.json?.action, "kill-switch");
  assert.equal(enableKillSwitch.json?.controlType, "kill-switch");

  const blockedAuthorize = await authorizeX402Gate(api, {
    gateId: "gate_noo57_kill_switch_before",
    idempotencyKey: "noo57_kill_switch_authorize_blocked"
  });
  assert.equal(blockedAuthorize.statusCode, 409, blockedAuthorize.body);
  assert.equal(blockedAuthorize.json?.code, "EMERGENCY_KILL_SWITCH_ACTIVE");

  const resume = await request(api, {
    method: "POST",
    path: "/ops/emergency/resume",
    headers: OPS_WRITE_HEADERS,
    body: {
      controlType: "kill-switch",
      reasonCode: "OPS_EMERGENCY_RESUME",
      reason: "manual recovery complete",
      operatorAction: buildSignedOperatorAction({
        signer: operatorSigner,
        action: "OVERRIDE_ALLOW",
        caseIdPrefix: "kill_switch_resume_case",
        justificationCode: "OPS_EMERGENCY_RESUME"
      })
    }
  });
  assert.equal(resume.statusCode, 200, resume.body);
  assert.equal(resume.json?.action, "resume");
  assert.deepEqual(resume.json?.resumeControlTypes, ["kill-switch"]);

  const payerAfter = await registerAgent(api, { agentId: "agt_noo57_kill_switch_payer_after" });
  const payeeAfter = await registerAgent(api, { agentId: "agt_noo57_kill_switch_payee_after" });
  const gateAfterResume = await createX402Gate(api, {
    gateId: "gate_noo57_kill_switch_after",
    payerAgentId: payerAfter,
    payeeAgentId: payeeAfter,
    idempotencyKey: "noo57_kill_switch_gate_after"
  });
  assert.equal(gateAfterResume.statusCode, 201, gateAfterResume.body);

  const authorizeAfterResume = await authorizeX402Gate(api, {
    gateId: "gate_noo57_kill_switch_after",
    idempotencyKey: "noo57_kill_switch_authorize_after"
  });
  assert.equal(authorizeAfterResume.statusCode, 200, authorizeAfterResume.body);
});
