import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createEd25519Keypair } from "../src/core/crypto.js";
import {
  buildSubAgentCompletionReceiptV1,
  completeSubAgentWorkOrderV1,
  validateSubAgentCompletionReceiptV1,
  validateSubAgentWorkOrderV1
} from "../src/core/subagent-work-order.js";
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
      owner: { ownerType: "service", ownerId: "svc_action_wallet_test" },
      publicKeyPem,
      capabilities
    }
  });
  assert.equal(response.statusCode, 201, response.body);
}

async function issueDelegationGrant(api, { grantId, delegatorAgentId, delegateeAgentId, capability }) {
  const response = await request(api, {
    method: "POST",
    path: "/delegation-grants",
    headers: { "x-idempotency-key": `delegation_grant_${grantId}` },
    body: {
      grantId,
      delegatorAgentId,
      delegateeAgentId,
      scope: {
        allowedProviderIds: [delegateeAgentId],
        allowedToolIds: ["workflow_intake"],
        allowedRiskClasses: ["financial"],
        sideEffectingAllowed: true
      },
      spendLimit: {
        currency: "USD",
        maxPerCallCents: 25_000,
        maxTotalCents: 25_000
      },
      chainBinding: {
        depth: 0,
        maxDelegationDepth: 1
      },
      validity: {
        issuedAt: "2026-03-08T16:00:00.000Z",
        notBefore: "2026-03-08T16:00:00.000Z",
        expiresAt: "2027-03-08T16:00:00.000Z"
      }
    }
  });
  assert.equal(response.statusCode, 201, response.body);
}

async function creditWallet(api, { tenantId = "tenant_default", agentId, amountCents, idempotencyKey }) {
  const response = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/wallet/credit`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": idempotencyKey
    },
    body: {
      amountCents,
      currency: "USD"
    }
  });
  assert.equal(response.statusCode, 201, response.body);
}

async function createCompletedRun(api, { tenantId = "tenant_default", payerAgentId, payeeAgentId, runId, amountCents, idempotencyPrefix }) {
  const created = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(payeeAgentId)}/runs`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": `${idempotencyPrefix}_create`
    },
    body: {
      runId,
      taskType: "analysis",
      settlement: {
        payerAgentId,
        amountCents,
        currency: "USD",
        disputeWindowDays: 5
      }
    }
  });
  assert.equal(created.statusCode, 201, created.body);

  const completed = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(payeeAgentId)}/runs/${encodeURIComponent(runId)}/events`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": `${idempotencyPrefix}_complete`,
      "x-proxy-expected-prev-chain-hash": created.json?.run?.lastChainHash
    },
    body: {
      type: "RUN_COMPLETED",
      payload: { outputRef: `evidence://${runId}/output.json` }
    }
  });
  assert.equal(completed.statusCode, 201, completed.body);
}

function buildVerifierVerdict({
  status = "pass",
  verificationStatus = undefined,
  reasonCodes = [],
  verifierId = "nooterra.action-wallet-verifier"
} = {}) {
  return {
    status,
    ...(verificationStatus === undefined ? {} : { verificationStatus }),
    verifierRef: {
      verifierId,
      verifierVersion: "v1",
      verifierHash: null,
      modality: "deterministic"
    },
    reasonCodes
  };
}

async function createMaterializedActionWallet(api, { suffix }) {
  const principalAgentId = `agt_action_wallet_principal_${suffix}`;
  const subAgentId = `agt_action_wallet_worker_${suffix}`;
  const capability = "capability://workflow.intake";
  const grantId = `dgrant_action_wallet_${suffix}`;
  const workOrderId = `workord_action_wallet_${suffix}`;

  await registerAgent(api, { agentId: principalAgentId, capabilities: [capability] });
  await registerAgent(api, { agentId: subAgentId, capabilities: [capability] });
  await issueDelegationGrant(api, {
    grantId,
    delegatorAgentId: principalAgentId,
    delegateeAgentId: subAgentId,
    capability
  });

  const seededBlockedWorkOrder = await request(api, {
    method: "POST",
    path: "/work-orders",
    headers: { "x-idempotency-key": `v1_action_wallet_seed_${suffix}_1` },
    body: {
      workOrderId,
      principalAgentId,
      subAgentId,
      requiredCapability: capability,
      pricing: {
        amountCents: 1900,
        currency: "USD",
        quoteId: `quote_action_wallet_${suffix}_seed`
      },
      constraints: {
        maxDurationSeconds: 300,
        maxCostCents: 1900,
        retryLimit: 1
      },
      delegationGrantRef: grantId,
      approvalMode: "require",
      approvalPolicy: {
        requireApprovalAboveCents: 0,
        strictEvidenceRefs: true
      },
      traceId: `trace_action_wallet_${suffix}_seed`
    }
  });
  assert.equal(seededBlockedWorkOrder.statusCode, 409, seededBlockedWorkOrder.body);
  const authorityEnvelope = seededBlockedWorkOrder.json?.details?.authorityEnvelope;
  const seededApprovalRequest = seededBlockedWorkOrder.json?.details?.approvalRequest;
  assert.ok(authorityEnvelope?.envelopeId);
  assert.ok(seededApprovalRequest?.requestId);

  const actionIntent = await request(api, {
    method: "POST",
    path: "/v1/action-intents",
    headers: { "x-idempotency-key": `v1_action_intent_create_${suffix}_1` },
    body: {
      actionIntentId: authorityEnvelope.envelopeId,
      authorityEnvelope,
      host: {
        runtime: "claude-desktop",
        channel: "mcp",
        source: "test"
      }
    }
  });
  assert.equal(actionIntent.statusCode, 200, actionIntent.body);

  const approvalRequested = await request(api, {
    method: "POST",
    path: `/v1/action-intents/${encodeURIComponent(authorityEnvelope.envelopeId)}/approval-requests`,
    headers: { "x-idempotency-key": `v1_action_intent_request_${suffix}_1` },
    body: {
      approvalRequest: seededApprovalRequest,
      requestedBy: seededApprovalRequest.requestedBy
    }
  });
  assert.equal(approvalRequested.statusCode, 200, approvalRequested.body);
  const approvalRequest = approvalRequested.json?.approvalRequest;
  assert.ok(approvalRequest?.requestId);

  const approved = await request(api, {
    method: "POST",
    path: `/v1/approval-requests/${encodeURIComponent(approvalRequest.requestId)}/decisions`,
    headers: { "x-idempotency-key": `v1_action_intent_decide_${suffix}_1` },
    body: {
      approved: true,
      decidedBy: "human.ops",
      decidedAt: "2026-03-08T16:05:00.000Z",
      note: `Approved from Action Wallet ${suffix} e2e test`,
      evidenceRefs: [`ticket:NOO-ACTION-WALLET-${suffix}`]
    }
  });
  assert.equal(approved.statusCode, 201, approved.body);

  const createdWorkOrder = await request(api, {
    method: "POST",
    path: "/work-orders",
    headers: { "x-idempotency-key": `v1_action_wallet_materialize_${suffix}_1` },
    body: {
      workOrderId,
      principalAgentId,
      subAgentId,
      requiredCapability: capability,
      pricing: {
        amountCents: 1900,
        currency: "USD",
        quoteId: `quote_action_wallet_${suffix}_1`
      },
      constraints: {
        maxDurationSeconds: 300,
        maxCostCents: 1900,
        retryLimit: 1
      },
      delegationGrantRef: grantId,
      approvalMode: "require",
      approvalPolicy: {
        requireApprovalAboveCents: 0,
        strictEvidenceRefs: true
      },
      traceId: `trace_action_wallet_${suffix}_1`,
      authorityEnvelope: approvalRequested.json?.authorityEnvelope,
      approvalRequest,
      approvalDecision: approved.json?.approvalDecision
    }
  });
  assert.equal(createdWorkOrder.statusCode, 201, createdWorkOrder.body);

  return {
    authorityEnvelope,
    approvalRequest,
    approvalDecision: approved.json?.approvalDecision,
    principalAgentId,
    subAgentId,
    capability,
    grantId,
    workOrderId,
    workOrder: createdWorkOrder.json?.workOrder
  };
}

async function openDisputeCase(api, {
  tenantId = "tenant_default",
  runId,
  disputeId,
  caseId,
  payerAgentId,
  arbiterAgentId,
  idempotencyPrefix,
  reason
}) {
  const dispute = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(runId)}/dispute/open`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": `${idempotencyPrefix}_dispute`
    },
    body: {
      disputeId,
      reason,
      openedByAgentId: payerAgentId,
      evidenceRefs: [`evidence://${runId}/dispute-open.json`]
    }
  });
  assert.equal(dispute.statusCode, 200, dispute.body);
  assert.equal(dispute.json?.settlement?.disputeStatus, "open");

  const arbitration = await request(api, {
    method: "POST",
    path: `/runs/${encodeURIComponent(runId)}/arbitration/open`,
    headers: {
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": `${idempotencyPrefix}_case`
    },
    body: {
      disputeId,
      caseId,
      arbiterAgentId
    }
  });
  assert.equal(arbitration.statusCode, 201, arbitration.body);
}

test("API e2e: v1 action wallet logs draft and approval-required transitions for a new intent", async () => {
  const api = createApi({ now: () => "2026-03-08T15:30:00.000Z", opsToken: "tok_ops" });
  const actionIntentId = "aint_action_wallet_transition_1";

  const createdIntent = await request(api, {
    method: "POST",
    path: "/v1/action-intents",
    headers: { "x-idempotency-key": "v1_action_intent_create_transition_1" },
    body: {
      actionIntentId,
      actorAgentId: "agt_action_wallet_host_transition",
      principalId: "usr_action_wallet_transition",
      purpose: "Buy a charger under $40",
      capabilitiesRequested: ["capability://workflow.intake"],
      spendEnvelope: {
        currency: "USD",
        maxPerCallCents: 4_000,
        maxTotalCents: 4_000
      },
      evidenceRequirements: ["order_confirmation", "merchant_receipt"],
      host: {
        runtime: "claude-desktop",
        channel: "mcp",
        source: "test"
      }
    }
  });
  assert.equal(createdIntent.statusCode, 201, createdIntent.body);
  assert.equal(createdIntent.json?.actionIntent?.status, "draft");
  assert.equal(createdIntent.json?.actionIntent?.intentHash, createdIntent.json?.authorityEnvelope?.envelopeHash);

  const fetchedDraft = await request(api, {
    method: "GET",
    path: `/v1/action-intents/${encodeURIComponent(actionIntentId)}`
  });
  assert.equal(fetchedDraft.statusCode, 200, fetchedDraft.body);
  assert.equal(fetchedDraft.json?.actionIntent?.status, "draft");
  assert.equal(fetchedDraft.json?.approvalRequest, null);
  assert.equal(fetchedDraft.json?.approvalStatus, null);
  assert.equal(fetchedDraft.json?.executionGrant, null);

  const approvalRequested = await request(api, {
    method: "POST",
    path: `/v1/action-intents/${encodeURIComponent(actionIntentId)}/approval-requests`,
    headers: { "x-idempotency-key": "v1_action_intent_request_transition_1" },
    body: {
      requestId: "apr_action_wallet_transition_1",
      requestedBy: "agt_action_wallet_host_transition"
    }
  });
  assert.equal(approvalRequested.statusCode, 201, approvalRequested.body);
  assert.equal(approvalRequested.json?.actionIntent?.status, "approval_required");
  assert.equal(approvalRequested.json?.approvalStatus, "pending");

  const fetchedApprovalRequired = await request(api, {
    method: "GET",
    path: `/v1/action-intents/${encodeURIComponent(actionIntentId)}`
  });
  assert.equal(fetchedApprovalRequired.statusCode, 200, fetchedApprovalRequired.body);
  assert.equal(fetchedApprovalRequired.json?.actionIntent?.status, "approval_required");
  assert.equal(fetchedApprovalRequired.json?.approvalRequest?.requestId, "apr_action_wallet_transition_1");
  assert.equal(fetchedApprovalRequired.json?.approvalStatus, "pending");
  assert.equal(fetchedApprovalRequired.json?.approvalUrl, "/approvals?requestId=apr_action_wallet_transition_1");
  assert.equal(fetchedApprovalRequired.json?.executionGrant?.executionGrantId, "apr_action_wallet_transition_1");
  assert.equal(fetchedApprovalRequired.json?.executionGrant?.status, "approval_requested");

  const transitionAudits = (await api.store.listOpsAudit({ tenantId: "tenant_default", limit: 200, offset: 0 }))
    .filter((row) => row?.action === "ACTION_WALLET_INTENT_TRANSITION" && row?.targetId === actionIntentId)
    .sort((left, right) => Number(left?.id ?? 0) - Number(right?.id ?? 0));
  const transitions = transitionAudits.flatMap((row) => row?.details?.transitions ?? []);
  assert.deepEqual(
    transitions.map((row) => `${row?.previousState ?? "<initial>"}->${row?.nextState}:${row?.lifecycleEvent}`),
    ["<initial>->draft:intent.created", "draft->approval_required:approval.opened"]
  );
});

