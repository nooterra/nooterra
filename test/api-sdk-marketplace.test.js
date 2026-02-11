import test from "node:test";
import assert from "node:assert/strict";

import { SettldClient } from "../packages/api-sdk/src/index.js";

function makeJsonResponse(body, { status = 200, requestId = "req_sdk_market_1" } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "x-request-id": requestId
    }
  });
}

test("api-sdk: marketplace rfq/bid methods call expected endpoints", async () => {
  const calls = [];
  const fetchStub = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/marketplace/rfqs") && String(init?.method) === "POST") {
      return makeJsonResponse({ rfq: { schemaVersion: "MarketplaceRfq.v1", rfqId: "rfq_1", status: "open", currency: "USD" } }, { status: 201 });
    }
    if (String(url).includes("/marketplace/rfqs?")) {
      return makeJsonResponse({ rfqs: [], total: 0, limit: 10, offset: 0 });
    }
    if (String(url).includes("/marketplace/rfqs/rfq_1/bids?")) {
      return makeJsonResponse({ rfqId: "rfq_1", bids: [], total: 0, limit: 10, offset: 0 });
    }
    if (String(url).endsWith("/marketplace/rfqs/rfq_1/bids")) {
      return makeJsonResponse(
        {
          rfq: { schemaVersion: "MarketplaceRfq.v1", rfqId: "rfq_1", status: "open", currency: "USD" },
          bid: { schemaVersion: "MarketplaceBid.v1", bidId: "bid_1", rfqId: "rfq_1", status: "pending", amountCents: 1000, currency: "USD" }
        },
        { status: 201 }
      );
    }
    if (String(url).endsWith("/marketplace/rfqs/rfq_1/bids/bid_1/counter-offer")) {
      return makeJsonResponse({
        rfq: { schemaVersion: "MarketplaceRfq.v1", rfqId: "rfq_1", status: "open", currency: "USD" },
        bid: {
          schemaVersion: "MarketplaceBid.v1",
          bidId: "bid_1",
          rfqId: "rfq_1",
          status: "pending",
          amountCents: 900,
          currency: "USD"
        },
        negotiation: {
          schemaVersion: "MarketplaceBidNegotiation.v1",
          bidId: "bid_1",
          state: "open",
          latestRevision: 2,
          proposals: [
            { schemaVersion: "MarketplaceBidProposal.v1", proposalId: "ofr_bid_1_1", bidId: "bid_1", revision: 1, proposerAgentId: "agt_2", amountCents: 1000, currency: "USD", verificationMethod: { schemaVersion: "VerificationMethod.v1", mode: "deterministic" }, policy: { schemaVersion: "SettlementPolicy.v1", policyVersion: 1, mode: "automatic", policyHash: "hash_1", rules: { requireDeterministicVerification: false, autoReleaseOnGreen: true, autoReleaseOnAmber: true, autoReleaseOnRed: false, greenReleaseRatePct: 100, amberReleaseRatePct: 50, redReleaseRatePct: 0 } }, proposedAt: "2026-02-06T00:00:00.000Z" },
            { schemaVersion: "MarketplaceBidProposal.v1", proposalId: "ofr_bid_1_2", bidId: "bid_1", revision: 2, proposerAgentId: "agt_1", amountCents: 900, currency: "USD", verificationMethod: { schemaVersion: "VerificationMethod.v1", mode: "deterministic" }, policy: { schemaVersion: "SettlementPolicy.v1", policyVersion: 1, mode: "automatic", policyHash: "hash_1", rules: { requireDeterministicVerification: false, autoReleaseOnGreen: true, autoReleaseOnAmber: true, autoReleaseOnRed: false, greenReleaseRatePct: 100, amberReleaseRatePct: 50, redReleaseRatePct: 0 } }, proposedAt: "2026-02-06T00:01:00.000Z" }
          ],
          createdAt: "2026-02-06T00:00:00.000Z",
          updatedAt: "2026-02-06T00:01:00.000Z"
        },
        proposal: { schemaVersion: "MarketplaceBidProposal.v1", proposalId: "ofr_bid_1_2", bidId: "bid_1", revision: 2, proposerAgentId: "agt_1", amountCents: 900, currency: "USD", verificationMethod: { schemaVersion: "VerificationMethod.v1", mode: "deterministic" }, policy: { schemaVersion: "SettlementPolicy.v1", policyVersion: 1, mode: "automatic", policyHash: "hash_1", rules: { requireDeterministicVerification: false, autoReleaseOnGreen: true, autoReleaseOnAmber: true, autoReleaseOnRed: false, greenReleaseRatePct: 100, amberReleaseRatePct: 50, redReleaseRatePct: 0 } }, proposedAt: "2026-02-06T00:01:00.000Z" }
      });
    }
    if (String(url).endsWith("/marketplace/rfqs/rfq_1/accept")) {
      return makeJsonResponse({
        rfq: { schemaVersion: "MarketplaceRfq.v1", rfqId: "rfq_1", status: "assigned", acceptedBidId: "bid_1", currency: "USD" },
        acceptedBid: { schemaVersion: "MarketplaceBid.v1", bidId: "bid_1", rfqId: "rfq_1", status: "accepted", amountCents: 1000, currency: "USD" }
      });
    }
    if (String(url).endsWith("/runs/run_1/settlement/policy-replay")) {
      return makeJsonResponse({
        runId: "run_1",
        verificationStatus: "green",
        replay: { decision: { shouldAutoResolve: true } },
        settlement: { schemaVersion: "AgentRunSettlement.v1", settlementId: "setl_run_1", runId: "run_1", status: "locked", amountCents: 1000 },
        matchesStoredDecision: false
      });
    }
    if (String(url).endsWith("/runs/run_1/agreement")) {
      return makeJsonResponse({
        runId: "run_1",
        rfqId: "rfq_1",
        agreementId: "agr_1",
        agreement: {
          schemaVersion: "MarketplaceTaskAgreement.v2",
          agreementId: "agr_1",
          runId: "run_1",
          rfqId: "rfq_1",
          bidId: "bid_1",
          tenantId: "tenant_sdk",
          payerAgentId: "agt_1",
          payeeAgentId: "agt_2",
          fromType: "agent",
          toType: "agent",
          amountCents: 1000,
          currency: "USD",
          acceptedAt: "2026-02-06T00:00:00.000Z",
          disputeWindowDays: 3,
          termsHash: "hash_terms",
          verificationMethodHash: "hash_method",
          policyHash: "hash_policy"
        },
        policyBindingVerification: { present: true, valid: true }
      });
    }
    if (String(url).endsWith("/runs/run_1/agreement/change-order")) {
      return makeJsonResponse({
        runId: "run_1",
        rfq: { schemaVersion: "MarketplaceRfq.v1", rfqId: "rfq_1", status: "assigned", currency: "USD" },
        agreement: { schemaVersion: "MarketplaceTaskAgreement.v2", agreementId: "agr_1", runId: "run_1", rfqId: "rfq_1", bidId: "bid_1", tenantId: "tenant_sdk", payerAgentId: "agt_1", payeeAgentId: "agt_2", fromType: "agent", toType: "agent", amountCents: 1000, currency: "USD", acceptedAt: "2026-02-06T00:00:00.000Z", disputeWindowDays: 3, termsHash: "hash_terms", verificationMethodHash: "hash_method", policyHash: "hash_policy" },
        changeOrder: { changeOrderId: "chg_1" }
      });
    }
    if (String(url).endsWith("/runs/run_1/agreement/cancel")) {
      return makeJsonResponse({
        runId: "run_1",
        rfq: { schemaVersion: "MarketplaceRfq.v1", rfqId: "rfq_1", status: "cancelled", currency: "USD" },
        run: { schemaVersion: "AgentRun.v1", runId: "run_1", agentId: "agt_2", tenantId: "tenant_sdk", status: "failed", createdAt: "2026-02-06T00:00:00.000Z", updatedAt: "2026-02-06T00:01:00.000Z" },
        settlement: { schemaVersion: "AgentRunSettlement.v1", settlementId: "setl_run_1", runId: "run_1", status: "released", amountCents: 1000 },
        agreement: { schemaVersion: "MarketplaceTaskAgreement.v2", agreementId: "agr_1", runId: "run_1", rfqId: "rfq_1", bidId: "bid_1", tenantId: "tenant_sdk", payerAgentId: "agt_1", payeeAgentId: "agt_2", fromType: "agent", toType: "agent", amountCents: 1000, currency: "USD", acceptedAt: "2026-02-06T00:00:00.000Z", disputeWindowDays: 3, termsHash: "hash_terms", verificationMethodHash: "hash_method", policyHash: "hash_policy" },
        cancellation: { cancellationId: "cancel_1", reason: "buyer cancelled before start" }
      });
    }
    if (String(url).endsWith("/runs/run_1/settlement/resolve")) {
      return makeJsonResponse({
        settlement: { schemaVersion: "AgentRunSettlement.v1", settlementId: "setl_run_1", runId: "run_1", status: "released", amountCents: 1000 }
      });
    }
    return makeJsonResponse({});
  };

  const client = new SettldClient({ baseUrl: "https://api.settld.local", tenantId: "tenant_sdk", fetch: fetchStub });

  await client.createMarketplaceRfq({
    rfqId: "rfq_1",
    title: "Translate docs",
    capability: "translate",
    posterAgentId: "agt_1",
    budgetCents: 2000
  });
  assert.equal(calls[0].url, "https://api.settld.local/marketplace/rfqs");
  assert.equal(calls[0].init?.method, "POST");

  await client.listMarketplaceRfqs({ status: "open", capability: "translate", posterAgentId: "agt_1", limit: 10, offset: 0 });
  assert.equal(
    calls[1].url,
    "https://api.settld.local/marketplace/rfqs?status=open&capability=translate&posterAgentId=agt_1&limit=10&offset=0"
  );
  assert.equal(calls[1].init?.method, "GET");

  await client.submitMarketplaceBid("rfq_1", {
    bidId: "bid_1",
    bidderAgentId: "agt_2",
    amountCents: 1000,
    currency: "USD",
    etaSeconds: 900,
    verificationMethod: {
      mode: "attested",
      verificationMethodHash: "vm_hash_1"
    },
    policy: {
      policyVersion: 1,
      policyHash: "pol_hash_1"
    }
  });
  assert.equal(calls[2].url, "https://api.settld.local/marketplace/rfqs/rfq_1/bids");
  assert.equal(calls[2].init?.method, "POST");
  const submitBidBody = JSON.parse(String(calls[2].init?.body ?? "{}"));
  assert.equal(submitBidBody?.verificationMethod?.verificationMethodHash, "vm_hash_1");
  assert.equal(submitBidBody?.policy?.policyHash, "pol_hash_1");

  await client.listMarketplaceBids("rfq_1", { status: "pending", bidderAgentId: "agt_2", limit: 10, offset: 0 });
  assert.equal(
    calls[3].url,
    "https://api.settld.local/marketplace/rfqs/rfq_1/bids?status=pending&bidderAgentId=agt_2&limit=10&offset=0"
  );
  assert.equal(calls[3].init?.method, "GET");

  await client.applyMarketplaceBidCounterOffer("rfq_1", "bid_1", { proposerAgentId: "agt_1", amountCents: 900 });
  assert.equal(calls[4].url, "https://api.settld.local/marketplace/rfqs/rfq_1/bids/bid_1/counter-offer");
  assert.equal(calls[4].init?.method, "POST");

  await client.acceptMarketplaceBid("rfq_1", {
    bidId: "bid_1",
    acceptedByAgentId: "agt_1",
    acceptanceSignature: {
      signerAgentId: "agt_delegate",
      signerKeyId: "kid_delegate",
      signedAt: "2026-03-02T12:00:00.000Z",
      actingOnBehalfOf: {
        schemaVersion: "AgentActingOnBehalfOf.v1",
        principalAgentId: "agt_1",
        delegateAgentId: "agt_delegate",
        delegationChain: [
          {
            schemaVersion: "AgentDelegationLink.v1",
            delegationId: "dlg_1",
            tenantId: "tenant_sdk",
            principalAgentId: "agt_1",
            delegateAgentId: "agt_delegate",
            scope: "marketplace.agreement.accept",
            issuedAt: "2026-03-01T00:00:00.000Z",
            signerKeyId: "kid_1",
            delegationHash: "hash_delegation_1",
            signature: "sig_delegation_1"
          }
        ]
      },
      signature: "sig_accept_1"
    }
  });
  assert.equal(calls[5].url, "https://api.settld.local/marketplace/rfqs/rfq_1/accept");
  assert.equal(calls[5].init?.method, "POST");
  const acceptBody = JSON.parse(String(calls[5].init?.body ?? "{}"));
  assert.equal(acceptBody?.acceptanceSignature?.actingOnBehalfOf?.principalAgentId, "agt_1");
  assert.equal(
    acceptBody?.acceptanceSignature?.actingOnBehalfOf?.delegationChain?.[0]?.delegateAgentId,
    "agt_delegate"
  );

  await client.applyRunAgreementChangeOrder("run_1", {
    requestedByAgentId: "agt_1",
    acceptedByAgentId: "agt_2",
    reason: "scope changed",
    milestones: [{ milestoneId: "draft", releaseRatePct: 50 }]
  });
  assert.equal(calls[6].url, "https://api.settld.local/runs/run_1/agreement/change-order");
  assert.equal(calls[6].init?.method, "POST");
  assert.equal(JSON.parse(String(calls[6].init?.body ?? "{}")).acceptedByAgentId, "agt_2");

  await client.cancelRunAgreement("run_1", {
    cancellationId: "cancel_1",
    cancelledByAgentId: "agt_1",
    acceptedByAgentId: "agt_2",
    reason: "buyer cancelled before start",
    evidenceRef: "evidence://run_1/cancel-note.json"
  });
  assert.equal(calls[7].url, "https://api.settld.local/runs/run_1/agreement/cancel");
  assert.equal(calls[7].init?.method, "POST");
  assert.equal(JSON.parse(String(calls[7].init?.body ?? "{}")).acceptedByAgentId, "agt_2");

  await client.getRunSettlementPolicyReplay("run_1");
  assert.equal(calls[8].url, "https://api.settld.local/runs/run_1/settlement/policy-replay");
  assert.equal(calls[8].init?.method, "GET");

  await client.getRunAgreement("run_1");
  assert.equal(calls[9].url, "https://api.settld.local/runs/run_1/agreement");
  assert.equal(calls[9].init?.method, "GET");

  await client.resolveRunSettlement("run_1", { status: "released", reason: "manual approve" });
  assert.equal(calls[10].url, "https://api.settld.local/runs/run_1/settlement/resolve");
  assert.equal(calls[10].init?.method, "POST");
});

