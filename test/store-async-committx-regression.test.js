import test from "node:test";
import assert from "node:assert/strict";

import { createStore } from "../src/api/store.js";
import { createEd25519Keypair, keyIdFromPublicKeyPem } from "../src/core/crypto.js";

test("store: putAgentIdentity/putAgentWallet work when commitTx is async", async () => {
  const store = createStore();
  const originalCommitTx = store.commitTx.bind(store);
  store.commitTx = async function commitTxAsync(args) {
    await new Promise((resolve) => setTimeout(resolve, 1));
    return originalCommitTx(args);
  };

  const { publicKeyPem } = createEd25519Keypair();
  const keyId = keyIdFromPublicKeyPem(publicKeyPem);

  const identity = await store.putAgentIdentity({
    tenantId: "tenant_async_commit",
    agentIdentity: {
      schemaVersion: "AgentIdentity.v1",
      agentId: "agt_async_commit_1",
      tenantId: "tenant_async_commit",
      displayName: "Async Commit Agent",
      status: "active",
      owner: { ownerType: "service", ownerId: "svc_async_commit" },
      keys: { keyId, algorithm: "ed25519", publicKeyPem },
      capabilities: ["test"],
      walletPolicy: null,
      metadata: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  });
  assert.ok(identity);
  assert.equal(identity.agentId, "agt_async_commit_1");

  const wallet = await store.putAgentWallet({
    tenantId: "tenant_async_commit",
    wallet: {
      schemaVersion: "AgentWallet.v1",
      tenantId: "tenant_async_commit",
      agentId: "agt_async_commit_1",
      walletId: "wallet_agt_async_commit_1",
      currency: "USD",
      availableCents: 0,
      escrowLockedCents: 0,
      totalCreditedCents: 0,
      totalDebitedCents: 0,
      revision: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  });
  assert.ok(wallet);
  assert.equal(wallet.agentId, "agt_async_commit_1");
});