test("API e2e: v1 action-intent create and integration install replay identical writes and fail closed on conflicts", async () => {
  const api = createApi({ now: () => "2026-03-08T15:40:00.000Z", opsToken: "tok_ops" });
  const createBody = {
    actionIntentId: "aint_action_wallet_idempotency_1",
    actorAgentId: "agt_action_wallet_host_idempotency",
    principalId: "usr_action_wallet_idempotency",
    purpose: "Buy a charger under $40",
    capabilitiesRequested: ["capability://workflow.intake"],
    spendEnvelope: {
      currency: "USD",
      maxPerCallCents: 4_000,
      maxTotalCents: 4_000
    },
    evidenceRequirements: ["order_confirmation", "merchant_receipt"],
    host: {
      runtime: "claude-desktop",
      channel: "mcp",
      source: "test"
    }
  };

  const createdIntent = await request(api, {
    method: "POST",
    path: "/v1/action-intents",
    headers: { "x-idempotency-key": "v1_action_intent_create_idempotency_1" },
    body: createBody
  });
  assert.equal(createdIntent.statusCode, 201, createdIntent.body);

  const replayedIntent = await request(api, {
    method: "POST",
    path: "/v1/action-intents",
    headers: { "x-idempotency-key": "v1_action_intent_create_idempotency_1" },
    body: createBody
  });
  assert.equal(replayedIntent.statusCode, 201, replayedIntent.body);
  assert.deepEqual(replayedIntent.json, createdIntent.json);

  const conflictingIntent = await request(api, {
    method: "POST",
    path: "/v1/action-intents",
    headers: { "x-idempotency-key": "v1_action_intent_create_idempotency_1" },
    body: {
      ...createBody,
      purpose: "Buy a charger under $35"
    }
  });
  assert.equal(conflictingIntent.statusCode, 409, conflictingIntent.body);
  assert.equal(conflictingIntent.json?.error, "idempotency key conflict");

  const installBody = { runtime: "openclaw" };
  const install = await request(api, {
    method: "POST",
    path: "/v1/integrations/install",
    headers: {
      "x-idempotency-key": "v1_action_wallet_install_idempotency_1",
      "x-nooterra-protocol": "1.0"
    },
    body: installBody
  });
  assert.equal(install.statusCode, 200, install.body);
  assert.equal(install.json?.integration?.runtime, "openclaw");
  assert.equal(install.json?.trustedHost?.runtime, "openclaw");
  assert.equal(install.json?.trustedHost?.channel, "OpenClaw");
  assert.equal(install.json?.trustedHost?.hostId, "host_openclaw");
  assert.equal(install.json?.trustedHost?.authModel?.type, "none");
  const storedTrustedHost = api.store.trustedHosts.get("tenant_default\nhost_openclaw");
  assert.equal(storedTrustedHost?.runtime, "openclaw");

  const replayedInstall = await request(api, {
    method: "POST",
    path: "/v1/integrations/install",
    headers: {
      "x-idempotency-key": "v1_action_wallet_install_idempotency_1",
      "x-nooterra-protocol": "1.0"
    },
    body: installBody
  });
  assert.equal(replayedInstall.statusCode, 200, replayedInstall.body);
  assert.deepEqual(replayedInstall.json, install.json);

  const conflictingInstall = await request(api, {
    method: "POST",
    path: "/v1/integrations/install",
    headers: {
      "x-idempotency-key": "v1_action_wallet_install_idempotency_1",
      "x-nooterra-protocol": "1.0"
    },
    body: { runtime: "claude-desktop" }
  });
  assert.equal(conflictingInstall.statusCode, 409, conflictingInstall.body);
  assert.equal(conflictingInstall.json?.error, "idempotency key conflict");
});

test("API e2e: v1 dispute alias read returns the current dispute case detail", async () => {
  const api = createApi({ now: () => "2026-03-08T15:50:00.000Z", opsToken: "tok_ops" });
  const tenantId = "tenant_default";
  const payerAgentId = "agt_action_wallet_dispute_payer";
  const payeeAgentId = "agt_action_wallet_dispute_payee";
  const arbiterAgentId = "agt_action_wallet_dispute_arbiter";
  const runId = "run_action_wallet_dispute_1";
  const disputeId = "dsp_action_wallet_alias_1";
  const caseId = "arb_case_action_wallet_alias_1";

  await registerAgent(api, { agentId: payerAgentId });
  await registerAgent(api, { agentId: payeeAgentId });
  await registerAgent(api, { agentId: arbiterAgentId });
  await creditWallet(api, {
    tenantId,
    agentId: payerAgentId,
    amountCents: 20_000,
    idempotencyKey: "credit_action_wallet_dispute_alias_1"
  });
  await createCompletedRun(api, {
    tenantId,
    payerAgentId,
    payeeAgentId,
    runId,
    amountCents: 1_500,
    idempotencyPrefix: "action_wallet_dispute_alias_1"
  });
  await openDisputeCase(api, {
    tenantId,
    runId,
    disputeId,
    caseId,
    payerAgentId,
    arbiterAgentId,
    idempotencyPrefix: "action_wallet_dispute_alias_1",
    reason: "Need refund review"
  });

  const disputeRead = await request(api, {
    method: "GET",
    path: `/v1/disputes/${encodeURIComponent(disputeId)}?caseId=${encodeURIComponent(caseId)}`
  });
  assert.equal(disputeRead.statusCode, 200, disputeRead.body);
  assert.equal(disputeRead.json?.disputeCase?.disputeId, disputeId);
  assert.equal(disputeRead.json?.disputeCase?.caseId, caseId);
  assert.equal(disputeRead.json?.disputeCase?.status, "triaged");
  assert.equal(disputeRead.json?.detail?.runId, runId);
  assert.equal(disputeRead.json?.detail?.caseId, caseId);
  assert.ok(Array.isArray(disputeRead.json?.detail?.timeline));
  assert.ok(disputeRead.json?.detail?.timeline.some((row) => row?.eventType === "dispute.opened"));
  assert.ok(disputeRead.json?.detail?.timeline.some((row) => row?.eventType === "arbitration.opened"));
});

test("API e2e: v1 integration install registers sanitized trusted-host metadata and rejects unsupported runtimes", async () => {
  const api = createApi({ now: () => "2026-03-08T15:41:00.000Z", opsToken: "tok_ops" });

  const install = await request(api, {
    method: "POST",
    path: "/v1/integrations/install",
    headers: {
      "x-idempotency-key": "v1_action_wallet_install_trusted_host_1",
      "x-nooterra-protocol": "1.0"
    },
    body: {
      runtime: "claude",
      hostId: "host_partner_claude",
      hostName: "Partner Claude",
      callbackUrls: ["https://partner.example/callback"],
      environment: "staging",
      authModel: {
        type: "client_secret",
        clientSecret: "host_secret_1234"
      }
    }
  });
  assert.equal(install.statusCode, 200, install.body);
  assert.equal(install.json?.integration?.runtime, "claude-desktop");
  assert.equal(install.json?.trustedHost?.hostId, "host_partner_claude");
  assert.equal(install.json?.trustedHost?.channel, "Claude MCP");
  assert.equal(install.json?.trustedHost?.authModel?.type, "client_secret");
  assert.equal(install.json?.trustedHost?.authModel?.clientSecretConfigured, true);
  assert.equal(install.json?.trustedHost?.authModel?.clientSecretLast4, "1234");
  assert.equal(install.body.includes("host_secret_1234"), false);

  const storedTrustedHost = api.store.trustedHosts.get("tenant_default\nhost_partner_claude");
  assert.equal(storedTrustedHost?.runtime, "claude-desktop");
  assert.equal(storedTrustedHost?.authModel?.clientSecretLast4, "1234");
  assert.equal(typeof storedTrustedHost?.authModel?.clientSecretHash, "string");

  const unsupportedInstall = await request(api, {
    method: "POST",
    path: "/v1/integrations/install",
    headers: {
      "x-idempotency-key": "v1_action_wallet_install_trusted_host_2",
      "x-nooterra-protocol": "1.0"
    },
    body: {
      runtime: "chatgpt"
    }
  });
  assert.equal(unsupportedInstall.statusCode, 400, unsupportedInstall.body);
  assert.equal(unsupportedInstall.json?.code, "INVALID_TRUSTED_HOST");
  assert.deepEqual(unsupportedInstall.json?.details?.supportedRuntimes, ["claude-desktop", "openclaw"]);
});

test("API e2e: v1 integration install can issue scoped host credentials that fail closed off-host routes", async () => {
  const api = createApi({ now: () => "2026-03-08T15:42:00.000Z", opsToken: "tok_ops" });

  const install = await request(api, {
    method: "POST",
    path: "/v1/integrations/install",
    headers: {
      "x-idempotency-key": "v1_action_wallet_install_host_credential_1",
      "x-nooterra-protocol": "1.0"
    },
    body: {
      runtime: "openclaw",
      hostId: "host_partner_openclaw",
      authModel: {
        type: "client_secret"
      }
    }
  });
  assert.equal(install.statusCode, 200, install.body);
  assert.equal(install.json?.trustedHost?.authModel?.type, "client_secret");
  assert.equal(typeof install.json?.trustedHost?.authModel?.keyId, "string");
  assert.equal(typeof install.json?.trustedHost?.authModel?.lastIssuedAt, "string");
  assert.equal(install.json?.hostCredential?.kind, "api_key");
  assert.equal(install.json?.hostCredential?.keyId, install.json?.trustedHost?.authModel?.keyId);
  assert.deepEqual(install.json?.hostCredential?.scopes, ["action_wallet_host"]);

  const hostActionIntent = await request(api, {
    method: "POST",
    path: "/v1/action-intents",
    auth: "none",
    headers: {
      authorization: `Bearer ${install.json?.hostCredential?.token ?? ""}`,
      "x-idempotency-key": "v1_action_wallet_host_credential_intent_1",
      "x-nooterra-protocol": "1.0"
    },
    body: {
      actionIntentId: "aint_action_wallet_host_credential_1",
      actorAgentId: "agt_action_wallet_host_openclaw",
      principalId: "usr_action_wallet_host_credential",
      purpose: "Buy a charger under $40",
      capabilitiesRequested: ["capability://workflow.intake"],
      spendEnvelope: {
        currency: "USD",
        maxPerCallCents: 4_000,
        maxTotalCents: 4_000
      },
      evidenceRequirements: ["order_confirmation", "merchant_receipt"],
      host: {
        runtime: "openclaw",
        channel: "mcp",
        source: "test"
      }
    }
  });
  assert.equal(hostActionIntent.statusCode, 201, hostActionIntent.body);
  assert.equal(hostActionIntent.json?.actionIntent?.status, "draft");

  const hostFetchedActionIntent = await request(api, {
    method: "GET",
    path: `/v1/action-intents/${encodeURIComponent(hostActionIntent.json?.actionIntent?.actionIntentId ?? "aint_missing")}`,
    auth: "none",
    headers: {
      authorization: `Bearer ${install.json?.hostCredential?.token ?? ""}`
    }
  });
  assert.equal(hostFetchedActionIntent.statusCode, 200, hostFetchedActionIntent.body);
  assert.equal(hostFetchedActionIntent.json?.actionIntent?.actionIntentId, "aint_action_wallet_host_credential_1");
  assert.equal(hostFetchedActionIntent.json?.actionIntent?.status, "draft");

  const forbiddenOffRoute = await request(api, {
    method: "GET",
    path: "/ops/auth-keys",
    auth: "none",
    headers: {
      authorization: `Bearer ${install.json?.hostCredential?.token ?? ""}`
    }
  });
  assert.equal(forbiddenOffRoute.statusCode, 403, forbiddenOffRoute.body);
  assert.equal(forbiddenOffRoute.json?.code, "FORBIDDEN");
});

