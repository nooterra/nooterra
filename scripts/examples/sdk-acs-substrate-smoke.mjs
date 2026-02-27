import { createHash, generateKeyPairSync } from "node:crypto";

import { NooterraClient } from "../../packages/api-sdk/src/index.js";

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

function sha256HexFromString(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
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
  const baseUrl = process.env.NOOTERRA_BASE_URL ?? "http://127.0.0.1:3000";
  const tenantId = process.env.NOOTERRA_TENANT_ID ?? "tenant_default";
  const apiKey = process.env.NOOTERRA_API_KEY ?? "";

  const client = new NooterraClient({
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
      host: { runtime: "nooterra", endpoint: "https://example.invalid/worker" },
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
        chainBinding: { depth: 0, maxDelegationDepth: 1 },
        validity: { expiresAt: futureIso(48) }
      }),
      "issue authority grant"
    ).authorityGrant,
    "authorityGrant"
  );
  const authorityGrantId = requireString(authorityGrant.grantId, "authorityGrant.grantId");
  requireBody(await client.getAuthorityGrant(authorityGrantId), "get authority grant");
  requireBody(await client.listAuthorityGrants({ grantId: authorityGrantId }), "list authority grants");
  const authorityRootGrantHash = requireString(
    authorityGrant.chainBinding?.rootGrantHash ?? authorityGrant.grantHash,
    "authorityGrant.chainBinding.rootGrantHash"
  );
  const authorityGrantHash = requireString(authorityGrant.grantHash, "authorityGrant.grantHash");

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
        chainBinding: {
          rootGrantHash: authorityRootGrantHash,
          parentGrantHash: authorityGrantHash,
          depth: 1,
          maxDelegationDepth: 1
        },
        validity: { expiresAt: futureIso(48) }
      }),
      "issue delegation grant"
    ).delegationGrant,
    "delegationGrant"
  );
  const delegationGrantId = requireString(delegationGrant.grantId, "delegationGrant.grantId");
  requireBody(await client.getDelegationGrant(delegationGrantId), "get delegation grant");
  requireBody(await client.listDelegationGrants({ grantId: delegationGrantId }), "list delegation grants");

  const checkpointDelegationGrant = requireObject(
    requireBody(
      await client.issueDelegationGrant({
        delegatorAgentId: workerAgentId,
        delegateeAgentId: principalAgentId,
        scope: {
          allowedRiskClasses: ["financial"],
          sideEffectingAllowed: true
        },
        spendLimit: {
          currency: "USD",
          maxPerCallCents: 1000,
          maxTotalCents: 10000
        },
        chainBinding: {
          rootGrantHash: authorityRootGrantHash,
          parentGrantHash: authorityGrantHash,
          depth: 1,
          maxDelegationDepth: 1
        },
        validity: { expiresAt: futureIso(48) }
      }),
      "issue checkpoint delegation grant"
    ).delegationGrant,
    "checkpointDelegationGrant"
  );
  const checkpointDelegationGrantId = requireString(checkpointDelegationGrant.grantId, "checkpointDelegationGrant.grantId");

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
        metering: {
          mode: "metered",
          requireFinalMeterEvidence: true,
          enforceFinalReconcile: true,
          maxTopUpCents: 1000,
          unit: "usd_cents"
        },
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
  requireBody(
    await client.topUpWorkOrder(workOrderId, {
      topUpId: `topup_${suffix}`,
      amountCents: 250,
      quantity: 1
    }),
    "work order topup"
  );
  const workOrderMeteringBody = requireBody(
    await client.getWorkOrderMetering(workOrderId, { includeMeters: true, limit: 10, offset: 0 }),
    "work order metering"
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
      }, { principalId: principalAgentId }),
      "create session"
    ).session,
    "session"
  );
  const sessionId = requireString(session.sessionId, "session.sessionId");
  const sessionEventsBefore = requireBody(
    await client.listSessionEvents(sessionId, { limit: 5, offset: 0 }, { principalId: principalAgentId }),
    "list session events before"
  );
  const rawPrevChainHash = sessionEventsBefore.currentPrevChainHash;
  const prevChainHash = typeof rawPrevChainHash === "string" && rawPrevChainHash.trim() !== "" ? rawPrevChainHash.trim() : "null";
  requireBody(
    await client.appendSessionEvent(
      sessionId,
      {
        type: "message",
        payload: { text: "delegate travel booking with budget cap" }
      },
      { expectedPrevChainHash: prevChainHash, principalId: principalAgentId }
    ),
    "append session event"
  );
  const sessionEventsAfter = requireBody(
    await client.listSessionEvents(sessionId, { limit: 10, offset: 0 }, { principalId: principalAgentId }),
    "list session events after"
  );
  requireBody(await client.getSessionReplayPack(sessionId, {}, { principalId: principalAgentId }), "get session replay pack");
  requireBody(await client.getSessionTranscript(sessionId, {}, { principalId: principalAgentId }), "get session transcript");

  const checkpointTraceId = `trace_checkpoint_${suffix}`;
  const stateSnapshot = JSON.stringify({ itineraryOptions: 3, preferredClass: "economy", budgetCents: 150000 });
  const diffA = JSON.stringify({ field: "itineraryOptions", previous: 0, next: 3 });
  const diffB = JSON.stringify({ field: "budgetCents", previous: 0, next: 150000 });
  const stateCheckpointBody = requireBody(
    await client.createStateCheckpoint({
      ownerAgentId: principalAgentId,
      projectId: `proj_${suffix}`,
      sessionId,
      traceId: checkpointTraceId,
      delegationGrantRef: checkpointDelegationGrantId,
      authorityGrantRef: authorityGrantId,
      stateRef: {
        artifactId: `art_state_${suffix}`,
        artifactHash: sha256HexFromString(stateSnapshot),
        contentType: "application/json",
        uri: `memory://state/${suffix}`
      },
      diffRefs: [
        {
          artifactId: `art_diff_a_${suffix}`,
          artifactHash: sha256HexFromString(diffA),
          contentType: "application/json",
          uri: `memory://diff/a/${suffix}`
        },
        {
          artifactId: `art_diff_b_${suffix}`,
          artifactHash: sha256HexFromString(diffB),
          contentType: "application/json",
          uri: `memory://diff/b/${suffix}`
        }
      ],
      metadata: { source: "sdk-acs-substrate-smoke-js" }
    }),
    "create state checkpoint"
  );
  const stateCheckpoint = requireObject(stateCheckpointBody.stateCheckpoint, "stateCheckpoint");
  const checkpointId = requireString(stateCheckpoint.checkpointId, "stateCheckpoint.checkpointId");
  const checkpointHash = requireString(stateCheckpoint.checkpointHash, "stateCheckpoint.checkpointHash");
  const listedStateCheckpoints = requireBody(
    await client.listStateCheckpoints({
      ownerAgentId: principalAgentId,
      traceId: checkpointTraceId,
      limit: 10,
      offset: 0
    }),
    "list state checkpoints"
  );
  const fetchedStateCheckpointBody = requireBody(await client.getStateCheckpoint(checkpointId), "get state checkpoint");
  const fetchedStateCheckpoint = requireObject(fetchedStateCheckpointBody.stateCheckpoint, "fetchedStateCheckpoint");
  const checkpointDelegationGrantRef = requireString(
    fetchedStateCheckpoint.delegationGrantRef,
    "fetchedStateCheckpoint.delegationGrantRef"
  );
  const checkpointAuthorityGrantRef = requireString(
    fetchedStateCheckpoint.authorityGrantRef,
    "fetchedStateCheckpoint.authorityGrantRef"
  );

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

  let publicReputationSummary = {
    agentId: workerAgentId,
    relationships: []
  };
  try {
    const publicReputationSummaryBody = requireBody(
      await client.getPublicAgentReputationSummary(workerAgentId, {
        reputationVersion: "v2",
        reputationWindow: "30d",
        asOf: new Date().toISOString(),
        includeRelationships: true,
        relationshipLimit: 5
      }),
      "get public reputation summary"
    );
    publicReputationSummary = requireObject(publicReputationSummaryBody.summary, "publicReputationSummary");
  } catch (err) {
    const code = err?.nooterra?.code ?? err?.code ?? null;
    if (code !== "PUBLIC_REPUTATION_SUMMARY_DISABLED") throw err;
  }

  const interactionGraphPackBody = requireBody(
    await client.getAgentInteractionGraphPack(workerAgentId, {
      reputationVersion: "v2",
      reputationWindow: "30d",
      asOf: new Date().toISOString(),
      counterpartyAgentId: principalAgentId,
      visibility: "all",
      limit: 10,
      offset: 0
    }),
    "get interaction graph pack"
  );
  const interactionGraphPack = requireObject(interactionGraphPackBody.graphPack, "interactionGraphPack");
  const interactionGraphRelationships = Array.isArray(interactionGraphPack.relationships)
    ? interactionGraphPack.relationships
    : [];

  const relationshipsResult = requireBody(
    await client.listRelationships({
      agentId: workerAgentId,
      counterpartyAgentId: principalAgentId,
      reputationWindow: "30d",
      asOf: new Date().toISOString(),
      visibility: "all",
      limit: 10,
      offset: 0
    }),
    "list relationships"
  );
  const relationships = Array.isArray(relationshipsResult.relationships) ? relationshipsResult.relationships : [];

  const revokedDelegation = requireBody(
    await client.revokeDelegationGrant(delegationGrantId, { reasonCode: "REVOKED_BY_PRINCIPAL" }),
    "revoke delegation grant"
  );
  requireBody(
    await client.revokeDelegationGrant(checkpointDelegationGrantId, { reasonCode: "REVOKED_BY_PRINCIPAL" }),
    "revoke checkpoint delegation grant"
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
    workOrderMeterCount:
      Number.isSafeInteger(Number(workOrderMeteringBody?.metering?.meterCount ?? Number.NaN))
        ? Number(workOrderMeteringBody.metering.meterCount)
        : 0,
    workOrderMeterDigest:
      typeof workOrderMeteringBody?.metering?.meterDigest === "string" ? workOrderMeteringBody.metering.meterDigest : null,
    sessionId,
    sessionEventCount: Array.isArray(sessionEventsAfter.events) ? sessionEventsAfter.events.length : 0,
    checkpointId,
    checkpointHash,
    checkpointListCount: Array.isArray(listedStateCheckpoints.stateCheckpoints) ? listedStateCheckpoints.stateCheckpoints.length : 0,
    checkpointDelegationGrantRef,
    checkpointAuthorityGrantRef,
    attestationId: capabilityAttestationId,
    attestationRuntimeStatus: getAttestation.runtime?.status ?? null,
    attestationListCount: Array.isArray(listAttestations.attestations) ? listAttestations.attestations.length : 0,
    publicReputationSummaryAgentId: requireString(publicReputationSummary.agentId, "publicReputationSummary.agentId"),
    publicReputationRelationshipCount: Array.isArray(publicReputationSummary.relationships)
      ? publicReputationSummary.relationships.length
      : 0,
    interactionGraphRelationshipCount: interactionGraphRelationships.length,
    relationshipsCount: relationships.length,
    delegationRevokedAt: revokedDelegation.delegationGrant?.revocation?.revokedAt ?? null,
    authorityRevokedAt: revokedAuthority.authorityGrant?.revocation?.revokedAt ?? null
  };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

await main();
