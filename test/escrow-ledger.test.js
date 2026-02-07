import test from "node:test";
import assert from "node:assert/strict";

import {
  ESCROW_OPERATION_TYPE,
  applyEscrowOperation,
  createEscrowLedger,
  getEscrowLedgerBalance,
  upsertEscrowLedgerWalletBalances,
  walletAvailableAccountId,
  walletEscrowAccountId
} from "../src/core/escrow-ledger.js";

function entrySum(entry) {
  return entry.postings.reduce((sum, posting) => sum + posting.amountCents, 0);
}

test("escrow ledger primitives: hold/release/forfeit preserve double-entry balances", () => {
  const state = createEscrowLedger({
    currency: "USD",
    initialWalletBalances: [
      { tenantId: "tenant_s0", walletId: "payer_1", availableCents: 2_000, escrowLockedCents: 0 },
      { tenantId: "tenant_s0", walletId: "payee_1", availableCents: 100, escrowLockedCents: 0 }
    ]
  });

  const hold = applyEscrowOperation({
    state,
    input: {
      operationId: "esc_op_hold_1",
      tenantId: "tenant_s0",
      type: ESCROW_OPERATION_TYPE.HOLD,
      payerWalletId: "payer_1",
      amountCents: 1_000,
      at: "2026-02-07T00:00:00.000Z"
    }
  });
  assert.equal(hold.applied, true);

  const release = applyEscrowOperation({
    state,
    input: {
      operationId: "esc_op_release_1",
      tenantId: "tenant_s0",
      type: ESCROW_OPERATION_TYPE.RELEASE,
      payerWalletId: "payer_1",
      payeeWalletId: "payee_1",
      amountCents: 700,
      at: "2026-02-07T00:01:00.000Z"
    }
  });
  assert.equal(release.applied, true);

  const forfeit = applyEscrowOperation({
    state,
    input: {
      operationId: "esc_op_forfeit_1",
      tenantId: "tenant_s0",
      type: ESCROW_OPERATION_TYPE.FORFEIT,
      payerWalletId: "payer_1",
      amountCents: 300,
      at: "2026-02-07T00:02:00.000Z"
    }
  });
  assert.equal(forfeit.applied, true);

  const payerAvailable = getEscrowLedgerBalance({
    state,
    accountId: walletAvailableAccountId({ tenantId: "tenant_s0", walletId: "payer_1" })
  });
  const payerEscrow = getEscrowLedgerBalance({
    state,
    accountId: walletEscrowAccountId({ tenantId: "tenant_s0", walletId: "payer_1" })
  });
  const payeeAvailable = getEscrowLedgerBalance({
    state,
    accountId: walletAvailableAccountId({ tenantId: "tenant_s0", walletId: "payee_1" })
  });

  assert.equal(payerAvailable, 1_300);
  assert.equal(payerEscrow, 0);
  assert.equal(payeeAvailable, 800);

  assert.equal(state.ledger.entries.length, 3);
  for (const entry of state.ledger.entries) {
    assert.equal(entry.postings.length, 2);
    assert.equal(entrySum(entry), 0);
  }
});

test("escrow ledger primitives: duplicate operation id is idempotent and conflict-safe", () => {
  const state = createEscrowLedger({
    initialWalletBalances: [{ tenantId: "tenant_s0", walletId: "payer_2", availableCents: 500 }]
  });

  const first = applyEscrowOperation({
    state,
    input: {
      operationId: "esc_op_idem_1",
      tenantId: "tenant_s0",
      type: ESCROW_OPERATION_TYPE.HOLD,
      payerWalletId: "payer_2",
      amountCents: 200,
      at: "2026-02-07T00:00:00.000Z"
    }
  });
  assert.equal(first.applied, true);
  assert.equal(state.ledger.entries.length, 1);

  const replay = applyEscrowOperation({
    state,
    input: {
      operationId: "esc_op_idem_1",
      tenantId: "tenant_s0",
      type: ESCROW_OPERATION_TYPE.HOLD,
      payerWalletId: "payer_2",
      amountCents: 200,
      at: "2026-02-07T00:05:00.000Z"
    }
  });
  assert.equal(replay.applied, false);
  assert.equal(state.ledger.entries.length, 1);
  assert.deepEqual(replay.operation, first.operation);

  assert.throws(
    () =>
      applyEscrowOperation({
        state,
        input: {
          operationId: "esc_op_idem_1",
          tenantId: "tenant_s0",
          type: ESCROW_OPERATION_TYPE.HOLD,
          payerWalletId: "payer_2",
          amountCents: 201,
          at: "2026-02-07T00:06:00.000Z"
        }
      }),
    (err) => err?.code === "ESCROW_OPERATION_CONFLICT"
  );
});

test("escrow ledger primitives: wallet balance projection can be synchronized from snapshots", () => {
  const state = createEscrowLedger({ currency: "USD" });

  const synced = upsertEscrowLedgerWalletBalances({
    state,
    tenantId: "tenant_s0",
    walletId: "wallet_sync_1",
    availableCents: 4321,
    escrowLockedCents: 123
  });
  assert.equal(synced.availableCents, 4321);
  assert.equal(synced.escrowLockedCents, 123);

  assert.equal(
    getEscrowLedgerBalance({
      state,
      accountId: walletAvailableAccountId({ tenantId: "tenant_s0", walletId: "wallet_sync_1" })
    }),
    4321
  );
  assert.equal(
    getEscrowLedgerBalance({
      state,
      accountId: walletEscrowAccountId({ tenantId: "tenant_s0", walletId: "wallet_sync_1" })
    }),
    123
  );
});