test("API e2e: trusted hosts and standing rules can be revoked through launch-safe control paths", async () => {
  const api = createApi({ now: () => "2026-03-08T15:43:00.000Z", opsToken: "tok_ops" });

  const install = await request(api, {
    method: "POST",
    path: "/v1/integrations/install",
    headers: {
      "x-idempotency-key": "v1_action_wallet_install_revoke_host_1",
      "x-nooterra-protocol": "1.0"
    },
    body: {
      runtime: "claude-desktop",
      hostId: "host_partner_claude_revoke",
      authModel: {
        type: "client_secret"
      }
    }
  });
  assert.equal(install.statusCode, 200, install.body);

  const revokedHost = await request(api, {
    method: "POST",
    path: "/v1/integrations/host_partner_claude_revoke/revoke",
    headers: {
      "x-idempotency-key": "v1_action_wallet_revoke_host_1",
      "x-nooterra-protocol": "1.0"
    },
    body: {
      reasonCode: "user_revoked"
    }
  });
  assert.equal(revokedHost.statusCode, 200, revokedHost.body);
  assert.equal(revokedHost.json?.trustedHost?.status, "revoked");

  const blockedHostAction = await request(api, {
    method: "POST",
    path: "/v1/action-intents",
    auth: "none",
    headers: {
      authorization: `Bearer ${install.json?.hostCredential?.token ?? ""}`,
      "x-idempotency-key": "v1_action_wallet_revoke_host_intent_1",
      "x-nooterra-protocol": "1.0"
    },
    body: {
      actionIntentId: "aint_action_wallet_revoked_host_1",
      actorAgentId: "agt_action_wallet_host_claude",
      principalId: "usr_action_wallet_revoked_host",
      purpose: "Buy a charger under $40",
      capabilitiesRequested: ["capability://workflow.intake"],
      spendEnvelope: {
        currency: "USD",
        maxPerCallCents: 4_000,
        maxTotalCents: 4_000
      },
      evidenceRequirements: ["order_confirmation", "merchant_receipt"],
      host: {
        runtime: "claude-desktop",
        channel: "mcp",
        source: "test"
      }
    }
  });
  assert.equal(blockedHostAction.statusCode, 403, blockedHostAction.body);

  const createdPolicy = await request(api, {
    method: "POST",
    path: "/approval-policies",
    headers: {
      "x-idempotency-key": "approval_policy_revoke_1",
      "x-nooterra-protocol": "1.0"
    },
    body: {
      policyId: "apol_action_wallet_revoke_1",
      principalRef: {
        principalType: "human",
        principalId: "usr_action_wallet_rule_revoke"
      },
      displayName: "Auto-approve chargers",
      constraints: {
        actorAgentIds: ["agt_action_wallet_host_claude"],
        maxSpendCents: 4_000
      },
      decision: {
        effect: "approve",
        evidenceRefs: ["policy:auto_approve"]
      }
    }
  });
  assert.equal(createdPolicy.statusCode, 201, createdPolicy.body);
  assert.equal(createdPolicy.json?.approvalStandingPolicy?.status, "active");

  const revokedPolicy = await request(api, {
    method: "POST",
    path: "/approval-policies/apol_action_wallet_revoke_1/revoke",
    headers: {
      "x-idempotency-key": "approval_policy_revoke_2",
      "x-nooterra-protocol": "1.0"
    },
    body: {
      reasonCode: "user_revoked"
    }
  });
  assert.equal(revokedPolicy.statusCode, 200, revokedPolicy.body);
  assert.equal(revokedPolicy.json?.approvalStandingPolicy?.status, "disabled");

  const fetchedPolicy = await request(api, {
    method: "GET",
    path: "/approval-policies/apol_action_wallet_revoke_1"
  });
  assert.equal(fetchedPolicy.statusCode, 200, fetchedPolicy.body);
  assert.equal(fetchedPolicy.json?.approvalStandingPolicy?.status, "disabled");
});

test("API e2e: matching standing rules auto-approve v1 approval requests and mint approved execution grants", async () => {
  const api = createApi({ now: () => "2026-03-08T15:44:00.000Z", opsToken: "tok_ops" });

  const createdPolicy = await request(api, {
    method: "POST",
    path: "/approval-policies",
    headers: {
      "x-idempotency-key": "approval_policy_action_wallet_auto_1"
    },
    body: {
      policyId: "apol_action_wallet_auto_1",
      principalRef: {
        principalType: "human",
        principalId: "usr_action_wallet_auto_policy"
      },
      displayName: "Auto approve bounded wallet actions from the trusted host",
      constraints: {
        actorAgentIds: ["agt_action_wallet_host_auto"],
        capabilitiesRequested: ["capability://workflow.intake"],
        maxSpendCents: 4_000,
        maxRiskClass: "low"
      },
      decision: {
        effect: "approve",
        decidedBy: "policy:auto-action-wallet",
        evidenceRefs: ["policy:apol_action_wallet_auto_1"]
      }
    }
  });
  assert.equal(createdPolicy.statusCode, 201, createdPolicy.body);

  const createdIntent = await request(api, {
    method: "POST",
    path: "/v1/action-intents",
    headers: {
      "x-idempotency-key": "v1_action_wallet_auto_policy_intent_1",
      "x-nooterra-protocol": "1.0"
    },
    body: {
      actionIntentId: "aint_action_wallet_auto_policy_1",
      actorAgentId: "agt_action_wallet_host_auto",
      principalId: "usr_action_wallet_auto_policy",
      purpose: "Buy a charger under $40",
      capabilitiesRequested: ["capability://workflow.intake"],
      spendEnvelope: {
        currency: "USD",
        maxPerCallCents: 4_000,
        maxTotalCents: 4_000
      },
      evidenceRequirements: ["order_confirmation", "merchant_receipt"],
      host: {
        runtime: "claude-desktop",
        channel: "mcp",
        source: "test"
      }
    }
  });
  assert.equal(createdIntent.statusCode, 201, createdIntent.body);

  const approvalRequested = await request(api, {
    method: "POST",
    path: "/v1/action-intents/aint_action_wallet_auto_policy_1/approval-requests",
    headers: {
      "x-idempotency-key": "v1_action_wallet_auto_policy_request_1",
      "x-nooterra-protocol": "1.0"
    },
    body: {
      requestId: "apr_action_wallet_auto_policy_1",
      requestedBy: "agt_action_wallet_host_auto",
      requestedAt: "2026-03-08T15:44:00.000Z"
    }
  });
  assert.equal(approvalRequested.statusCode, 201, approvalRequested.body);
  assert.equal(approvalRequested.json?.approvalStatus, "approved");
  assert.equal(approvalRequested.json?.actionIntent?.status, "approved");
  assert.equal(approvalRequested.json?.executionGrant?.status, "approved");
  assert.match(String(approvalRequested.json?.executionGrant?.grantHash ?? ""), /^[0-9a-f]{64}$/);

  const approvalStatus = await request(api, {
    method: "GET",
    path: "/v1/approval-requests/apr_action_wallet_auto_policy_1"
  });
  assert.equal(approvalStatus.statusCode, 200, approvalStatus.body);
  assert.equal(approvalStatus.json?.approvalStatus, "approved");
  assert.equal(approvalStatus.json?.approvalDecision?.approved, true);
  assert.equal(approvalStatus.json?.approvalDecision?.metadata?.source, "standing_policy");
  assert.equal(approvalStatus.json?.approvalDecision?.metadata?.policyId, "apol_action_wallet_auto_1");
  assert.equal(approvalStatus.json?.actionIntent?.status, "approved");

  const actionIntentStatus = await request(api, {
    method: "GET",
    path: "/v1/action-intents/aint_action_wallet_auto_policy_1"
  });
  assert.equal(actionIntentStatus.statusCode, 200, actionIntentStatus.body);
  assert.equal(actionIntentStatus.json?.approvalStatus, "approved");
  assert.equal(actionIntentStatus.json?.actionIntent?.status, "approved");
});

test("API e2e: v1 approval alias expires unresolved requests and blocks late decisions", async () => {
  const api = createApi({ now: () => "2026-03-08T16:10:00.000Z", opsToken: "tok_ops" });
  const actionIntentId = "aint_action_wallet_expired_1";

  const createdIntent = await request(api, {
    method: "POST",
    path: "/v1/action-intents",
    headers: { "x-idempotency-key": "v1_action_intent_create_expired_1" },
    body: {
      actionIntentId,
      actorAgentId: "agt_action_wallet_host_expired",
      principalId: "usr_action_wallet_expired",
      purpose: "Cancel a subscription before the cutoff",
      capabilitiesRequested: ["capability://workflow.intake"],
      spendEnvelope: {
        currency: "USD",
        maxPerCallCents: 0,
        maxTotalCents: 0
      },
      evidenceRequirements: ["cancellation_confirmation"],
      host: {
        runtime: "openclaw",
        channel: "mcp",
        source: "test"
      }
    }
  });
  assert.equal(createdIntent.statusCode, 201, createdIntent.body);

  const approvalRequested = await request(api, {
    method: "POST",
    path: `/v1/action-intents/${encodeURIComponent(actionIntentId)}/approval-requests`,
    headers: { "x-idempotency-key": "v1_action_intent_request_expired_1" },
    body: {
      requestId: "apr_action_wallet_expired_1",
      requestedBy: "agt_action_wallet_host_expired",
      requestedAt: "2026-03-08T16:00:00.000Z",
      approvalPolicy: {
        requireApprovalAboveCents: 0,
        strictEvidenceRefs: true,
        decisionTimeoutAt: "2026-03-08T16:05:00.000Z"
      }
    }
  });
  assert.equal(approvalRequested.statusCode, 201, approvalRequested.body);
  assert.equal(approvalRequested.json?.approvalStatus, "expired");

  const approvalStatus = await request(api, {
    method: "GET",
    path: "/v1/approval-requests/apr_action_wallet_expired_1"
  });
  assert.equal(approvalStatus.statusCode, 200, approvalStatus.body);
  assert.equal(approvalStatus.json?.approvalStatus, "expired");

  const lateDecision = await request(api, {
    method: "POST",
    path: "/v1/approval-requests/apr_action_wallet_expired_1/decisions",
    headers: { "x-idempotency-key": "v1_action_intent_decide_expired_1" },
    body: {
      approved: true,
      decidedBy: "human.ops",
      decidedAt: "2026-03-08T16:10:00.000Z",
      evidenceRefs: ["ticket:NOO-ACTION-WALLET-EXPIRED-1"]
    }
  });
  assert.equal(lateDecision.statusCode, 409, lateDecision.body);
  assert.equal(lateDecision.json?.code, "TRANSITION_ILLEGAL");
  assert.equal(lateDecision.json?.details?.fromState, "expired");
  assert.equal(lateDecision.json?.details?.toState, "approved");
});

test("API e2e: standing-rule auto-approve persists a terminal approval decision on v1 approval request creation", async () => {
  const api = createApi({ now: () => "2026-03-08T16:10:00.000Z", opsToken: "tok_ops" });
  const actionIntentId = "aint_action_wallet_auto_approve_1";
  const requestId = "apr_action_wallet_auto_approve_1";
  const policyId = "apol_action_wallet_auto_approve_1";

  const createdPolicy = await request(api, {
    method: "POST",
    path: "/approval-policies",
    headers: {
      "x-idempotency-key": "approval_policy_auto_approve_1",
      "x-nooterra-protocol": "1.0"
    },
    body: {
      policyId,
      principalRef: {
        principalType: "human",
        principalId: "usr_action_wallet_auto_approve"
      },
      displayName: "Auto-approve trusted host buys",
      constraints: {
        actorAgentIds: ["agt_action_wallet_host_auto_approve"],
        maxSpendCents: 4_000
      },
      decision: {
        effect: "approve",
        decidedBy: "policy-engine",
        evidenceRefs: ["policy:auto_approve"]
      }
    }
  });
  assert.equal(createdPolicy.statusCode, 201, createdPolicy.body);

  const createdIntent = await request(api, {
    method: "POST",
    path: "/v1/action-intents",
    headers: { "x-idempotency-key": "v1_action_intent_create_auto_approve_1", "x-nooterra-protocol": "1.0" },
    body: {
      actionIntentId,
      actorAgentId: "agt_action_wallet_host_auto_approve",
      principalId: "usr_action_wallet_auto_approve",
      purpose: "Buy a charger under $40",
      capabilitiesRequested: ["capability://workflow.intake"],
      spendEnvelope: {
        currency: "USD",
        maxPerCallCents: 4_000,
        maxTotalCents: 4_000
      },
      evidenceRequirements: ["order_confirmation", "merchant_receipt"]
    }
  });
  assert.equal(createdIntent.statusCode, 201, createdIntent.body);

  const approvalRequested = await request(api, {
    method: "POST",
    path: `/v1/action-intents/${encodeURIComponent(actionIntentId)}/approval-requests`,
    headers: { "x-idempotency-key": "v1_action_intent_request_auto_approve_1", "x-nooterra-protocol": "1.0" },
    body: {
      requestId,
      requestedBy: "agt_action_wallet_host_auto_approve"
    }
  });
  assert.equal(approvalRequested.statusCode, 201, approvalRequested.body);
  assert.equal(approvalRequested.json?.approvalStatus, "approved");
  assert.equal(approvalRequested.json?.actionIntent?.status, "approved");
  assert.equal(approvalRequested.json?.executionGrant?.status, "approved");
  assert.equal(approvalRequested.json?.executionGrant?.executionGrantId, requestId);
  assert.match(String(approvalRequested.json?.executionGrant?.grantHash ?? ""), /^[0-9a-f]{64}$/);
  assert.match(String(approvalRequested.json?.executionGrant?.grantNonce ?? ""), /^[0-9a-f]{64}$/);

  const approvalStatus = await request(api, {
    method: "GET",
    path: `/v1/approval-requests/${encodeURIComponent(requestId)}`
  });
  assert.equal(approvalStatus.statusCode, 200, approvalStatus.body);
  assert.equal(approvalStatus.json?.approvalStatus, "approved");
  assert.equal(approvalStatus.json?.actionIntent?.status, "approved");
  assert.equal(approvalStatus.json?.approvalDecision?.approved, true);
  assert.equal(approvalStatus.json?.approvalDecision?.metadata?.source, "standing_policy");
  assert.equal(approvalStatus.json?.approvalDecision?.metadata?.policyId, policyId);
  assert.deepEqual(approvalStatus.json?.approvalDecision?.evidenceRefs, [`policy:${policyId}`, "policy:auto_approve"]);

  const transitionAudits = (await api.store.listOpsAudit({ tenantId: "tenant_default", limit: 200, offset: 0 }))
    .filter((row) => row?.action === "ACTION_WALLET_INTENT_TRANSITION" && row?.targetId === actionIntentId)
    .sort((left, right) => Number(left?.id ?? 0) - Number(right?.id ?? 0));
  const transitions = transitionAudits.flatMap((row) => row?.details?.transitions ?? []);
  assert.deepEqual(
    transitions.map((row) => `${row?.previousState ?? "<initial>"}->${row?.nextState}:${row?.lifecycleEvent}`),
    [
      "<initial>->draft:intent.created",
      "draft->approval_required:approval.opened",
      "approval_required->approved:approval.decided"
    ]
  );
});