test("api-sdk: marketplace manual-review settlement and dispute lifecycle remain stable", async () => {
  const calls = [];
  const fetchStub = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/runs/run_manual_1/settlement/policy-replay")) {
      return makeJsonResponse({
        runId: "run_manual_1",
        verificationStatus: "amber",
        replay: { decision: { shouldAutoResolve: false } },
        settlement: {
          schemaVersion: "AgentRunSettlement.v1",
          settlementId: "setl_run_manual_1",
          runId: "run_manual_1",
          status: "locked",
          amountCents: 1500,
          disputeWindowDays: 2,
          decisionStatus: "manual_review_required"
        },
        matchesStoredDecision: true
      });
    }
    if (String(url).endsWith("/runs/run_manual_1/settlement/resolve")) {
      return makeJsonResponse({
        settlement: {
          schemaVersion: "AgentRunSettlement.v1",
          settlementId: "setl_run_manual_1",
          runId: "run_manual_1",
          status: "released",
          amountCents: 1500,
          disputeWindowDays: 2,
          disputeWindowEndsAt: "2026-02-09T00:00:00.000Z",
          decisionStatus: "manual_resolved",
          decisionReason: "manual policy override"
        }
      });
    }
    if (String(url).endsWith("/runs/run_manual_1/dispute/open")) {
      return makeJsonResponse({
        settlement: {
          schemaVersion: "AgentRunSettlement.v1",
          settlementId: "setl_run_manual_1",
          runId: "run_manual_1",
          status: "released",
          disputeStatus: "open",
          disputeId: "dsp_manual_1",
          disputeContext: {
            type: "quality",
            priority: "normal",
            channel: "counterparty",
            escalationLevel: "l1_counterparty"
          }
        },
        disputeEvidence: null,
        disputeEscalation: null,
        verdict: null,
        verdictArtifact: null
      });
    }
    if (String(url).endsWith("/runs/run_manual_1/dispute/evidence")) {
      return makeJsonResponse({
        settlement: {
          schemaVersion: "AgentRunSettlement.v1",
          settlementId: "setl_run_manual_1",
          runId: "run_manual_1",
          status: "released",
          disputeStatus: "open",
          disputeId: "dsp_manual_1"
        },
        disputeEvidence: {
          evidenceRef: "evidence://run_manual_1/counterparty-note.json",
          submittedAt: "2026-02-07T00:00:00.000Z"
        },
        disputeEscalation: null,
        verdict: null,
        verdictArtifact: null
      });
    }
    if (String(url).endsWith("/runs/run_manual_1/dispute/escalate")) {
      return makeJsonResponse({
        settlement: {
          schemaVersion: "AgentRunSettlement.v1",
          settlementId: "setl_run_manual_1",
          runId: "run_manual_1",
          status: "released",
          disputeStatus: "open",
          disputeId: "dsp_manual_1",
          disputeContext: {
            type: "quality",
            priority: "normal",
            channel: "arbiter",
            escalationLevel: "l2_arbiter"
          }
        },
        disputeEvidence: null,
        disputeEscalation: {
          previousEscalationLevel: "l1_counterparty",
          escalationLevel: "l2_arbiter",
          channel: "arbiter",
          escalatedAt: "2026-02-07T00:01:00.000Z"
        },
        verdict: null,
        verdictArtifact: null
      });
    }
    if (String(url).endsWith("/runs/run_manual_1/dispute/close")) {
      return makeJsonResponse({
        settlement: {
          schemaVersion: "AgentRunSettlement.v1",
          settlementId: "setl_run_manual_1",
          runId: "run_manual_1",
          status: "released",
          disputeStatus: "closed",
          disputeId: "dsp_manual_1",
          disputeResolution: {
            outcome: "partial",
            escalationLevel: "l2_arbiter",
            summary: "partial adjustment accepted"
          }
        },
        disputeEvidence: null,
        disputeEscalation: null,
        verdict: null,
        verdictArtifact: null
      });
    }
    return makeJsonResponse({});
  };

  const client = new SettldClient({ baseUrl: "https://api.settld.local", tenantId: "tenant_sdk", fetch: fetchStub });

  const replay = await client.getRunSettlementPolicyReplay("run_manual_1");
  assert.equal(replay.body?.replay?.decision?.shouldAutoResolve, false);
  assert.equal(replay.body?.settlement?.decisionStatus, "manual_review_required");

  const resolved = await client.resolveRunSettlement("run_manual_1", {
    status: "released",
    releaseRatePct: 100,
    resolvedByAgentId: "agt_operator",
    reason: "manual policy override"
  }, { idempotencyKey: "sdk_manual_resolve_1" });
  assert.equal(resolved.body?.settlement?.decisionStatus, "manual_resolved");
  assert.equal(resolved.body?.settlement?.disputeWindowDays, 2);

  const opened = await client.openRunDispute("run_manual_1", {
    disputeId: "dsp_manual_1",
    disputeType: "quality",
    disputePriority: "normal",
    disputeChannel: "counterparty",
    escalationLevel: "l1_counterparty",
    openedByAgentId: "agt_operator",
    reason: "post-manual review"
  }, { idempotencyKey: "sdk_manual_dispute_open_1" });
  assert.equal(opened.body?.settlement?.disputeStatus, "open");

  const evidenced = await client.submitRunDisputeEvidence("run_manual_1", {
    disputeId: "dsp_manual_1",
    evidenceRef: "evidence://run_manual_1/counterparty-note.json",
    submittedByAgentId: "agt_operator"
  }, { idempotencyKey: "sdk_manual_dispute_evidence_1" });
  assert.equal(evidenced.body?.disputeEvidence?.evidenceRef, "evidence://run_manual_1/counterparty-note.json");

  const escalated = await client.escalateRunDispute("run_manual_1", {
    disputeId: "dsp_manual_1",
    escalationLevel: "l2_arbiter",
    escalatedByAgentId: "agt_operator",
    reason: "counterparty deadlock"
  }, { idempotencyKey: "sdk_manual_dispute_escalate_1" });
  assert.equal(escalated.body?.disputeEscalation?.escalationLevel, "l2_arbiter");

  const closed = await client.closeRunDispute("run_manual_1", {
    disputeId: "dsp_manual_1",
    resolutionOutcome: "partial",
    resolutionEscalationLevel: "l2_arbiter",
    resolutionSummary: "partial adjustment accepted",
    closedByAgentId: "agt_operator"
  }, { idempotencyKey: "sdk_manual_dispute_close_1" });
  assert.equal(closed.body?.settlement?.disputeStatus, "closed");
  assert.equal(closed.body?.settlement?.disputeResolution?.outcome, "partial");

  assert.equal(calls[0].url, "https://api.settld.local/runs/run_manual_1/settlement/policy-replay");
  assert.equal(calls[1].url, "https://api.settld.local/runs/run_manual_1/settlement/resolve");
  assert.equal(calls[2].url, "https://api.settld.local/runs/run_manual_1/dispute/open");
  assert.equal(calls[3].url, "https://api.settld.local/runs/run_manual_1/dispute/evidence");
  assert.equal(calls[4].url, "https://api.settld.local/runs/run_manual_1/dispute/escalate");
  assert.equal(calls[5].url, "https://api.settld.local/runs/run_manual_1/dispute/close");

  assert.equal(calls[0].init?.method, "GET");
  assert.equal(calls[1].init?.method, "POST");
  assert.equal(calls[2].init?.method, "POST");
  assert.equal(calls[3].init?.method, "POST");
  assert.equal(calls[4].init?.method, "POST");
  assert.equal(calls[5].init?.method, "POST");

  const resolveBody = JSON.parse(String(calls[1].init?.body ?? "{}"));
  assert.equal(resolveBody?.status, "released");
  assert.equal(resolveBody?.resolvedByAgentId, "agt_operator");

  const openBody = JSON.parse(String(calls[2].init?.body ?? "{}"));
  assert.equal(openBody?.disputeId, "dsp_manual_1");
  assert.equal(openBody?.escalationLevel, "l1_counterparty");

  const evidenceBody = JSON.parse(String(calls[3].init?.body ?? "{}"));
  assert.equal(evidenceBody?.evidenceRef, "evidence://run_manual_1/counterparty-note.json");

  const escalateBody = JSON.parse(String(calls[4].init?.body ?? "{}"));
  assert.equal(escalateBody?.escalationLevel, "l2_arbiter");

  const closeBody = JSON.parse(String(calls[5].init?.body ?? "{}"));
  assert.equal(closeBody?.resolutionOutcome, "partial");
  assert.equal(closeBody?.resolutionEscalationLevel, "l2_arbiter");

  assert.equal(calls[1].init?.headers?.["x-idempotency-key"], "sdk_manual_resolve_1");
  assert.equal(calls[2].init?.headers?.["x-idempotency-key"], "sdk_manual_dispute_open_1");
  assert.equal(calls[3].init?.headers?.["x-idempotency-key"], "sdk_manual_dispute_evidence_1");
  assert.equal(calls[4].init?.headers?.["x-idempotency-key"], "sdk_manual_dispute_escalate_1");
  assert.equal(calls[5].init?.headers?.["x-idempotency-key"], "sdk_manual_dispute_close_1");
});
