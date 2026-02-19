import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createEd25519Keypair, sha256Hex } from "../src/core/crypto.js";
import { parseSettldPayTokenV1 } from "../src/core/settld-pay-token.js";
import { request } from "./api-test-harness.js";

async function registerAgent(api, { agentId }) {
  const { publicKeyPem } = createEd25519Keypair();
  const created = await request(api, {
    method: "POST",
    path: "/agents/register",
    headers: { "x-idempotency-key": `agent_register_${agentId}` },
    body: {
      agentId,
      displayName: `Agent ${agentId}`,
      owner: { ownerType: "service", ownerId: "svc_test" },
      publicKeyPem
    }
  });
  assert.equal(created.statusCode, 201, created.body);
  return {
    agentId,
    keyId: String(created.json?.keyId ?? "")
  };
}

async function creditWallet(api, { agentId, amountCents, idempotencyKey }) {
  const response = await request(api, {
    method: "POST",
    path: `/agents/${encodeURIComponent(agentId)}/wallet/credit`,
    headers: { "x-idempotency-key": idempotencyKey },
    body: { amountCents, currency: "USD" }
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json?.wallet ?? null;
}

async function createAgreementDelegation(
  api,
  {
    parentAgreementHash,
    delegationId,
    childAgreementHash,
    delegatorAgentId,
    delegateeAgentId,
    budgetCapCents,
    delegationDepth,
    maxDelegationDepth,
    idempotencyKey
  }
) {
  const response = await request(api, {
    method: "POST",
    path: `/agreements/${encodeURIComponent(parentAgreementHash)}/delegations`,
    headers: { "x-idempotency-key": idempotencyKey },
    body: {
      delegationId,
      childAgreementHash,
      delegatorAgentId,
      delegateeAgentId,
      budgetCapCents,
      currency: "USD",
      delegationDepth,
      maxDelegationDepth
    }
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json?.delegation ?? null;
}

test("API e2e: x402 wallet issuer exposes policy, ledger, and budget snapshots", async () => {
  const api = createApi({ opsToken: "tok_ops" });

  const payer = await registerAgent(api, { agentId: "agt_x402_wallet_issuer_payer_1" });
  const payee = await registerAgent(api, { agentId: "agt_x402_wallet_issuer_payee_1" });
  await creditWallet(api, {
    agentId: payer.agentId,
    amountCents: 5000,
    idempotencyKey: "wallet_credit_x402_wallet_issuer_1"
  });

  const sponsorRef = "sponsor_wallet_issuer_1";
  const sponsorWalletRef = "x402wallet_issuer_1";

  const createdWallet = await request(api, {
    method: "POST",
    path: "/x402/wallets",
    headers: { "x-idempotency-key": "x402_wallet_issuer_create_1" },
    body: {
      sponsorRef,
      sponsorWalletRef,
      policy: {
        policyRef: "default",
        policyVersion: 1,
        maxAmountCents: 1000,
        maxDailyAuthorizationCents: 2000,
        allowedProviderIds: [payee.agentId],
        allowedToolIds: ["mock_weather"],
        allowedAgentKeyIds: [payer.keyId],
        allowedCurrencies: ["USD"],
        requireQuote: false,
        requireStrictRequestBinding: false,
        requireAgentKeyMatch: true
      }
    }
  });
  assert.equal(createdWallet.statusCode, 201, createdWallet.body);
  assert.equal(createdWallet.json?.wallet?.sponsorWalletRef, sponsorWalletRef);
  assert.equal(createdWallet.json?.wallet?.sponsorRef, sponsorRef);
  assert.equal(createdWallet.json?.policy?.policyRef, "default");
  assert.equal(createdWallet.json?.policy?.policyVersion, 1);

  const updatedPolicy = await request(api, {
    method: "PUT",
    path: `/x402/wallets/${encodeURIComponent(sponsorWalletRef)}/policy`,
    headers: { "x-idempotency-key": "x402_wallet_issuer_policy_put_2" },
    body: {
      sponsorRef,
      policy: {
        policyRef: "default",
        policyVersion: 2,
        maxAmountCents: 1500,
        maxDailyAuthorizationCents: 2500,
        allowedProviderIds: [payee.agentId],
        allowedToolIds: ["mock_weather"],
        allowedAgentKeyIds: [payer.keyId],
        allowedCurrencies: ["USD"],
        requireQuote: false,
        requireStrictRequestBinding: false,
        requireAgentKeyMatch: true
      }
    }
  });
  assert.equal(updatedPolicy.statusCode, 201, updatedPolicy.body);
  assert.equal(updatedPolicy.json?.policy?.policyVersion, 2);
  assert.equal(updatedPolicy.json?.wallet?.activePolicyVersion, 2);

  const listedPolicies = await request(api, {
    method: "GET",
    path: `/x402/wallets/${encodeURIComponent(sponsorWalletRef)}/policy?limit=10`
  });
  assert.equal(listedPolicies.statusCode, 200, listedPolicies.body);
  assert.equal(Array.isArray(listedPolicies.json?.policies), true);
  assert.equal(listedPolicies.json.policies.length >= 2, true);

  const gateId = "gate_x402_wallet_issuer_1";
  const amountCents = 400;
  const createdGate = await request(api, {
    method: "POST",
    path: "/x402/gate/create",
    headers: { "x-idempotency-key": "x402_gate_wallet_issuer_create_1" },
    body: {
      gateId,
      payerAgentId: payer.agentId,
      payeeAgentId: payee.agentId,
      amountCents,
      currency: "USD",
      toolId: "mock_weather",
      agentPassport: {
        sponsorRef,
        sponsorWalletRef,
        agentKeyId: payer.keyId,
        policyRef: "default",
        policyVersion: 2
      }
    }
  });
  assert.equal(createdGate.statusCode, 201, createdGate.body);

  const authorized = await request(api, {
    method: "POST",
    path: "/x402/gate/authorize-payment",
    headers: { "x-idempotency-key": "x402_gate_wallet_issuer_authz_1" },
    body: { gateId }
  });
  assert.equal(authorized.statusCode, 409, authorized.body);
  assert.equal(authorized.json?.code, "X402_WALLET_ISSUER_DECISION_REQUIRED");

  const issuedDecision = await request(api, {
    method: "POST",
    path: `/x402/wallets/${encodeURIComponent(sponsorWalletRef)}/authorize`,
    headers: { "x-idempotency-key": "x402_wallet_issuer_authorize_1" },
    body: { gateId }
  });
  assert.equal(issuedDecision.statusCode, 200, issuedDecision.body);
  assert.ok(typeof issuedDecision.json?.walletAuthorizationDecisionToken === "string" && issuedDecision.json.walletAuthorizationDecisionToken.length > 0);

  const authorizedWithDecision = await request(api, {
    method: "POST",
    path: "/x402/gate/authorize-payment",
    headers: { "x-idempotency-key": "x402_gate_wallet_issuer_authz_1b" },
    body: {
      gateId,
      walletAuthorizationDecisionToken: issuedDecision.json?.walletAuthorizationDecisionToken
    }
  });
  assert.equal(authorizedWithDecision.statusCode, 200, authorizedWithDecision.body);
  assert.equal(authorizedWithDecision.json?.reserve?.status, "reserved");

  const requestSha256 = sha256Hex("GET\nexample.com\n/tools/weather?city=seattle\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  const responseSha256 = sha256Hex("{\"ok\":true,\"city\":\"Seattle\"}");
  const verified = await request(api, {
    method: "POST",
    path: "/x402/gate/verify",
    headers: { "x-idempotency-key": "x402_gate_wallet_issuer_verify_1" },
    body: {
      gateId,
      verificationStatus: "green",
      runStatus: "completed",
      policy: {
        mode: "automatic",
        rules: {
          autoReleaseOnGreen: true,
          greenReleaseRatePct: 100,
          autoReleaseOnAmber: false,
          amberReleaseRatePct: 0,
          autoReleaseOnRed: true,
          redReleaseRatePct: 0
        }
      },
      verificationMethod: { mode: "deterministic", source: "http_status_v1" },
      evidenceRefs: [`http:request_sha256:${requestSha256}`, `http:response_sha256:${responseSha256}`]
    }
  });
  assert.equal(verified.statusCode, 200, verified.body);
  assert.equal(verified.json?.settlement?.status, "released");

  const ledger = await request(api, {
    method: "GET",
    path: `/x402/wallets/${encodeURIComponent(sponsorWalletRef)}/ledger?limit=10`
  });
  assert.equal(ledger.statusCode, 200, ledger.body);
  assert.equal(ledger.json?.ok, true);
  assert.equal(Array.isArray(ledger.json?.entries), true);
  assert.equal(ledger.json.entries.length, 1);
  assert.equal(ledger.json.entries[0]?.sponsorWalletRef, sponsorWalletRef);
  assert.equal(ledger.json.entries[0]?.amountCents, amountCents);
  assert.equal(ledger.json.entries[0]?.netAmountCents, amountCents);
  assert.equal(ledger.json.summary?.grossAuthorizedCents, amountCents);
  assert.equal(ledger.json.summary?.netSettledCents, amountCents);

  const budgets = await request(api, {
    method: "GET",
    path: `/x402/wallets/${encodeURIComponent(sponsorWalletRef)}/budgets`
  });
  assert.equal(budgets.statusCode, 200, budgets.body);
  assert.equal(budgets.json?.ok, true);
  assert.equal(budgets.json?.policy?.policyVersion, 2);
  assert.equal(budgets.json?.budgets?.maxAmountCents, 1500);
  assert.equal(budgets.json?.budgets?.maxDailyAuthorizationCents, 2500);
  assert.equal(budgets.json?.budgets?.dailyAuthorizedExposureCents, amountCents);
  assert.equal(budgets.json?.budgets?.remainingDailyAuthorizationCents, 2500 - amountCents);
  assert.equal(budgets.json?.budgets?.authorizationSummary?.settledCount, 1);
  assert.equal(budgets.json?.budgets?.authorizationSummary?.settledAmountCents, amountCents);
});

test("API e2e: x402 wallet issuer authorize enforces delegation lineage and persists binding lineage refs", async () => {
  const api = createApi({ opsToken: "tok_ops" });

  const principal = await registerAgent(api, { agentId: "agt_x402_wallet_issuer_lineage_principal_1" });
  const manager = await registerAgent(api, { agentId: "agt_x402_wallet_issuer_lineage_manager_1" });
  const payer = await registerAgent(api, { agentId: "agt_x402_wallet_issuer_lineage_payer_1" });
  const payee = await registerAgent(api, { agentId: "agt_x402_wallet_issuer_lineage_payee_1" });
  await creditWallet(api, {
    agentId: payer.agentId,
    amountCents: 6000,
    idempotencyKey: "wallet_credit_x402_wallet_issuer_lineage_1"
  });

  const sponsorRef = "sponsor_wallet_issuer_lineage_1";
  const sponsorWalletRef = "x402wallet_issuer_lineage_1";
  const createdWallet = await request(api, {
    method: "POST",
    path: "/x402/wallets",
    headers: { "x-idempotency-key": "x402_wallet_issuer_lineage_create_1" },
    body: {
      sponsorRef,
      sponsorWalletRef,
      policy: {
        policyRef: "lineage_default",
        policyVersion: 1,
        maxAmountCents: 1000,
        maxDailyAuthorizationCents: 3000,
        allowedProviderIds: [payee.agentId],
        allowedToolIds: ["mock_weather"],
        allowedAgentKeyIds: [payer.keyId],
        allowedCurrencies: ["USD"],
        requireQuote: false,
        requireStrictRequestBinding: false,
        requireAgentKeyMatch: true
      }
    }
  });
  assert.equal(createdWallet.statusCode, 201, createdWallet.body);

  const rootAgreementHash = sha256Hex("agreement_wallet_issuer_lineage_root_1");
  const middleAgreementHash = sha256Hex("agreement_wallet_issuer_lineage_middle_1");
  const leafAgreementHash = sha256Hex("agreement_wallet_issuer_lineage_leaf_1");
  const rootDelegation = await createAgreementDelegation(api, {
    parentAgreementHash: rootAgreementHash,
    delegationId: "dlg_wallet_issuer_lineage_root_1",
    childAgreementHash: middleAgreementHash,
    delegatorAgentId: principal.agentId,
    delegateeAgentId: manager.agentId,
    budgetCapCents: 3000,
    delegationDepth: 0,
    maxDelegationDepth: 2,
    idempotencyKey: "agreement_wallet_issuer_lineage_root_1"
  });
  const leafDelegation = await createAgreementDelegation(api, {
    parentAgreementHash: middleAgreementHash,
    delegationId: "dlg_wallet_issuer_lineage_leaf_1",
    childAgreementHash: leafAgreementHash,
    delegatorAgentId: manager.agentId,
    delegateeAgentId: payer.agentId,
    budgetCapCents: 2000,
    delegationDepth: 1,
    maxDelegationDepth: 2,
    idempotencyKey: "agreement_wallet_issuer_lineage_leaf_1"
  });
  assert.ok(rootDelegation?.delegationHash);
  assert.ok(leafDelegation?.delegationHash);

  const nowIso = new Date().toISOString();
  const gateId = "gate_x402_wallet_issuer_lineage_1";
  const createdGate = await request(api, {
    method: "POST",
    path: "/x402/gate/create",
    headers: { "x-idempotency-key": "x402_gate_wallet_issuer_lineage_create_1" },
    body: {
      gateId,
      payerAgentId: payer.agentId,
      payeeAgentId: payee.agentId,
      amountCents: 450,
      currency: "USD",
      toolId: "mock_weather",
      agentPassport: {
        schemaVersion: "AgentPassport.v1",
        passportId: "passport_wallet_issuer_lineage_1",
        agentId: payer.agentId,
        tenantId: "tenant_default",
        principalRef: {
          principalType: "service",
          principalId: sponsorRef
        },
        identityAnchors: {
          jwksUri: "https://example.com/.well-known/jwks.json",
          activeKeyId: payer.keyId,
          keysetHash: sha256Hex("wallet_issuer_lineage_keyset_1")
        },
        delegationRoot: {
          rootGrantId: "dlg_wallet_issuer_lineage_root_1",
          rootGrantHash: rootDelegation.delegationHash,
          issuedAt: nowIso,
          expiresAt: null,
          revokedAt: null
        },
        policyEnvelope: {
          maxPerCallCents: 1000,
          maxDailyCents: 3000,
          allowedRiskClasses: ["read"],
          requireApprovalAboveCents: null,
          allowlistRefs: ["lineage_default"]
        },
        status: "active",
        metadata: {
          x402: {
            sponsorWalletRef,
            policyRef: "lineage_default",
            policyVersion: 1,
            delegationRef: "dlg_wallet_issuer_lineage_leaf_1",
            delegationDepth: 1,
            maxDelegationDepth: 2
          }
        },
        createdAt: nowIso,
        updatedAt: nowIso
      }
    }
  });
  assert.equal(createdGate.statusCode, 201, createdGate.body);

  const issuedDecision = await request(api, {
    method: "POST",
    path: `/x402/wallets/${encodeURIComponent(sponsorWalletRef)}/authorize`,
    headers: { "x-idempotency-key": "x402_wallet_issuer_lineage_authorize_1" },
    body: { gateId }
  });
  assert.equal(issuedDecision.statusCode, 200, issuedDecision.body);

  const authorized = await request(api, {
    method: "POST",
    path: "/x402/gate/authorize-payment",
    headers: { "x-idempotency-key": "x402_gate_wallet_issuer_lineage_authz_1" },
    body: {
      gateId,
      walletAuthorizationDecisionToken: issuedDecision.json?.walletAuthorizationDecisionToken
    }
  });
  assert.equal(authorized.statusCode, 200, authorized.body);
  const tokenPayload = parseSettldPayTokenV1(authorized.json?.token ?? "").payload;
  assert.equal(tokenPayload.rootDelegationRef, "dlg_wallet_issuer_lineage_root_1");
  assert.equal(tokenPayload.rootDelegationHash, rootDelegation.delegationHash);
  assert.equal(tokenPayload.effectiveDelegationRef, "dlg_wallet_issuer_lineage_leaf_1");
  assert.equal(tokenPayload.effectiveDelegationHash, leafDelegation.delegationHash);

  const gateRead = await request(api, {
    method: "GET",
    path: `/x402/gate/${encodeURIComponent(gateId)}`
  });
  assert.equal(gateRead.statusCode, 200, gateRead.body);
  assert.equal(gateRead.json?.gate?.authorization?.authorityGrantRef, "dlg_wallet_issuer_lineage_leaf_1");
  assert.equal(gateRead.json?.gate?.authorization?.delegationLineage?.rootDelegationRef, "dlg_wallet_issuer_lineage_root_1");
  assert.equal(gateRead.json?.gate?.authorization?.delegationLineage?.rootDelegationHash, rootDelegation.delegationHash);
  assert.equal(gateRead.json?.gate?.authorization?.delegationLineage?.effectiveDelegationRef, "dlg_wallet_issuer_lineage_leaf_1");
  assert.equal(gateRead.json?.gate?.authorization?.delegationLineage?.effectiveDelegationHash, leafDelegation.delegationHash);
  assert.equal(
    gateRead.json?.gate?.authorization?.delegationLineage?.resolution?.leafDelegationId,
    "dlg_wallet_issuer_lineage_leaf_1"
  );
});