test("API e2e: standing-rule auto-deny cancels the action intent on v1 approval request creation", async () => {
  const api = createApi({ now: () => "2026-03-08T16:10:00.000Z", opsToken: "tok_ops" });
  const actionIntentId = "aint_action_wallet_auto_deny_1";
  const requestId = "apr_action_wallet_auto_deny_1";
  const policyId = "apol_action_wallet_auto_deny_1";

  const createdPolicy = await request(api, {
    method: "POST",
    path: "/approval-policies",
    headers: {
      "x-idempotency-key": "approval_policy_auto_deny_1",
      "x-nooterra-protocol": "1.0"
    },
    body: {
      policyId,
      principalRef: {
        principalType: "human",
        principalId: "usr_action_wallet_auto_deny"
      },
      displayName: "Auto-deny risky host buys",
      constraints: {
        actorAgentIds: ["agt_action_wallet_host_auto_deny"],
        maxSpendCents: 4_000
      },
      decision: {
        effect: "deny",
        decidedBy: "policy-engine",
        evidenceRefs: ["policy:auto_deny"]
      }
    }
  });
  assert.equal(createdPolicy.statusCode, 201, createdPolicy.body);

  const createdIntent = await request(api, {
    method: "POST",
    path: "/v1/action-intents",
    headers: { "x-idempotency-key": "v1_action_intent_create_auto_deny_1", "x-nooterra-protocol": "1.0" },
    body: {
      actionIntentId,
      actorAgentId: "agt_action_wallet_host_auto_deny",
      principalId: "usr_action_wallet_auto_deny",
      purpose: "Buy a charger under $40",
      capabilitiesRequested: ["capability://workflow.intake"],
      spendEnvelope: {
        currency: "USD",
        maxPerCallCents: 4_000,
        maxTotalCents: 4_000
      },
      evidenceRequirements: ["order_confirmation", "merchant_receipt"]
    }
  });
  assert.equal(createdIntent.statusCode, 201, createdIntent.body);

  const approvalRequested = await request(api, {
    method: "POST",
    path: `/v1/action-intents/${encodeURIComponent(actionIntentId)}/approval-requests`,
    headers: { "x-idempotency-key": "v1_action_intent_request_auto_deny_1", "x-nooterra-protocol": "1.0" },
    body: {
      requestId,
      requestedBy: "agt_action_wallet_host_auto_deny"
    }
  });
  assert.equal(approvalRequested.statusCode, 201, approvalRequested.body);
  assert.equal(approvalRequested.json?.approvalStatus, "denied");
  assert.equal(approvalRequested.json?.actionIntent?.status, "cancelled");
  assert.equal(approvalRequested.json?.executionGrant?.status, "denied");

  const approvalStatus = await request(api, {
    method: "GET",
    path: `/v1/approval-requests/${encodeURIComponent(requestId)}`
  });
  assert.equal(approvalStatus.statusCode, 200, approvalStatus.body);
  assert.equal(approvalStatus.json?.approvalStatus, "denied");
  assert.equal(approvalStatus.json?.actionIntent?.status, "cancelled");
  assert.equal(approvalStatus.json?.approvalDecision?.approved, false);
  assert.equal(approvalStatus.json?.approvalDecision?.metadata?.source, "standing_policy");
  assert.equal(approvalStatus.json?.approvalDecision?.metadata?.policyId, policyId);
});

test("API e2e: approved execution grants can be revoked before execution starts", async () => {
  const api = createApi({ now: () => "2026-03-08T16:11:00.000Z", opsToken: "tok_ops" });
  const actionIntentId = "aint_action_wallet_grant_revoke_1";
  const requestId = "apr_action_wallet_grant_revoke_1";

  const createdIntent = await request(api, {
    method: "POST",
    path: "/v1/action-intents",
    headers: { "x-idempotency-key": "v1_action_wallet_grant_revoke_create_1", "x-nooterra-protocol": "1.0" },
    body: {
      actionIntentId,
      actorAgentId: "agt_action_wallet_host_revoke",
      principalId: "usr_action_wallet_grant_revoke",
      purpose: "Buy a charger under $40",
      capabilitiesRequested: ["capability://workflow.intake"],
      spendEnvelope: {
        currency: "USD",
        maxPerCallCents: 4_000,
        maxTotalCents: 4_000
      },
      evidenceRequirements: ["order_confirmation", "merchant_receipt"],
      host: {
        runtime: "claude-desktop",
        channel: "mcp",
        source: "test"
      }
    }
  });
  assert.equal(createdIntent.statusCode, 201, createdIntent.body);

  const approvalRequested = await request(api, {
    method: "POST",
    path: `/v1/action-intents/${encodeURIComponent(actionIntentId)}/approval-requests`,
    headers: { "x-idempotency-key": "v1_action_wallet_grant_revoke_request_1", "x-nooterra-protocol": "1.0" },
    body: {
      requestId,
      requestedBy: "agt_action_wallet_host_revoke"
    }
  });
  assert.equal(approvalRequested.statusCode, 201, approvalRequested.body);

  const approved = await request(api, {
    method: "POST",
    path: `/v1/approval-requests/${encodeURIComponent(requestId)}/decisions`,
    headers: { "x-idempotency-key": "v1_action_wallet_grant_revoke_decision_1", "x-nooterra-protocol": "1.0" },
    body: {
      approved: true,
      decidedBy: "usr_action_wallet_grant_revoke"
    }
  });
  assert.equal(approved.statusCode, 201, approved.body);
  assert.equal(approved.json?.executionGrant?.status, "approved");

  const revoked = await request(api, {
    method: "POST",
    path: `/v1/execution-grants/${encodeURIComponent(requestId)}/revoke`,
    headers: { "x-idempotency-key": "v1_action_wallet_grant_revoke_1", "x-nooterra-protocol": "1.0" },
    body: {
      reasonCode: "user_revoked"
    }
  });
  assert.equal(revoked.statusCode, 200, revoked.body);
  assert.equal(revoked.json?.approvalStatus, "revoked");
  assert.equal(revoked.json?.actionIntent?.status, "cancelled");
  assert.equal(revoked.json?.executionGrant?.status, "denied");

  const approvalAfterRevoke = await request(api, {
    method: "GET",
    path: `/v1/approval-requests/${encodeURIComponent(requestId)}`
  });
  assert.equal(approvalAfterRevoke.statusCode, 200, approvalAfterRevoke.body);
  assert.equal(approvalAfterRevoke.json?.approvalStatus, "revoked");
  assert.equal(approvalAfterRevoke.json?.actionIntent?.status, "cancelled");

  const executionGrantAfterRevoke = await request(api, {
    method: "GET",
    path: `/v1/execution-grants/${encodeURIComponent(requestId)}`
  });
  assert.equal(executionGrantAfterRevoke.statusCode, 200, executionGrantAfterRevoke.body);
  assert.equal(executionGrantAfterRevoke.json?.executionGrant?.status, "denied");
});

test("API e2e: v1 execution grant alias surfaces frozen launch semantics after approval", async () => {
  const api = createApi({ now: () => "2026-03-08T16:10:00.000Z", opsToken: "tok_ops" });
  const actionIntentId = "aint_action_wallet_grant_semantics_1";

  const createdIntent = await request(api, {
    method: "POST",
    path: "/v1/action-intents",
    headers: { "x-idempotency-key": "v1_action_intent_create_grant_semantics_1" },
    body: {
      actionIntentId,
      actorAgentId: "agt_action_wallet_host_semantics",
      principalId: "usr_action_wallet_semantics",
      purpose: "Buy a charger under $40",
      capabilitiesRequested: ["capability://workflow.intake"],
      spendEnvelope: {
        currency: "USD",
        maxPerCallCents: 4_000,
        maxTotalCents: 4_000
      },
      duration: {
        deadlineAt: "2026-03-08T16:20:00.000Z"
      },
      evidenceRequirements: ["order_confirmation", "merchant_receipt"],
      metadata: {
        actionWallet: {
          actionType: "buy",
          vendorOrDomainAllowlist: ["shop.example", "merchant.example"]
        }
      }
    }
  });
  assert.equal(createdIntent.statusCode, 201, createdIntent.body);

  const approvalRequested = await request(api, {
    method: "POST",
    path: `/v1/action-intents/${encodeURIComponent(actionIntentId)}/approval-requests`,
    headers: { "x-idempotency-key": "v1_action_intent_request_grant_semantics_1" },
    body: {
      requestId: "apr_action_wallet_grant_semantics_1",
      requestedBy: "agt_action_wallet_host_semantics"
    }
  });
  assert.equal(approvalRequested.statusCode, 201, approvalRequested.body);

  const approved = await request(api, {
    method: "POST",
    path: "/v1/approval-requests/apr_action_wallet_grant_semantics_1/decisions",
    headers: { "x-idempotency-key": "v1_action_intent_decide_grant_semantics_1" },
    body: {
      approved: true,
      decidedBy: "human.ops",
      decidedAt: "2026-03-08T16:11:00.000Z",
      expiresAt: "2026-03-08T16:15:00.000Z",
      evidenceRefs: ["ticket:NOO-ACTION-WALLET-GRANT-SEMANTICS-1"],
      binding: {
        authorityGrantRef: "agrant_action_wallet_semantics_1",
        delegationGrantRef: "dgrant_action_wallet_semantics_1"
      }
    }
  });
  assert.equal(approved.statusCode, 201, approved.body);

  const executionGrant = await request(api, {
    method: "GET",
    path: "/v1/execution-grants/apr_action_wallet_grant_semantics_1"
  });
  assert.equal(executionGrant.statusCode, 200, executionGrant.body);
  assert.equal(executionGrant.json?.executionGrant?.status, "approved");
  assert.deepEqual(executionGrant.json?.executionGrant?.principal, {
    principalType: "human",
    principalId: "usr_action_wallet_semantics"
  });
  assert.equal(executionGrant.json?.executionGrant?.actionType, "buy");
  assert.equal(executionGrant.json?.executionGrant?.hostId, "agt_action_wallet_host_semantics");
  assert.deepEqual(executionGrant.json?.executionGrant?.vendorOrDomainAllowlist, ["merchant.example", "shop.example"]);
  assert.deepEqual(executionGrant.json?.executionGrant?.spendCap, {
    currency: "USD",
    maxPerCallCents: 4_000,
    maxTotalCents: 4_000
  });
  assert.equal(executionGrant.json?.executionGrant?.expiresAt, "2026-03-08T16:15:00.000Z");
  assert.match(String(executionGrant.json?.executionGrant?.grantHash ?? ""), /^[0-9a-f]{64}$/);
  assert.deepEqual(executionGrant.json?.executionGrant?.evidenceRequirements, ["merchant_receipt", "order_confirmation"]);
  assert.match(String(executionGrant.json?.executionGrant?.grantNonce ?? ""), /^[0-9a-f]{64}$/);
  assert.deepEqual(executionGrant.json?.executionGrant?.delegationLineageRef, {
    authorityEnvelopeRef: {
      envelopeId: actionIntentId,
      envelopeHash: createdIntent.json?.authorityEnvelope?.envelopeHash
    },
    authorityGrantRef: "agrant_action_wallet_semantics_1",
    delegationGrantRef: "dgrant_action_wallet_semantics_1",
    mayDelegate: false,
    maxDepth: 0
  });
});

