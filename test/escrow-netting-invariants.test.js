import test from "node:test";
import assert from "node:assert/strict";

import {
  createAgentWallet,
  creditAgentWallet,
  lockAgentWalletEscrow,
  releaseAgentWalletEscrowToPayee,
  refundAgentWalletEscrow,
  createAgentRunSettlement,
  resolveAgentRunSettlement
} from "../src/core/agent-wallets.js";

test("escrow invariant: lock then refund returns payer availability and clears escrow", () => {
  const at = "2026-02-07T00:00:00.000Z";
  const payer = createAgentWallet({ tenantId: "tenant_s0", agentId: "agt_payer", at });
  const credited = creditAgentWallet({ wallet: payer, amountCents: 2000, at });
  const locked = lockAgentWalletEscrow({ wallet: credited, amountCents: 700, at });
  const refunded = refundAgentWalletEscrow({ wallet: locked, amountCents: 700, at });

  assert.equal(locked.availableCents, 1300);
  assert.equal(locked.escrowLockedCents, 700);
  assert.equal(refunded.availableCents, 2000);
  assert.equal(refunded.escrowLockedCents, 0);
});

test("escrow invariant: release debits payer escrow and credits payee availability", () => {
  const at = "2026-02-07T00:00:00.000Z";
  const payer = creditAgentWallet({
    wallet: createAgentWallet({ tenantId: "tenant_s0", agentId: "agt_payer_rel", at }),
    amountCents: 2500,
    at
  });
  const payee = createAgentWallet({ tenantId: "tenant_s0", agentId: "agt_payee_rel", at });

  const payerLocked = lockAgentWalletEscrow({ wallet: payer, amountCents: 1000, at });
  const released = releaseAgentWalletEscrowToPayee({ payerWallet: payerLocked, payeeWallet: payee, amountCents: 1000, at });

  assert.equal(released.payerWallet.escrowLockedCents, 0);
  assert.equal(released.payerWallet.totalDebitedCents, 1000);
  assert.equal(released.payeeWallet.availableCents, 1000);
  assert.equal(released.payeeWallet.totalCreditedCents, 1000);
});

test("settlement invariant: resolution is single-shot and amount partition is conserved", () => {
  const at = "2026-02-07T00:00:00.000Z";
  const settlement = createAgentRunSettlement({
    tenantId: "tenant_s0",
    runId: "run_s0_partition",
    agentId: "agt_payee",
    payerAgentId: "agt_payer",
    amountCents: 1000,
    currency: "USD",
    at
  });

  const resolved = resolveAgentRunSettlement({
    settlement,
    status: "released",
    runStatus: "completed",
    releasedAmountCents: 600,
    refundedAmountCents: 400,
    at
  });

  assert.equal(resolved.status, "released");
  assert.equal(resolved.releasedAmountCents + resolved.refundedAmountCents, resolved.amountCents);

  assert.throws(
    () =>
      resolveAgentRunSettlement({
        settlement: resolved,
        status: "released",
        runStatus: "completed",
        at
      }),
    /settlement already resolved/
  );
});

test("escrow netting invariant: high-frequency release/refund cycles conserve wallet totals", () => {
  const atBase = Date.parse("2026-02-07T00:00:00.000Z");
  let payer = createAgentWallet({ tenantId: "tenant_s0", agentId: "agt_payer_hf", at: new Date(atBase).toISOString() });
  let payee = createAgentWallet({ tenantId: "tenant_s0", agentId: "agt_payee_hf", at: new Date(atBase).toISOString() });
  payer = creditAgentWallet({ wallet: payer, amountCents: 50_000, at: new Date(atBase + 1).toISOString() });

  let totalReleased = 0;
  let totalRefunded = 0;
  const txCount = 200;
  for (let i = 0; i < txCount; i += 1) {
    const amount = 50 + (i % 25);
    const releaseAmount = Math.floor((amount * ((i % 10) + 1)) / 10);
    const refundAmount = amount - releaseAmount;
    const at = new Date(atBase + (i + 2) * 1000).toISOString();

    payer = lockAgentWalletEscrow({ wallet: payer, amountCents: amount, at });

    if (releaseAmount > 0) {
      const released = releaseAgentWalletEscrowToPayee({
        payerWallet: payer,
        payeeWallet: payee,
        amountCents: releaseAmount,
        at
      });
      payer = released.payerWallet;
      payee = released.payeeWallet;
      totalReleased += releaseAmount;
    }
    if (refundAmount > 0) {
      payer = refundAgentWalletEscrow({ wallet: payer, amountCents: refundAmount, at });
      totalRefunded += refundAmount;
    }
  }

  assert.equal(payer.escrowLockedCents, 0);
  assert.equal(payee.escrowLockedCents, 0);
  assert.equal(totalReleased + totalRefunded, txCount * 50 + Array.from({ length: txCount }, (_, i) => i % 25).reduce((a, b) => a + b, 0));
  assert.equal(payee.availableCents, totalReleased);
  assert.equal(payer.availableCents + payee.availableCents, 50_000);
  assert.equal(payer.totalDebitedCents, totalReleased);
  assert.equal(payee.totalCreditedCents, totalReleased);
});

test("escrow netting invariant: lock failure does not mutate wallet balances", () => {
  const at = "2026-02-07T00:00:00.000Z";
  const payer = creditAgentWallet({
    wallet: createAgentWallet({ tenantId: "tenant_s0", agentId: "agt_payer_fail", at }),
    amountCents: 100,
    at
  });

  assert.throws(
    () =>
      lockAgentWalletEscrow({
        wallet: payer,
        amountCents: 101,
        at
      }),
    (err) => err?.code === "INSUFFICIENT_WALLET_BALANCE"
  );

  assert.equal(payer.availableCents, 100);
  assert.equal(payer.escrowLockedCents, 0);
});
