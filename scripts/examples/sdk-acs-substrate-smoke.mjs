import { generateKeyPairSync } from "node:crypto";

import { SettldClient } from "../../packages/api-sdk/src/index.js";

function uniqueSuffix() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function futureIso(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function generatePublicKeyPem() {
  const { publicKey } = generateKeyPairSync("ed25519");
  return publicKey.export({ format: "pem", type: "spki" }).toString("utf8");
}

function requireBody(response, label) {
  if (!response || typeof response !== "object") throw new Error(`${label}: response missing`);
  const body = response.body;
  if (!body || typeof body !== "object") throw new Error(`${label}: body missing`);
  if (body.ok === false) throw new Error(`${label}: body.ok is false`);
  return body;
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}: expected object`);
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label}: expected non-empty string`);
  return value.trim();
}

async function main() {
  const baseUrl = process.env.SETTLD_BASE_URL ?? "http://127.0.0.1:3000";
  const tenantId = process.env.SETTLD_TENANT_ID ?? "tenant_default";
  const apiKey = process.env.SETTLD_API_KEY ?? "";

  const client = new SettldClient({
    baseUrl,
    tenantId,
    apiKey: apiKey || undefined
  });

  const suffix = uniqueSuffix();
  const capabilityId = "travel.booking";
  const principalAgentId = `agt_js_acs_principal_${suffix}`;
  const workerAgentId = `agt_js_acs_worker_${suffix}`;

  requireBody(
    await client.registerAgent({
      agentId: principalAgentId,
      displayName: "JS ACS Principal",
      owner: { ownerType: "service", ownerId: "svc_js_acs" },
      capabilities: [capabilityId, "travel.policy"],
      publicKeyPem: generatePublicKeyPem()
    }),
    "register principal"
  );
  requireBody(
    await client.registerAgent({
      agentId: workerAgentId,
      displayName: "JS ACS Worker",
      owner: { ownerType: "service", ownerId: "svc_js_acs" },
      capabilities: [capabilityId, "travel.pricing"],
      publicKeyPem: generatePublicKeyPem()
    }),
    "register worker"
  );

  requireBody(
    await client.upsertAgentCard({
      agentId: principalAgentId,
      displayName: "JS ACS Principal",
      description: "principal coordinator",
      capabilities: [capabilityId],
      visibility: "public",
      host: { runtime: "openclaw", endpoint: "https://example.invalid/principal" },
      priceHint: { amountCents: 250, currency: "USD" }
    }),
    "upsert principal card"
  );
  requireBody(
    await client.upsertAgentCard({
      agentId: workerAgentId,
      displayName: "JS ACS Worker",
      description: "specialized travel worker",
      capabilities: [capabilityId],
      visibility: "public",
      host: { runtime: "codex", endpoint: "https://example.invalid/worker" },
      priceHint: { amountCents: 180, currency: "USD" }
    }),
    "upsert worker card"
  );

  const tenantDiscovery = requireBody(
    await client.discoverAgentCards({
      capability: capabilityId,
      includeReputation: true,
      includeRoutingFactors: true,
      requesterAgentId: principalAgentId,
      limit: 5
    }),
    "tenant discovery"
  );
  const publicDiscovery = requireBody(
    await client.discoverPublicAgentCards({
      capability: capabilityId,
      includeReputation: false,
      limit: 5
    }),
    "public discovery"
  );

  const delegationGrant = requireObject(
    requireBody(
      await client.issueDelegationGrant({
        delegatorAgentId: principalAgentId,
        delegateeAgentId: workerAgentId,
        scope: {
          allowedRiskClasses: ["financial"],
          sideEffectingAllowed: true
        },
        spendLimit: {
          currency: "USD",
          maxPerCallCents: 5000,
          maxTotalCents: 20000
        },
        chainBinding: { depth: 0, maxDelegationDepth: 0 },
        validity: { expiresAt: futureIso(48) }
      }),
      "issue delegation grant"
    ).delegationGrant,
    "delegationGrant"
  );
  const delegationGrantId = requireString(delegationGrant.grantId, "delegationGrant.grantId");
  requireBody(await client.getDelegationGrant(delegationGrantId), "get delegation grant");
  requireBody(await client.listDelegationGrants({ grantId: delegationGrantId }), "list delegation grants");

  const authorityGrant = requireObject(
    requireBody(
      await client.createAuthorityGrant({
        principalRef: { principalType: "service", principalId: "svc_js_acs" },
        granteeAgentId: principalAgentId,
        scope: {
          allowedRiskClasses: ["financial"],
          sideEffectingAllowed: true
        },
        spendEnvelope: {
          currency: "USD",
          maxPerCallCents: 5000,
          maxTotalCents: 20000
        },
        chainBinding: { depth: 0, maxDelegationDepth: 0 },
        validity: { expiresAt: futureIso(48) }
      }),
      "issue authority grant"
    ).authorityGrant,
    "authorityGrant"
  );
  const authorityGrantId = requireString(authorityGrant.grantId, "authorityGrant.grantId");
  requireBody(await client.getAuthorityGrant(authorityGrantId), "get authority grant");
  requireBody(await client.listAuthorityGrants({ grantId: authorityGrantId }), "list authority grants");

  const taskQuote = requireObject(
    requireBody(
      await client.createTaskQuote({
        buyerAgentId: principalAgentId,
        sellerAgentId: workerAgentId,
        requiredCapability: capabilityId,
        pricing: { amountCents: 1500, currency: "USD" }
      }),
      "create task quote"
    ).taskQuote,
    "taskQuote"
  );
  const quoteId = requireString(taskQuote.quoteId, "taskQuote.quoteId");
  requireBody(await client.getTaskQuote(quoteId), "get task quote");

  const taskOffer = requireObject(
    requireBody(
      await client.createTaskOffer({
        buyerAgentId: principalAgentId,
        sellerAgentId: workerAgentId,
        quoteRef: { quoteId, quoteHash: taskQuote.quoteHash },
        pricing: { amountCents: 1500, currency: "USD" }
      }),
      "create task offer"
    ).taskOffer,
    "taskOffer"
  );
  const offerId = requireString(taskOffer.offerId, "taskOffer.offerId");
  requireBody(await client.getTaskOffer(offerId), "get task offer");

  const taskAcceptance = requireObject(
    requireBody(
      await client.createTaskAcceptance({
        quoteId,
        offerId,
        acceptedByAgentId: workerAgentId
      }),
      "create task acceptance"
    ).taskAcceptance,
    "taskAcceptance"
  );
  const acceptanceId = requireString(taskAcceptance.acceptanceId, "taskAcceptance.acceptanceId");
  const acceptanceHash = requireString(taskAcceptance.acceptanceHash, "taskAcceptance.acceptanceHash");
  requireBody(await client.getTaskAcceptance(acceptanceId), "get task acceptance");

  const workOrder = requireObject(
    requireBody(
      await client.createWorkOrder({
        principalAgentId,
        subAgentId: workerAgentId,
        requiredCapability: capabilityId,
        pricing: { amountCents: 1500, currency: "USD" },
        acceptanceRef: { acceptanceId, acceptanceHash },
        delegationGrantRef: delegationGrantId,
        authorityGrantRef: authorityGrantId,
        specification: { task: "book flight + hotel options" }
      }),
      "create work order"
    ).workOrder,
    "workOrder"
  );
  const workOrderId = requireString(workOrder.workOrderId, "workOrder.workOrderId");
  requireBody(await client.getWorkOrder(workOrderId), "get work order");
  requireBody(await client.acceptWorkOrder(workOrderId, { acceptedByAgentId: workerAgentId }), "accept work order");
  requireBody(
    await client.progressWorkOrder(workOrderId, {
      eventType: "progress",
      message: "gathering options",
      percentComplete: 50
    }),
    "progress work order"
  );
  const completeBody = requireBody(
    await client.completeWorkOrder(workOrderId, {
      outputs: { itineraryOptions: 3 },
      metrics: { latencyMs: 850 },
      amountCents: 1500,
      currency: "USD"
    }),
    "complete work order"
  );
  const completionReceipt = requireObject(completeBody.completionReceipt, "completionReceipt");
  const completionReceiptId = requireString(completionReceipt.receiptId, "completionReceipt.receiptId");
  const receiptsBody = requireBody(await client.listWorkOrderReceipts({ workOrderId }), "list work order receipts");
  requireBody(await client.getWorkOrderReceipt(completionReceiptId), "get work order receipt");

  const session = requireObject(
    requireBody(
      await client.createSession({
        participants: [principalAgentId, workerAgentId],
        visibility: "tenant",
        metadata: { topic: "travel coordination" }
      }),
      "create session"
    ).session,
    "session"
  );
  const sessionId = requireString(session.sessionId, "session.sessionId");
  const sessionEventsBefore = requireBody(await client.listSessionEvents(sessionId, { limit: 5, offset: 0 }), "list session events before");
  const rawPrevChainHash = sessionEventsBefore.currentPrevChainHash;
  const prevChainHash = typeof rawPrevChainHash === "string" && rawPrevChainHash.trim() !== "" ? rawPrevChainHash.trim() : "null";
  requireBody(
    await client.appendSessionEvent(
      sessionId,
      {
        type: "message",
        payload: { text: "delegate travel booking with budget cap" }
      },
      { expectedPrevChainHash: prevChainHash }
    ),
    "append session event"
  );
  const sessionEventsAfter = requireBody(await client.listSessionEvents(sessionId, { limit: 10, offset: 0 }), "list session events after");
  requireBody(await client.getSessionReplayPack(sessionId), "get session replay pack");
  requireBody(await client.getSessionTranscript(sessionId), "get session transcript");

  const attestationBody = requireBody(
    await client.createCapabilityAttestation({
      subjectAgentId: workerAgentId,
      issuerAgentId: principalAgentId,
      capability: capabilityId,
      level: "attested",
      validity: { expiresAt: futureIso(48) }
    }),
    "create capability attestation"
  );
  const capabilityAttestation = requireObject(attestationBody.capabilityAttestation, "capabilityAttestation");
  const capabilityAttestationId = requireString(capabilityAttestation.attestationId, "capabilityAttestation.attestationId");
  const listAttestations = requireBody(
    await client.listCapabilityAttestations({ subjectAgentId: workerAgentId, capability: capabilityId }),
    "list capability attestations"
  );
  const getAttestation = requireBody(await client.getCapabilityAttestation(capabilityAttestationId), "get capability attestation");
  requireBody(
    await client.revokeCapabilityAttestation(capabilityAttestationId, { reasonCode: "REVOKED_BY_ISSUER" }),
    "revoke capability attestation"
  );

  const revokedDelegation = requireBody(
    await client.revokeDelegationGrant(delegationGrantId, { reasonCode: "REVOKED_BY_PRINCIPAL" }),
    "revoke delegation grant"
  );
  const revokedAuthority = requireBody(
    await client.revokeAuthorityGrant(authorityGrantId, { reasonCode: "REVOKED_BY_PRINCIPAL" }),
    "revoke authority grant"
  );

  const summary = {
    principalAgentId,
    workerAgentId,
    tenantDiscoveryCount: Array.isArray(tenantDiscovery.results) ? tenantDiscovery.results.length : 0,
    publicDiscoveryCount: Array.isArray(publicDiscovery.results) ? publicDiscovery.results.length : 0,
    delegationGrantId,
    authorityGrantId,
    workOrderId,
    workOrderStatus: completeBody.workOrder?.status ?? null,
    completionReceiptId,
    completionStatus: completionReceipt.status ?? null,
    workOrderReceiptCount: Array.isArray(receiptsBody.receipts) ? receiptsBody.receipts.length : 0,
    sessionId,
    sessionEventCount: Array.isArray(sessionEventsAfter.events) ? sessionEventsAfter.events.length : 0,
    attestationId: capabilityAttestationId,
    attestationRuntimeStatus: getAttestation.runtime?.status ?? null,
    attestationListCount: Array.isArray(listAttestations.attestations) ? listAttestations.attestations.length : 0,
    delegationRevokedAt: revokedDelegation.delegationGrant?.revocation?.revokedAt ?? null,
    authorityRevokedAt: revokedAuthority.authorityGrant?.revocation?.revokedAt ?? null
  };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

await main();