test("API e2e: v1 action wallet aliases cover approval, execution grant, finalization, and receipt retrieval", async () => {
  const api = createApi({ now: () => "2026-03-08T16:00:00.000Z", opsToken: "tok_ops" });
  const principalAgentId = "agt_action_wallet_principal";
  const subAgentId = "agt_action_wallet_worker";
  const capability = "capability://workflow.intake";
  const grantId = "dgrant_action_wallet_1";
  const workOrderId = "workord_action_wallet_seed";
  const receiptId = "worec_action_wallet_1";

  await registerAgent(api, { agentId: principalAgentId, capabilities: [capability] });
  await registerAgent(api, { agentId: subAgentId, capabilities: [capability] });
  await issueDelegationGrant(api, {
    grantId,
    delegatorAgentId: principalAgentId,
    delegateeAgentId: subAgentId,
    capability
  });

  const seededBlockedWorkOrder = await request(api, {
    method: "POST",
    path: "/work-orders",
    headers: { "x-idempotency-key": "v1_action_wallet_seed_blocked_1" },
    body: {
      workOrderId,
      principalAgentId,
      subAgentId,
      requiredCapability: capability,
      pricing: {
        amountCents: 1900,
        currency: "USD",
        quoteId: "quote_action_wallet_seed"
      },
      constraints: {
        maxDurationSeconds: 300,
        maxCostCents: 1900,
        retryLimit: 1
      },
      delegationGrantRef: grantId,
      approvalMode: "require",
      approvalPolicy: {
        requireApprovalAboveCents: 0,
        strictEvidenceRefs: true
      },
      traceId: "trace_action_wallet_seed"
    }
  });
  assert.equal(seededBlockedWorkOrder.statusCode, 409, seededBlockedWorkOrder.body);
  const seededAuthorityEnvelope = seededBlockedWorkOrder.json?.details?.authorityEnvelope;
  const seededApprovalRequest = seededBlockedWorkOrder.json?.details?.approvalRequest;
  assert.ok(seededAuthorityEnvelope?.envelopeId);
  assert.ok(seededApprovalRequest?.requestId);
  const actionIntentId = seededAuthorityEnvelope.envelopeId;

  const createdIntent = await request(api, {
    method: "POST",
    path: "/v1/action-intents",
    headers: { "x-idempotency-key": "v1_action_intent_create_1" },
    body: {
      actionIntentId,
      authorityEnvelope: seededAuthorityEnvelope,
      host: {
        runtime: "claude-desktop",
        channel: "mcp",
        source: "test"
      }
    }
  });
  assert.equal(createdIntent.statusCode, 200, createdIntent.body);
  assert.equal(createdIntent.json?.actionIntent?.actionIntentId, actionIntentId);
  assert.equal(createdIntent.json?.actionIntent?.intentHash, seededAuthorityEnvelope.envelopeHash);
  assert.equal(createdIntent.json?.actionIntent?.status, "approval_required");
  assert.equal(createdIntent.json?.authorityEnvelope?.envelopeId, actionIntentId);

  const fetchedIntent = await request(api, {
    method: "GET",
    path: `/v1/action-intents/${encodeURIComponent(actionIntentId)}`
  });
  assert.equal(fetchedIntent.statusCode, 200, fetchedIntent.body);
  assert.equal(fetchedIntent.json?.actionIntent?.actionIntentId, actionIntentId);
  assert.equal(fetchedIntent.json?.actionIntent?.status, "approval_required");
  assert.equal(fetchedIntent.json?.approvalRequest?.requestId, seededApprovalRequest.requestId);
  assert.equal(fetchedIntent.json?.executionGrant?.executionGrantId, seededApprovalRequest.requestId);

  const approvalRequested = await request(api, {
    method: "POST",
    path: `/v1/action-intents/${encodeURIComponent(actionIntentId)}/approval-requests`,
    headers: { "x-idempotency-key": "v1_action_intent_request_approval_1" },
    body: {
      approvalRequest: seededApprovalRequest,
      requestedBy: seededApprovalRequest.requestedBy
    }
  });
  assert.equal(approvalRequested.statusCode, 200, approvalRequested.body);
  const approvalRequest = approvalRequested.json?.approvalRequest;
  assert.ok(approvalRequest?.requestId);
  assert.equal(approvalRequested.json?.actionIntent?.status, "approval_required");
  assert.equal(approvalRequested.json?.approvalStatus, "pending");
  assert.equal(approvalRequested.json?.executionGrant?.status, "approval_requested");

  const approved = await request(api, {
    method: "POST",
    path: `/v1/approval-requests/${encodeURIComponent(approvalRequest.requestId)}/decisions`,
    headers: { "x-idempotency-key": "v1_action_intent_decide_1" },
    body: {
      approved: true,
      decidedBy: "human.ops",
      decidedAt: "2026-03-08T16:05:00.000Z",
      note: "Approved from Action Wallet e2e test",
      evidenceRefs: ["ticket:NOO-ACTION-WALLET-1"]
    }
  });
  assert.equal(approved.statusCode, 201, approved.body);
  assert.equal(approved.json?.approvalStatus, "approved");
  assert.equal(approved.json?.approvalDecision?.approved, true);

  const approvalStatus = await request(api, {
    method: "GET",
    path: `/v1/approval-requests/${encodeURIComponent(approvalRequest.requestId)}`
  });
  assert.equal(approvalStatus.statusCode, 200, approvalStatus.body);
  assert.equal(approvalStatus.json?.approvalStatus, "approved");
  assert.equal(approvalStatus.json?.actionIntent?.status, "approved");
  assert.equal(approvalStatus.json?.approvalDecision?.approved, true);

  const createdWorkOrder = await request(api, {
    method: "POST",
    path: "/work-orders",
    headers: { "x-idempotency-key": "v1_action_wallet_materialize_1" },
    body: {
      workOrderId,
      principalAgentId,
      subAgentId,
      requiredCapability: capability,
      pricing: {
        amountCents: 1900,
        currency: "USD",
        quoteId: "quote_action_wallet_1"
      },
      constraints: {
        maxDurationSeconds: 300,
        maxCostCents: 1900,
        retryLimit: 1
      },
      delegationGrantRef: grantId,
      approvalMode: "require",
      approvalPolicy: {
        requireApprovalAboveCents: 0,
        strictEvidenceRefs: true
      },
      traceId: "trace_action_wallet_1",
      authorityEnvelope: approvalRequested.json?.authorityEnvelope,
      approvalRequest,
      approvalDecision: approved.json?.approvalDecision
    }
  });
  assert.equal(createdWorkOrder.statusCode, 201, createdWorkOrder.body);
  assert.equal(createdWorkOrder.json?.workOrder?.workOrderId, workOrderId);

  const executionStatus = await request(api, {
    method: "GET",
    path: `/v1/approval-requests/${encodeURIComponent(approvalRequest.requestId)}`
  });
  assert.equal(executionStatus.statusCode, 200, executionStatus.body);
  assert.equal(executionStatus.json?.approvalStatus, "approved");
  assert.equal(executionStatus.json?.actionIntent?.status, "executing");

  const executingIntent = await request(api, {
    method: "GET",
    path: `/v1/action-intents/${encodeURIComponent(actionIntentId)}`
  });
  assert.equal(executingIntent.statusCode, 200, executingIntent.body);
  assert.equal(executingIntent.json?.actionIntent?.status, "executing");
  assert.equal(executingIntent.json?.approvalDecision?.approved, true);
  assert.equal(executingIntent.json?.executionGrant?.status, "materialized");

  const reopenedApproval = await request(api, {
    method: "POST",
    path: `/v1/action-intents/${encodeURIComponent(actionIntentId)}/approval-requests`,
    headers: { "x-idempotency-key": "v1_action_intent_request_approval_2" },
    body: {
      requestId: "apr_action_wallet_reopen_1",
      requestedBy: approvalRequest.requestedBy
    }
  });
  assert.equal(reopenedApproval.statusCode, 409, reopenedApproval.body);
  assert.equal(reopenedApproval.json?.code, "TRANSITION_ILLEGAL");
  assert.equal(reopenedApproval.json?.details?.fromState, "executing");
  assert.equal(reopenedApproval.json?.details?.toState, "approval_required");

  const executionGrant = await request(api, {
    method: "GET",
    path: `/v1/execution-grants/${encodeURIComponent(approvalRequest.requestId)}`
  });
  assert.equal(executionGrant.statusCode, 200, executionGrant.body);
  assert.equal(executionGrant.json?.executionGrant?.status, "materialized");
  assert.match(String(executionGrant.json?.executionGrant?.grantHash ?? ""), /^[0-9a-f]{64}$/);
  assert.equal(executionGrant.json?.executionGrant?.workOrderId, workOrderId);

  const evidence = await request(api, {
    method: "POST",
    path: `/v1/execution-grants/${encodeURIComponent(approvalRequest.requestId)}/evidence`,
    headers: { "x-idempotency-key": "v1_action_wallet_evidence_1" },
    body: {
      workOrderId,
      evidenceRefs: ["artifact://checkout/cart-1", "report://verification/action-wallet-1"],
      message: "Attached checkout evidence."
    }
  });
  assert.equal(evidence.statusCode, 200, evidence.body);
  assert.match(String(evidence.json?.evidenceBundle?.evidenceBundleHash ?? ""), /^[0-9a-f]{64}$/);
  assert.equal(evidence.json?.workOrder?.workOrderId, workOrderId);

  const evidenceStatus = await request(api, {
    method: "GET",
    path: `/v1/approval-requests/${encodeURIComponent(approvalRequest.requestId)}`
  });
  assert.equal(evidenceStatus.statusCode, 200, evidenceStatus.body);
  assert.equal(evidenceStatus.json?.approvalStatus, "approved");
  assert.equal(evidenceStatus.json?.actionIntent?.status, "evidence_submitted");

  const finalized = await request(api, {
    method: "POST",
    path: `/v1/execution-grants/${encodeURIComponent(approvalRequest.requestId)}/finalize`,
    headers: { "x-idempotency-key": "v1_action_wallet_finalize_1" },
    body: {
      workOrderId,
      completion: {
        receiptId,
        status: "success",
        verifierVerdict: buildVerifierVerdict(),
        outputs: {
          orderId: "order_action_wallet_1"
        },
        metrics: {
          steps: 3
        },
        evidenceRefs: ["artifact://checkout/cart-1", "report://verification/action-wallet-1"],
        amountCents: 1900,
        currency: "USD",
        deliveredAt: "2026-03-08T16:12:00.000Z",
        completedAt: "2026-03-08T16:12:30.000Z"
      },
      settlement: {
        status: "released",
        x402GateId: "x402gate_action_wallet_1",
        x402RunId: "run_action_wallet_1",
        x402SettlementStatus: "released",
        x402ReceiptId: "x402rcpt_action_wallet_1",
        settledAt: "2026-03-08T16:13:00.000Z"
      }
    }
  });
  assert.equal(finalized.statusCode, 200, finalized.body);
  assert.equal(finalized.json?.actionReceipt?.receiptId, receiptId);
  assert.equal(finalized.json?.workOrder?.status, "settled");

  const replayedFinalize = await request(api, {
    method: "POST",
    path: `/v1/execution-grants/${encodeURIComponent(approvalRequest.requestId)}/finalize`,
    headers: { "x-idempotency-key": "v1_action_wallet_finalize_1" },
    body: {
      workOrderId,
      completion: {
        receiptId,
        status: "success",
        verifierVerdict: buildVerifierVerdict(),
        outputs: {
          orderId: "order_action_wallet_1"
        },
        metrics: {
          steps: 3
        },
        evidenceRefs: ["artifact://checkout/cart-1", "report://verification/action-wallet-1"],
        amountCents: 1900,
        currency: "USD",
        deliveredAt: "2026-03-08T16:12:00.000Z",
        completedAt: "2026-03-08T16:12:30.000Z"
      },
      settlement: {
        status: "released",
        x402GateId: "x402gate_action_wallet_1",
        x402RunId: "run_action_wallet_1",
        x402SettlementStatus: "released",
        x402ReceiptId: "x402rcpt_action_wallet_1",
        settledAt: "2026-03-08T16:13:00.000Z"
      }
    }
  });
  assert.equal(replayedFinalize.statusCode, 200, replayedFinalize.body);
  assert.deepEqual(replayedFinalize.json, finalized.json);

  const conflictingFinalize = await request(api, {
    method: "POST",
    path: `/v1/execution-grants/${encodeURIComponent(approvalRequest.requestId)}/finalize`,
    headers: { "x-idempotency-key": "v1_action_wallet_finalize_1" },
    body: {
      workOrderId,
      completion: {
        receiptId,
        status: "success",
        verifierVerdict: buildVerifierVerdict(),
        outputs: {
          orderId: "order_action_wallet_2"
        },
        metrics: {
          steps: 3
        },
        evidenceRefs: ["artifact://checkout/cart-1", "report://verification/action-wallet-1"],
        amountCents: 1900,
        currency: "USD",
        deliveredAt: "2026-03-08T16:12:00.000Z",
        completedAt: "2026-03-08T16:12:30.000Z"
      },
      settlement: {
        status: "released",
        x402GateId: "x402gate_action_wallet_1",
        x402RunId: "run_action_wallet_1",
        x402SettlementStatus: "released",
        x402ReceiptId: "x402rcpt_action_wallet_1",
        settledAt: "2026-03-08T16:13:00.000Z"
      }
    }
  });
  assert.equal(conflictingFinalize.statusCode, 409, conflictingFinalize.body);
  assert.equal(conflictingFinalize.json?.error, "idempotency key conflict");

  const completedStatus = await request(api, {
    method: "GET",
    path: `/v1/approval-requests/${encodeURIComponent(approvalRequest.requestId)}`
  });
  assert.equal(completedStatus.statusCode, 200, completedStatus.body);
  assert.equal(completedStatus.json?.approvalStatus, "approved");
  assert.equal(completedStatus.json?.actionIntent?.status, "completed");

  const completedIntent = await request(api, {
    method: "GET",
    path: `/v1/action-intents/${encodeURIComponent(actionIntentId)}`
  });
  assert.equal(completedIntent.statusCode, 200, completedIntent.body);
  assert.equal(completedIntent.json?.actionIntent?.status, "completed");
  assert.equal(completedIntent.json?.approvalDecision?.approved, true);
  assert.equal(completedIntent.json?.executionGrant?.status, "materialized");

  const receipt = await request(api, {
    method: "GET",
    path: `/v1/receipts/${encodeURIComponent(receiptId)}`
  });
  assert.equal(receipt.statusCode, 200, receipt.body);
  assert.equal(receipt.json?.actionReceipt?.receiptId, receiptId);
  assert.equal(receipt.json?.actionReceipt?.originatingApproval?.approvalRequestRef?.requestId, approvalRequest.requestId);
  assert.equal(receipt.json?.actionReceipt?.originatingApproval?.approvalDecisionRef?.approved, true);
  assert.equal(receipt.json?.actionReceipt?.executionGrantRef?.executionGrantId, approvalRequest.requestId);
  assert.equal(receipt.json?.actionReceipt?.executionGrantRef?.grantHash, executionGrant.json?.executionGrant?.grantHash);
  assert.equal(receipt.json?.actionReceipt?.executionGrantRef?.status, "materialized");
  assert.equal(receipt.json?.actionReceipt?.evidenceBundle?.evidenceCount, 2);
  assert.equal(receipt.json?.actionReceipt?.evidenceBundle?.evidenceBundleHash, evidence.json?.evidenceBundle?.evidenceBundleHash);
  assert.deepEqual(receipt.json?.actionReceipt?.evidenceBundle?.evidenceRefs, [
    "artifact://checkout/cart-1",
    "report://verification/action-wallet-1"
  ]);
  assert.equal(receipt.json?.actionReceipt?.settlementState?.status, "released");
  assert.equal(receipt.json?.actionReceipt?.settlementState?.runId, "run_action_wallet_1");
  assert.equal(receipt.json?.actionReceipt?.verifierVerdict?.status, "pass");
  assert.deepEqual(receipt.json?.actionReceipt?.verifierVerdict?.reasonCodes, []);
  assert.equal(receipt.json?.actionReceipt?.disputeState?.status, "none");
  assert.equal(receipt.json?.detail?.integrityStatus, "verified");
  assert.equal(receipt.json?.detail?.originatingApproval?.approvalRequestRef?.requestId, approvalRequest.requestId);
  assert.equal(receipt.json?.detail?.executionGrantRef?.grantHash, executionGrant.json?.executionGrant?.grantHash);
  assert.equal(receipt.json?.detail?.executionGrantRef?.executionGrantId, approvalRequest.requestId);
  assert.equal(receipt.json?.detail?.evidenceBundle?.evidenceCount, 2);
  assert.equal(receipt.json?.detail?.evidenceBundle?.evidenceBundleHash, evidence.json?.evidenceBundle?.evidenceBundleHash);
  assert.equal(receipt.json?.detail?.settlementState?.status, "released");
  assert.equal(receipt.json?.detail?.verifierVerdict?.status, "pass");
  assert.equal(receipt.json?.detail?.disputeState?.status, "none");

  const transitionAudits = (await api.store.listOpsAudit({ tenantId: "tenant_default", limit: 200, offset: 0 }))
    .filter((row) => row?.action === "ACTION_WALLET_INTENT_TRANSITION" && row?.targetId === actionIntentId)
    .sort((left, right) => Number(left?.id ?? 0) - Number(right?.id ?? 0));
  const transitions = transitionAudits.flatMap((row) => row?.details?.transitions ?? []);
  assert.deepEqual(
    transitions.map((row) => `${row?.previousState ?? "<initial>"}->${row?.nextState}:${row?.lifecycleEvent}`),
    [
      "approval_required->approved:approval.decided",
      "approved->executing:grant.issued",
      "executing->evidence_submitted:evidence.submitted",
      "evidence_submitted->verifying:finalize.requested",
      "verifying->completed:receipt.issued"
    ]
  );
});

