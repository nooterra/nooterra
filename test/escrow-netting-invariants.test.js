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