test("API e2e: v1 action wallet finalize fails closed when settlement evidence is missing", async () => {
  const api = createApi({ now: () => "2026-03-08T18:00:00.000Z", opsToken: "tok_ops" });
  const principalAgentId = "agt_action_wallet_principal_fail_closed";
  const subAgentId = "agt_action_wallet_worker_fail_closed";
  const capability = "capability://workflow.intake";
  const grantId = "dgrant_action_wallet_fail_closed_1";
  const workOrderId = "workord_action_wallet_fail_closed_1";

  await registerAgent(api, { agentId: principalAgentId, capabilities: [capability] });
  await registerAgent(api, { agentId: subAgentId, capabilities: [capability] });
  await issueDelegationGrant(api, {
    grantId,
    delegatorAgentId: principalAgentId,
    delegateeAgentId: subAgentId,
    capability
  });

  const seededBlockedWorkOrder = await request(api, {
    method: "POST",
    path: "/work-orders",
    headers: { "x-idempotency-key": "v1_action_wallet_seed_fail_closed_1" },
    body: {
      workOrderId,
      principalAgentId,
      subAgentId,
      requiredCapability: capability,
      pricing: {
        amountCents: 2200,
        currency: "USD",
        quoteId: "quote_action_wallet_fail_closed_1"
      },
      constraints: {
        maxDurationSeconds: 300,
        maxCostCents: 2200,
        retryLimit: 1
      },
      delegationGrantRef: grantId,
      approvalMode: "require",
      approvalPolicy: {
        requireApprovalAboveCents: 0,
        strictEvidenceRefs: true
      },
      traceId: "trace_action_wallet_fail_closed_1"
    }
  });
  assert.equal(seededBlockedWorkOrder.statusCode, 409, seededBlockedWorkOrder.body);
  const seededAuthorityEnvelope = seededBlockedWorkOrder.json?.details?.authorityEnvelope;
  const seededApprovalRequest = seededBlockedWorkOrder.json?.details?.approvalRequest;
  assert.ok(seededAuthorityEnvelope?.envelopeId);
  assert.ok(seededApprovalRequest?.requestId);

  const actionIntentId = seededAuthorityEnvelope.envelopeId;
  const createdIntent = await request(api, {
    method: "POST",
    path: "/v1/action-intents",
    headers: { "x-idempotency-key": "v1_action_wallet_fail_closed_create_1" },
    body: {
      actionIntentId,
      authorityEnvelope: seededAuthorityEnvelope,
      host: {
        runtime: "claude-desktop",
        channel: "mcp",
        source: "test"
      }
    }
  });
  assert.equal(createdIntent.statusCode, 200, createdIntent.body);

  const approvalRequested = await request(api, {
    method: "POST",
    path: `/v1/action-intents/${encodeURIComponent(actionIntentId)}/approval-requests`,
    headers: { "x-idempotency-key": "v1_action_wallet_fail_closed_request_1" },
    body: {
      approvalRequest: seededApprovalRequest,
      requestedBy: seededApprovalRequest.requestedBy
    }
  });
  assert.equal(approvalRequested.statusCode, 200, approvalRequested.body);
  const approvalRequest = approvalRequested.json?.approvalRequest;
  assert.ok(approvalRequest?.requestId);

  const approved = await request(api, {
    method: "POST",
    path: `/v1/approval-requests/${encodeURIComponent(approvalRequest.requestId)}/decisions`,
    headers: { "x-idempotency-key": "v1_action_wallet_fail_closed_decide_1" },
    body: {
      approved: true,
      decidedBy: "human.ops",
      decidedAt: "2026-03-08T18:05:00.000Z",
      evidenceRefs: ["ticket:NOO-ACTION-WALLET-FAIL-CLOSED-1"]
    }
  });
  assert.equal(approved.statusCode, 201, approved.body);

  const createdWorkOrder = await request(api, {
    method: "POST",
    path: "/work-orders",
    headers: { "x-idempotency-key": "v1_action_wallet_fail_closed_materialize_1" },
    body: {
      workOrderId,
      principalAgentId,
      subAgentId,
      requiredCapability: capability,
      pricing: {
        amountCents: 2200,
        currency: "USD",
        quoteId: "quote_action_wallet_fail_closed_1"
      },
      constraints: {
        maxDurationSeconds: 300,
        maxCostCents: 2200,
        retryLimit: 1
      },
      delegationGrantRef: grantId,
      approvalMode: "require",
      approvalPolicy: {
        requireApprovalAboveCents: 0,
        strictEvidenceRefs: true
      },
      traceId: "trace_action_wallet_fail_closed_1",
      authorityEnvelope: approvalRequested.json?.authorityEnvelope,
      approvalRequest,
      approvalDecision: approved.json?.approvalDecision
    }
  });
  assert.equal(createdWorkOrder.statusCode, 201, createdWorkOrder.body);

  const finalizeBlocked = await request(api, {
    method: "POST",
    path: `/v1/execution-grants/${encodeURIComponent(approvalRequest.requestId)}/finalize`,
    headers: { "x-idempotency-key": "v1_action_wallet_fail_closed_finalize_1" },
    body: {
      workOrderId,
      completion: {
        receiptId: "worec_action_wallet_fail_closed_1",
        status: "success",
        verifierVerdict: buildVerifierVerdict(),
        outputs: {
          orderId: "order_action_wallet_fail_closed_1"
        },
        metrics: {
          steps: 1
        },
        evidenceRefs: [],
        amountCents: 2200,
        currency: "USD",
        deliveredAt: "2026-03-08T18:06:00.000Z",
        completedAt: "2026-03-08T18:06:30.000Z"
      },
      settlement: {
        status: "released",
        x402GateId: "x402gate_action_wallet_fail_closed_1",
        x402RunId: "run_action_wallet_fail_closed_1",
        x402SettlementStatus: "released",
        x402ReceiptId: "x402rcpt_action_wallet_fail_closed_1",
        settledAt: "2026-03-08T18:07:00.000Z"
      }
    }
  });
  assert.equal(finalizeBlocked.statusCode, 409, finalizeBlocked.body);
  assert.equal(finalizeBlocked.json?.code, "EXECUTION_GRANT_EVIDENCE_BINDING_BLOCKED");
  assert.equal(finalizeBlocked.json?.details?.reasonCode, "WORK_ORDER_EVIDENCE_MISSING");
  assert.equal(finalizeBlocked.json?.details?.requiredMinEvidenceRefs, 1);
  assert.equal(finalizeBlocked.json?.details?.actualEvidenceRefs, 0);

  const executionGrant = await request(api, {
    method: "GET",
    path: `/v1/execution-grants/${encodeURIComponent(approvalRequest.requestId)}`
  });
  assert.equal(executionGrant.statusCode, 200, executionGrant.body);
  assert.equal(executionGrant.json?.executionGrant?.status, "materialized");

  const blockedStatus = await request(api, {
    method: "GET",
    path: `/v1/approval-requests/${encodeURIComponent(approvalRequest.requestId)}`
  });
  assert.equal(blockedStatus.statusCode, 200, blockedStatus.body);
  assert.equal(blockedStatus.json?.actionIntent?.status, "executing");
});

test("API e2e: v1 action wallet verifier can fail a finalize into a failed governed outcome", async () => {
  const api = createApi({ now: () => "2026-03-08T18:20:00.000Z", opsToken: "tok_ops" });
  const principalAgentId = "agt_action_wallet_principal_verifier_fail";
  const subAgentId = "agt_action_wallet_worker_verifier_fail";
  const capability = "capability://workflow.intake";
  const grantId = "dgrant_action_wallet_verifier_fail_1";
  const workOrderId = "workord_action_wallet_verifier_fail_1";

  await registerAgent(api, { agentId: principalAgentId, capabilities: [capability] });
  await registerAgent(api, { agentId: subAgentId, capabilities: [capability] });
  await issueDelegationGrant(api, {
    grantId,
    delegatorAgentId: principalAgentId,
    delegateeAgentId: subAgentId,
    capability
  });

  const seededBlockedWorkOrder = await request(api, {
    method: "POST",
    path: "/work-orders",
    headers: { "x-idempotency-key": "v1_action_wallet_seed_verifier_fail_1" },
    body: {
      workOrderId,
      principalAgentId,
      subAgentId,
      requiredCapability: capability,
      pricing: {
        amountCents: 1800,
        currency: "USD",
        quoteId: "quote_action_wallet_verifier_fail_1"
      },
      constraints: {
        maxDurationSeconds: 300,
        maxCostCents: 1800,
        retryLimit: 1
      },
      delegationGrantRef: grantId,
      approvalMode: "require",
      approvalPolicy: {
        requireApprovalAboveCents: 0,
        strictEvidenceRefs: true
      },
      traceId: "trace_action_wallet_verifier_fail_1"
    }
  });
  assert.equal(seededBlockedWorkOrder.statusCode, 409, seededBlockedWorkOrder.body);
  const seededAuthorityEnvelope = seededBlockedWorkOrder.json?.details?.authorityEnvelope;
  const seededApprovalRequest = seededBlockedWorkOrder.json?.details?.approvalRequest;
  const actionIntentId = seededAuthorityEnvelope.envelopeId;

  const createdIntent = await request(api, {
    method: "POST",
    path: "/v1/action-intents",
    headers: { "x-idempotency-key": "v1_action_wallet_verifier_fail_create_1" },
    body: {
      actionIntentId,
      authorityEnvelope: seededAuthorityEnvelope,
      host: {
        runtime: "claude-desktop",
        channel: "mcp",
        source: "test"
      }
    }
  });
  assert.equal(createdIntent.statusCode, 200, createdIntent.body);

  const approvalRequested = await request(api, {
    method: "POST",
    path: `/v1/action-intents/${encodeURIComponent(actionIntentId)}/approval-requests`,
    headers: { "x-idempotency-key": "v1_action_wallet_verifier_fail_request_1" },
    body: {
      approvalRequest: seededApprovalRequest,
      requestedBy: seededApprovalRequest.requestedBy
    }
  });
  assert.equal(approvalRequested.statusCode, 200, approvalRequested.body);
  const approvalRequest = approvalRequested.json?.approvalRequest;

  const approved = await request(api, {
    method: "POST",
    path: `/v1/approval-requests/${encodeURIComponent(approvalRequest.requestId)}/decisions`,
    headers: { "x-idempotency-key": "v1_action_wallet_verifier_fail_decide_1" },
    body: {
      approved: true,
      decidedBy: "human.ops",
      decidedAt: "2026-03-08T18:22:00.000Z",
      evidenceRefs: ["ticket:NOO-ACTION-WALLET-VERIFIER-FAIL-1"]
    }
  });
  assert.equal(approved.statusCode, 201, approved.body);

  const createdWorkOrder = await request(api, {
    method: "POST",
    path: "/work-orders",
    headers: { "x-idempotency-key": "v1_action_wallet_verifier_fail_materialize_1" },
    body: {
      workOrderId,
      principalAgentId,
      subAgentId,
      requiredCapability: capability,
      pricing: {
        amountCents: 1800,
        currency: "USD",
        quoteId: "quote_action_wallet_verifier_fail_1"
      },
      constraints: {
        maxDurationSeconds: 300,
        maxCostCents: 1800,
        retryLimit: 1
      },
      delegationGrantRef: grantId,
      approvalMode: "require",
      approvalPolicy: {
        requireApprovalAboveCents: 0,
        strictEvidenceRefs: true
      },
      traceId: "trace_action_wallet_verifier_fail_1",
      authorityEnvelope: approvalRequested.json?.authorityEnvelope,
      approvalRequest,
      approvalDecision: approved.json?.approvalDecision
    }
  });
  assert.equal(createdWorkOrder.statusCode, 201, createdWorkOrder.body);

  const evidence = await request(api, {
    method: "POST",
    path: `/v1/execution-grants/${encodeURIComponent(approvalRequest.requestId)}/evidence`,
    headers: { "x-idempotency-key": "v1_action_wallet_verifier_fail_evidence_1" },
    body: {
      workOrderId,
      evidenceRefs: ["artifact://checkout/cart-verifier-fail-1", "report://verification/action-wallet-verifier-fail-1"],
      message: "Attached failing verification evidence."
    }
  });
  assert.equal(evidence.statusCode, 200, evidence.body);

  const finalized = await request(api, {
    method: "POST",
    path: `/v1/execution-grants/${encodeURIComponent(approvalRequest.requestId)}/finalize`,
    headers: { "x-idempotency-key": "v1_action_wallet_verifier_fail_finalize_1" },
    body: {
      workOrderId,
      completion: {
        receiptId: "worec_action_wallet_verifier_fail_1",
        status: "success",
        verifierVerdict: buildVerifierVerdict({
          status: "fail",
          verificationStatus: "red",
          reasonCodes: ["verification_mismatch_detected"]
        }),
        outputs: {
          orderId: "order_action_wallet_verifier_fail_1"
        },
        metrics: {
          steps: 2
        },
        evidenceRefs: ["artifact://checkout/cart-verifier-fail-1", "report://verification/action-wallet-verifier-fail-1"],
        amountCents: 1800,
        currency: "USD",
        deliveredAt: "2026-03-08T18:23:00.000Z",
        completedAt: "2026-03-08T18:23:30.000Z"
      },
      settlement: {
        status: "refunded",
        x402GateId: "x402gate_action_wallet_verifier_fail_1",
        x402RunId: "run_action_wallet_verifier_fail_1",
        x402SettlementStatus: "refunded",
        x402ReceiptId: "x402rcpt_action_wallet_verifier_fail_1",
        settledAt: "2026-03-08T18:24:00.000Z"
      }
    }
  });
  assert.equal(finalized.statusCode, 200, finalized.body);
  assert.equal(finalized.json?.workOrder?.status, "settled");
  assert.equal(finalized.json?.completionReceipt?.status, "failed");
  assert.equal(finalized.json?.actionReceipt?.verifierVerdict?.status, "fail");
  assert.equal(finalized.json?.actionReceipt?.verifierVerdict?.verificationStatus, "red");

  const failedStatus = await request(api, {
    method: "GET",
    path: `/v1/approval-requests/${encodeURIComponent(approvalRequest.requestId)}`
  });
  assert.equal(failedStatus.statusCode, 200, failedStatus.body);
  assert.equal(failedStatus.json?.actionIntent?.status, "refunded");
});

test("API e2e: v1 action wallet verifier blocks insufficient and operator-review finalize requests", async () => {
  for (const scenario of [
    {
      suffix: "insufficient",
      verdict: buildVerifierVerdict({
        status: "insufficient",
        verificationStatus: "amber",
        reasonCodes: ["additional_evidence_required"]
      }),
      expectedCode: "EXECUTION_GRANT_VERIFIER_INSUFFICIENT"
    },
    {
      suffix: "operator_review",
      verdict: buildVerifierVerdict({
        status: "operator_review",
        verificationStatus: "amber",
        reasonCodes: ["manual_review_required"]
      }),
      expectedCode: "EXECUTION_GRANT_OPERATOR_REVIEW_REQUIRED"
    }
  ]) {
    const api = createApi({ now: () => "2026-03-08T18:40:00.000Z", opsToken: "tok_ops" });
    const principalAgentId = `agt_action_wallet_principal_${scenario.suffix}`;
    const subAgentId = `agt_action_wallet_worker_${scenario.suffix}`;
    const capability = "capability://workflow.intake";
    const grantId = `dgrant_action_wallet_${scenario.suffix}_1`;
    const workOrderId = `workord_action_wallet_${scenario.suffix}_1`;

    await registerAgent(api, { agentId: principalAgentId, capabilities: [capability] });
    await registerAgent(api, { agentId: subAgentId, capabilities: [capability] });
    await issueDelegationGrant(api, {
      grantId,
      delegatorAgentId: principalAgentId,
      delegateeAgentId: subAgentId,
      capability
    });

    const seededBlockedWorkOrder = await request(api, {
      method: "POST",
      path: "/work-orders",
      headers: { "x-idempotency-key": `v1_action_wallet_seed_${scenario.suffix}_1` },
      body: {
        workOrderId,
        principalAgentId,
        subAgentId,
        requiredCapability: capability,
        pricing: {
          amountCents: 1700,
          currency: "USD",
          quoteId: `quote_action_wallet_${scenario.suffix}_1`
        },
        constraints: {
          maxDurationSeconds: 300,
          maxCostCents: 1700,
          retryLimit: 1
        },
        delegationGrantRef: grantId,
        approvalMode: "require",
        approvalPolicy: {
          requireApprovalAboveCents: 0,
          strictEvidenceRefs: true
        },
        traceId: `trace_action_wallet_${scenario.suffix}_1`
      }
    });
    assert.equal(seededBlockedWorkOrder.statusCode, 409, seededBlockedWorkOrder.body);
    const seededAuthorityEnvelope = seededBlockedWorkOrder.json?.details?.authorityEnvelope;
    const seededApprovalRequest = seededBlockedWorkOrder.json?.details?.approvalRequest;
    const actionIntentId = seededAuthorityEnvelope.envelopeId;

    const createdIntent = await request(api, {
      method: "POST",
      path: "/v1/action-intents",
      headers: { "x-idempotency-key": `v1_action_wallet_${scenario.suffix}_create_1` },
      body: {
        actionIntentId,
        authorityEnvelope: seededAuthorityEnvelope,
        host: {
          runtime: "claude-desktop",
          channel: "mcp",
          source: "test"
        }
      }
    });
    assert.equal(createdIntent.statusCode, 200, createdIntent.body);

    const approvalRequested = await request(api, {
      method: "POST",
      path: `/v1/action-intents/${encodeURIComponent(actionIntentId)}/approval-requests`,
      headers: { "x-idempotency-key": `v1_action_wallet_${scenario.suffix}_request_1` },
      body: {
        approvalRequest: seededApprovalRequest,
        requestedBy: seededApprovalRequest.requestedBy
      }
    });
    assert.equal(approvalRequested.statusCode, 200, approvalRequested.body);
    const approvalRequest = approvalRequested.json?.approvalRequest;

    const approved = await request(api, {
      method: "POST",
      path: `/v1/approval-requests/${encodeURIComponent(approvalRequest.requestId)}/decisions`,
      headers: { "x-idempotency-key": `v1_action_wallet_${scenario.suffix}_decide_1` },
      body: {
        approved: true,
        decidedBy: "human.ops",
        decidedAt: "2026-03-08T18:42:00.000Z",
        evidenceRefs: [`ticket:NOO-ACTION-WALLET-${scenario.suffix.toUpperCase()}-1`]
      }
    });
    assert.equal(approved.statusCode, 201, approved.body);

    const createdWorkOrder = await request(api, {
      method: "POST",
      path: "/work-orders",
      headers: { "x-idempotency-key": `v1_action_wallet_${scenario.suffix}_materialize_1` },
      body: {
        workOrderId,
        principalAgentId,
        subAgentId,
        requiredCapability: capability,
        pricing: {
          amountCents: 1700,
          currency: "USD",
          quoteId: `quote_action_wallet_${scenario.suffix}_1`
        },
        constraints: {
          maxDurationSeconds: 300,
          maxCostCents: 1700,
          retryLimit: 1
        },
        delegationGrantRef: grantId,
        approvalMode: "require",
        approvalPolicy: {
          requireApprovalAboveCents: 0,
          strictEvidenceRefs: true
        },
        traceId: `trace_action_wallet_${scenario.suffix}_1`,
        authorityEnvelope: approvalRequested.json?.authorityEnvelope,
        approvalRequest,
        approvalDecision: approved.json?.approvalDecision
      }
    });
    assert.equal(createdWorkOrder.statusCode, 201, createdWorkOrder.body);

    const evidence = await request(api, {
      method: "POST",
      path: `/v1/execution-grants/${encodeURIComponent(approvalRequest.requestId)}/evidence`,
      headers: { "x-idempotency-key": `v1_action_wallet_${scenario.suffix}_evidence_1` },
      body: {
        workOrderId,
        evidenceRefs: [`artifact://checkout/cart-${scenario.suffix}-1`, `report://verification/action-wallet-${scenario.suffix}-1`],
        message: "Attached verification evidence."
      }
    });
    assert.equal(evidence.statusCode, 200, evidence.body);

    const finalizeBlocked = await request(api, {
      method: "POST",
      path: `/v1/execution-grants/${encodeURIComponent(approvalRequest.requestId)}/finalize`,
      headers: { "x-idempotency-key": `v1_action_wallet_${scenario.suffix}_finalize_1` },
      body: {
        workOrderId,
        completion: {
          receiptId: `worec_action_wallet_${scenario.suffix}_1`,
          status: "success",
          verifierVerdict: scenario.verdict,
          outputs: {
            orderId: `order_action_wallet_${scenario.suffix}_1`
          },
          metrics: {
            steps: 2
          },
          evidenceRefs: [`artifact://checkout/cart-${scenario.suffix}-1`, `report://verification/action-wallet-${scenario.suffix}-1`],
          amountCents: 1700,
          currency: "USD",
          deliveredAt: "2026-03-08T18:43:00.000Z",
          completedAt: "2026-03-08T18:43:30.000Z"
        },
        settlement: {
          status: "released",
          x402GateId: `x402gate_action_wallet_${scenario.suffix}_1`,
          x402RunId: `run_action_wallet_${scenario.suffix}_1`,
          x402SettlementStatus: "released",
          x402ReceiptId: `x402rcpt_action_wallet_${scenario.suffix}_1`,
          settledAt: "2026-03-08T18:44:00.000Z"
        }
      }
    });
    assert.equal(finalizeBlocked.statusCode, 409, finalizeBlocked.body);
    assert.equal(finalizeBlocked.json?.code, scenario.expectedCode);

    const grantStatus = await request(api, {
      method: "GET",
      path: `/v1/execution-grants/${encodeURIComponent(approvalRequest.requestId)}`
    });
    assert.equal(grantStatus.statusCode, 200, grantStatus.body);
    assert.equal(grantStatus.json?.executionGrant?.status, "materialized");

    const actionIntentStatus = await request(api, {
      method: "GET",
      path: `/v1/approval-requests/${encodeURIComponent(approvalRequest.requestId)}`
    });
    assert.equal(actionIntentStatus.statusCode, 200, actionIntentStatus.body);
    assert.equal(actionIntentStatus.json?.actionIntent?.status, "evidence_submitted");
  }
});

test("API e2e: legacy work-order completion fails closed without an explicit verifier verdict for Action Wallet runs", async () => {
  const api = createApi({ now: () => "2026-03-08T16:00:00.000Z", opsToken: "tok_ops" });
  const materialized = await createMaterializedActionWallet(api, { suffix: "legacy_complete_gate" });

  const blockedCompletion = await request(api, {
    method: "POST",
    path: `/work-orders/${encodeURIComponent(materialized.workOrderId)}/complete`,
    headers: { "x-idempotency-key": "v1_action_wallet_legacy_complete_gate_1" },
    body: {
      outputs: {
        orderId: "order_action_wallet_legacy_complete_gate_1"
      },
      evidenceRefs: ["artifact://checkout/legacy-complete-gate-1"],
      amountCents: 1900,
      currency: "USD",
      deliveredAt: "2026-03-08T16:12:00.000Z",
      completedAt: "2026-03-08T16:12:30.000Z"
    }
  });
  assert.equal(blockedCompletion.statusCode, 409, blockedCompletion.body);
  assert.equal(blockedCompletion.json?.code, "WORK_ORDER_COMPLETION_BLOCKED");
  assert.equal(blockedCompletion.json?.details?.reasonCode, "ACTION_WALLET_VERIFIER_REQUIRED");
});

test("API e2e: legacy work-order settlement fails closed when an Action Wallet receipt is missing verifier verdict", async () => {
  const api = createApi({ now: () => "2026-03-08T16:00:00.000Z", opsToken: "tok_ops" });
  const materialized = await createMaterializedActionWallet(api, { suffix: "legacy_settle_gate" });
  const receiptId = "worec_action_wallet_legacy_settle_gate_1";

  const completed = await request(api, {
    method: "POST",
    path: `/work-orders/${encodeURIComponent(materialized.workOrderId)}/complete`,
    headers: { "x-idempotency-key": "v1_action_wallet_legacy_settle_complete_1" },
    body: {
      receiptId,
      outputs: {
        orderId: "order_action_wallet_legacy_settle_gate_1"
      },
      evidenceRefs: ["artifact://checkout/legacy-settle-gate-1"],
      amountCents: 1900,
      currency: "USD",
      deliveredAt: "2026-03-08T16:12:00.000Z",
      completedAt: "2026-03-08T16:12:30.000Z",
      metadata: {
        actionWalletVerifierVerdict: buildVerifierVerdict()
      }
    }
  });
  assert.equal(completed.statusCode, 200, completed.body);

  const tamperedReceipt = buildSubAgentCompletionReceiptV1({
    receiptId,
    tenantId: "tenant_default",
    workOrder: materialized.workOrder,
    status: completed.json?.completionReceipt?.status,
    outputs: completed.json?.completionReceipt?.outputs ?? null,
    metrics: completed.json?.completionReceipt?.metrics ?? null,
    evidenceRefs: completed.json?.completionReceipt?.evidenceRefs ?? [],
    executionAttestation: completed.json?.completionReceipt?.executionAttestation ?? null,
    amountCents: completed.json?.completionReceipt?.amountCents ?? null,
    currency: completed.json?.completionReceipt?.currency ?? null,
    intentHash: completed.json?.completionReceipt?.intentHash ?? null,
    traceId: completed.json?.completionReceipt?.traceId ?? null,
    deliveredAt: completed.json?.completionReceipt?.deliveredAt,
    metadata: {}
  });
  validateSubAgentCompletionReceiptV1(tamperedReceipt);
  const tamperedWorkOrder = completeSubAgentWorkOrderV1({
    workOrder: materialized.workOrder,
    completionReceipt: tamperedReceipt,
    completedAt: "2026-03-08T16:12:30.000Z"
  });
  validateSubAgentWorkOrderV1(tamperedWorkOrder);
  await api.store.putSubAgentCompletionReceipt({ tenantId: "tenant_default", receiptId, completionReceipt: tamperedReceipt });
  await api.store.putSubAgentWorkOrder({ tenantId: "tenant_default", workOrder: tamperedWorkOrder });

  const blockedSettlement = await request(api, {
    method: "POST",
    path: `/work-orders/${encodeURIComponent(materialized.workOrderId)}/settle`,
    headers: { "x-idempotency-key": "v1_action_wallet_legacy_settle_gate_1" },
    body: {
      completionReceiptId: receiptId,
      status: "released",
      x402GateId: "x402gate_action_wallet_legacy_settle_gate_1",
      x402RunId: "run_action_wallet_legacy_settle_gate_1",
      x402SettlementStatus: "released",
      x402ReceiptId: "x402rcpt_action_wallet_legacy_settle_gate_1",
      settledAt: "2026-03-08T16:13:00.000Z"
    }
  });
  assert.equal(blockedSettlement.statusCode, 409, blockedSettlement.body);
  assert.equal(blockedSettlement.json?.code, "WORK_ORDER_SETTLEMENT_BLOCKED");
  assert.equal(blockedSettlement.json?.details?.reasonCode, "ACTION_WALLET_VERIFIER_REQUIRED");
  assert.equal(blockedSettlement.json?.details?.completionReceiptId, receiptId);
});

test("API e2e: v1 disputes can open directly from an Action Wallet receipt context", async () => {
  const api = createApi({ now: () => "2026-03-08T19:00:00.000Z", opsToken: "tok_ops" });
  const principalAgentId = "agt_action_wallet_principal_dispute";
  const subAgentId = "agt_action_wallet_worker_dispute";
  const arbiterAgentId = "agt_action_wallet_arbiter_dispute";
  const capability = "capability://workflow.intake";
  const grantId = "dgrant_action_wallet_dispute_receipt_1";
  const workOrderId = "workord_action_wallet_dispute_receipt_1";
  const runId = "run_action_wallet_dispute_receipt_1";
  const receiptId = "worec_action_wallet_dispute_receipt_1";
  const disputeId = "dsp_action_wallet_dispute_receipt_1";

  await registerAgent(api, { agentId: principalAgentId, capabilities: [capability] });
  await registerAgent(api, { agentId: subAgentId, capabilities: [capability] });
  await registerAgent(api, { agentId: arbiterAgentId, capabilities: [capability] });
  await issueDelegationGrant(api, {
    grantId,
    delegatorAgentId: principalAgentId,
    delegateeAgentId: subAgentId,
    capability
  });
  await creditWallet(api, {
    agentId: principalAgentId,
    amountCents: 9_000,
    idempotencyKey: "credit_action_wallet_dispute_receipt_1"
  });
  await createCompletedRun(api, {
    payerAgentId: principalAgentId,
    payeeAgentId: subAgentId,
    runId,
    amountCents: 2100,
    idempotencyPrefix: "action_wallet_dispute_receipt_1"
  });

  const seededBlockedWorkOrder = await request(api, {
    method: "POST",
    path: "/work-orders",
    headers: { "x-idempotency-key": "v1_action_wallet_seed_dispute_receipt_1" },
    body: {
      workOrderId,
      principalAgentId,
      subAgentId,
      requiredCapability: capability,
      pricing: {
        amountCents: 2100,
        currency: "USD",
        quoteId: "quote_action_wallet_dispute_receipt_1"
      },
      constraints: {
        maxDurationSeconds: 300,
        maxCostCents: 2100,
        retryLimit: 1
      },
      delegationGrantRef: grantId,
      approvalMode: "require",
      approvalPolicy: {
        requireApprovalAboveCents: 0,
        strictEvidenceRefs: true
      },
      traceId: "trace_action_wallet_dispute_receipt_1"
    }
  });
  assert.equal(seededBlockedWorkOrder.statusCode, 409, seededBlockedWorkOrder.body);
  const seededAuthorityEnvelope = seededBlockedWorkOrder.json?.details?.authorityEnvelope;
  const seededApprovalRequest = seededBlockedWorkOrder.json?.details?.approvalRequest;
  const actionIntentId = seededAuthorityEnvelope.envelopeId;

  const createdIntent = await request(api, {
    method: "POST",
    path: "/v1/action-intents",
    headers: { "x-idempotency-key": "v1_action_wallet_dispute_receipt_create_1" },
    body: {
      actionIntentId,
      authorityEnvelope: seededAuthorityEnvelope,
      host: {
        runtime: "claude-desktop",
        channel: "mcp",
        source: "test"
      }
    }
  });
  assert.equal(createdIntent.statusCode, 200, createdIntent.body);

  const approvalRequested = await request(api, {
    method: "POST",
    path: `/v1/action-intents/${encodeURIComponent(actionIntentId)}/approval-requests`,
    headers: { "x-idempotency-key": "v1_action_wallet_dispute_receipt_request_1" },
    body: {
      approvalRequest: seededApprovalRequest,
      requestedBy: seededApprovalRequest.requestedBy
    }
  });
  assert.equal(approvalRequested.statusCode, 200, approvalRequested.body);
  const approvalRequest = approvalRequested.json?.approvalRequest;

  const approved = await request(api, {
    method: "POST",
    path: `/v1/approval-requests/${encodeURIComponent(approvalRequest.requestId)}/decisions`,
    headers: { "x-idempotency-key": "v1_action_wallet_dispute_receipt_decide_1" },
    body: {
      approved: true,
      decidedBy: "human.ops",
      decidedAt: "2026-03-08T19:05:00.000Z",
      evidenceRefs: ["ticket:NOO-ACTION-WALLET-DISPUTE-RECEIPT-1"]
    }
  });
  assert.equal(approved.statusCode, 201, approved.body);

  const createdWorkOrder = await request(api, {
    method: "POST",
    path: "/work-orders",
    headers: { "x-idempotency-key": "v1_action_wallet_dispute_receipt_materialize_1" },
    body: {
      workOrderId,
      principalAgentId,
      subAgentId,
      requiredCapability: capability,
      pricing: {
        amountCents: 2100,
        currency: "USD",
        quoteId: "quote_action_wallet_dispute_receipt_1"
      },
      constraints: {
        maxDurationSeconds: 300,
        maxCostCents: 2100,
        retryLimit: 1
      },
      delegationGrantRef: grantId,
      approvalMode: "require",
      approvalPolicy: {
        requireApprovalAboveCents: 0,
        strictEvidenceRefs: true
      },
      traceId: "trace_action_wallet_dispute_receipt_1",
      authorityEnvelope: approvalRequested.json?.authorityEnvelope,
      approvalRequest,
      approvalDecision: approved.json?.approvalDecision
    }
  });
  assert.equal(createdWorkOrder.statusCode, 201, createdWorkOrder.body);

  const evidence = await request(api, {
    method: "POST",
    path: `/v1/execution-grants/${encodeURIComponent(approvalRequest.requestId)}/evidence`,
    headers: { "x-idempotency-key": "v1_action_wallet_dispute_receipt_evidence_1" },
    body: {
      workOrderId,
      evidenceRefs: ["artifact://checkout/cart-dispute-1", "report://verification/action-wallet-dispute-1"],
      message: "Attached checkout evidence."
    }
  });
  assert.equal(evidence.statusCode, 200, evidence.body);

  const finalized = await request(api, {
    method: "POST",
    path: `/v1/execution-grants/${encodeURIComponent(approvalRequest.requestId)}/finalize`,
    headers: { "x-idempotency-key": "v1_action_wallet_dispute_receipt_finalize_1" },
    body: {
      workOrderId,
      completion: {
        receiptId,
        status: "success",
        verifierVerdict: buildVerifierVerdict(),
        outputs: {
          orderId: "order_action_wallet_dispute_receipt_1"
        },
        metrics: {
          steps: 3
        },
        evidenceRefs: ["artifact://checkout/cart-dispute-1", "report://verification/action-wallet-dispute-1"],
        amountCents: 2100,
        currency: "USD",
        deliveredAt: "2026-03-08T19:06:00.000Z",
        completedAt: "2026-03-08T19:06:30.000Z"
      },
      settlement: {
        status: "released",
        x402GateId: "x402gate_action_wallet_dispute_receipt_1",
        x402RunId: runId,
        x402SettlementStatus: "released",
        x402ReceiptId: "x402rcpt_action_wallet_dispute_receipt_1",
        settledAt: "2026-03-08T19:07:00.000Z"
      }
    }
  });
  assert.equal(finalized.statusCode, 200, finalized.body);

  const opened = await request(api, {
    method: "POST",
    path: "/v1/disputes",
    headers: {
      "x-idempotency-key": "v1_action_wallet_dispute_receipt_open_1",
      "x-nooterra-protocol": "1.0"
    },
    body: {
      receiptId,
      disputeId,
      reason: "Merchant delivered the wrong item",
      openedByAgentId: principalAgentId
    }
  });
  assert.equal(opened.statusCode, 200, opened.body);
  assert.equal(opened.json?.disputeCase?.disputeId, disputeId);
  assert.equal(opened.json?.disputeCase?.status, "opened");

  const openedReceipt = await request(api, {
    method: "GET",
    path: `/v1/receipts/${encodeURIComponent(receiptId)}`
  });
  assert.equal(openedReceipt.statusCode, 200, openedReceipt.body);
  assert.equal(openedReceipt.json?.actionReceipt?.disputeState?.disputeId, disputeId);
  assert.equal(openedReceipt.json?.actionReceipt?.disputeState?.status, "open");
  assert.equal(openedReceipt.json?.detail?.disputeState?.disputeId, disputeId);
  assert.equal(openedReceipt.json?.detail?.disputeState?.status, "open");
});
