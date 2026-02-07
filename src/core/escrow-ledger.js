import { canonicalJsonStringify, normalizeForCanonicalJson } from "./canonical-json.js";
import { addAccount, applyJournalEntry, createAccount, createJournalEntry, createLedger } from "./ledger.js";

export const ESCROW_OPERATION_TYPE = Object.freeze({
  HOLD: "hold",
  RELEASE: "release",
  FORFEIT: "forfeit"
});

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new TypeError(`${name} must be a plain object`);
  }
}

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
}

function normalizeIsoDate(value, name) {
  assertNonEmptyString(value, name);
  if (!Number.isFinite(Date.parse(value))) throw new TypeError(`${name} must be an ISO date-time`);
  return value;
}

function normalizeAmountCents(value, { name = "amountCents", allowZero = false } = {}) {
  const amountCents = Number(value);
  if (!Number.isSafeInteger(amountCents)) throw new TypeError(`${name} must be a safe integer`);
  if (allowZero ? amountCents < 0 : amountCents <= 0) throw new TypeError(`${name} must be ${allowZero ? ">= 0" : "> 0"}`);
  return amountCents;
}

function normalizeOperationType(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!Object.values(ESCROW_OPERATION_TYPE).includes(normalized)) {
    throw new TypeError(`type must be one of: ${Object.values(ESCROW_OPERATION_TYPE).join("|")}`);
  }
  return normalized;
}

function normalizeCurrency(value) {
  assertNonEmptyString(value, "currency");
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{2,11}$/.test(normalized)) throw new TypeError("currency must match ^[A-Z][A-Z0-9_]{2,11}$");
  return normalized;
}

function clone(value) {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

function conflictError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

export function walletAvailableAccountId({ tenantId, walletId }) {
  assertNonEmptyString(tenantId, "tenantId");
  assertNonEmptyString(walletId, "walletId");
  return `wallet:${tenantId}:${walletId}:available`;
}

export function walletEscrowAccountId({ tenantId, walletId }) {
  assertNonEmptyString(tenantId, "tenantId");
  assertNonEmptyString(walletId, "walletId");
  return `wallet:${tenantId}:${walletId}:escrow_locked`;
}

function ensureWalletAccounts({ state, tenantId, walletId }) {
  const availableAccountId = walletAvailableAccountId({ tenantId, walletId });
  const escrowAccountId = walletEscrowAccountId({ tenantId, walletId });
  if (!state.ledger.accounts.has(availableAccountId)) {
    addAccount(
      state.ledger,
      createAccount({
        id: availableAccountId,
        name: `Wallet ${walletId} Available`,
        currency: state.currency,
        type: "asset"
      })
    );
  }
  if (!state.ledger.accounts.has(escrowAccountId)) {
    addAccount(
      state.ledger,
      createAccount({
        id: escrowAccountId,
        name: `Wallet ${walletId} Escrow Locked`,
        currency: state.currency,
        type: "liability"
      })
    );
  }
}

function getBalance(ledger, accountId) {
  return Number(ledger.balances.get(accountId) ?? 0);
}

function normalizeOperationInput(input, { now, currency }) {
  assertPlainObject(input, "input");
  const operationId = String(input.operationId ?? "").trim();
  const tenantId = String(input.tenantId ?? "").trim();
  const payerWalletId = String(input.payerWalletId ?? "").trim();
  const payeeWalletIdRaw = input.payeeWalletId === null || input.payeeWalletId === undefined ? null : String(input.payeeWalletId).trim();
  const type = normalizeOperationType(input.type);
  const amountCents = normalizeAmountCents(input.amountCents);
  const at = normalizeIsoDate(input.at ?? now(), "at");

  if (!operationId) throw new TypeError("operationId is required");
  if (!tenantId) throw new TypeError("tenantId is required");
  if (!payerWalletId) throw new TypeError("payerWalletId is required");
  if (type === ESCROW_OPERATION_TYPE.RELEASE && !payeeWalletIdRaw) {
    throw new TypeError("payeeWalletId is required for release operations");
  }
  if ((type === ESCROW_OPERATION_TYPE.HOLD || type === ESCROW_OPERATION_TYPE.FORFEIT) && payeeWalletIdRaw) {
    throw new TypeError("payeeWalletId is only valid for release operations");
  }

  const memoRaw = input.memo === null || input.memo === undefined ? null : String(input.memo).trim();
  const memo = memoRaw === "" ? null : memoRaw;

  return {
    operationId,
    tenantId,
    payerWalletId,
    payeeWalletId: payeeWalletIdRaw || null,
    type,
    amountCents,
    at,
    memo,
    currency
  };
}

function operationRequestHash(normalizedInput) {
  const normalized = normalizeForCanonicalJson(
    {
      operationId: normalizedInput.operationId,
      tenantId: normalizedInput.tenantId,
      payerWalletId: normalizedInput.payerWalletId,
      payeeWalletId: normalizedInput.payeeWalletId,
      type: normalizedInput.type,
      amountCents: normalizedInput.amountCents,
      currency: normalizedInput.currency
    },
    { path: "$" }
  );
  return canonicalJsonStringify(normalized);
}

function buildPostingsForOperation({ input }) {
  const payerAvailable = walletAvailableAccountId({ tenantId: input.tenantId, walletId: input.payerWalletId });
  const payerEscrow = walletEscrowAccountId({ tenantId: input.tenantId, walletId: input.payerWalletId });
  if (input.type === ESCROW_OPERATION_TYPE.HOLD) {
    return {
      fromAccountId: payerAvailable,
      toAccountId: payerEscrow,
      postings: [
        { accountId: payerAvailable, amountCents: -input.amountCents },
        { accountId: payerEscrow, amountCents: input.amountCents }
      ]
    };
  }
  if (input.type === ESCROW_OPERATION_TYPE.RELEASE) {
    const payeeAvailable = walletAvailableAccountId({ tenantId: input.tenantId, walletId: input.payeeWalletId });
    return {
      fromAccountId: payerEscrow,
      toAccountId: payeeAvailable,
      postings: [
        { accountId: payerEscrow, amountCents: -input.amountCents },
        { accountId: payeeAvailable, amountCents: input.amountCents }
      ]
    };
  }
  if (input.type === ESCROW_OPERATION_TYPE.FORFEIT) {
    return {
      fromAccountId: payerEscrow,
      toAccountId: payerAvailable,
      postings: [
        { accountId: payerEscrow, amountCents: -input.amountCents },
        { accountId: payerAvailable, amountCents: input.amountCents }
      ]
    };
  }
  throw new TypeError(`unsupported escrow operation type: ${String(input.type ?? "")}`);
}

function ensureSufficientBalance({ state, input, fromAccountId }) {
  const currentBalance = getBalance(state.ledger, fromAccountId);
  if (currentBalance < input.amountCents) {
    if (input.type === ESCROW_OPERATION_TYPE.HOLD) {
      throw conflictError("INSUFFICIENT_WALLET_AVAILABLE", "insufficient available wallet balance for hold");
    }
    throw conflictError("INSUFFICIENT_ESCROW_LOCKED", "insufficient escrow balance for release/forfeit");
  }
}

export function createEscrowLedger({
  now = () => new Date().toISOString(),
  currency = "USD",
  initialWalletBalances = []
} = {}) {
  if (typeof now !== "function") throw new TypeError("now must be a function");
  if (!Array.isArray(initialWalletBalances)) throw new TypeError("initialWalletBalances must be an array");

  const normalizedCurrency = normalizeCurrency(currency);
  const ledger = createLedger();
  const state = {
    schemaVersion: "EscrowLedger.v1",
    currency: normalizedCurrency,
    ledger,
    operations: new Map(),
    now
  };

  for (const row of initialWalletBalances) {
    assertPlainObject(row, "initialWalletBalances[]");
    const tenantId = String(row.tenantId ?? "").trim();
    const walletId = String(row.walletId ?? "").trim();
    if (!tenantId) throw new TypeError("initialWalletBalances[].tenantId is required");
    if (!walletId) throw new TypeError("initialWalletBalances[].walletId is required");
    const availableCents = normalizeAmountCents(row.availableCents ?? 0, { name: "initialWalletBalances[].availableCents", allowZero: true });
    const escrowLockedCents = normalizeAmountCents(row.escrowLockedCents ?? 0, { name: "initialWalletBalances[].escrowLockedCents", allowZero: true });
    ensureWalletAccounts({ state, tenantId, walletId });
    state.ledger.balances.set(walletAvailableAccountId({ tenantId, walletId }), availableCents);
    state.ledger.balances.set(walletEscrowAccountId({ tenantId, walletId }), escrowLockedCents);
  }

  return state;
}

export function getEscrowLedgerBalance({ state, accountId }) {
  assertPlainObject(state, "state");
  assertNonEmptyString(accountId, "accountId");
  return getBalance(state.ledger, accountId);
}

export function upsertEscrowLedgerWalletBalances({
  state,
  tenantId,
  walletId,
  availableCents,
  escrowLockedCents
}) {
  assertPlainObject(state, "state");
  assertNonEmptyString(tenantId, "tenantId");
  assertNonEmptyString(walletId, "walletId");
  const nextAvailable = normalizeAmountCents(availableCents, { name: "availableCents", allowZero: true });
  const nextEscrow = normalizeAmountCents(escrowLockedCents, { name: "escrowLockedCents", allowZero: true });
  ensureWalletAccounts({ state, tenantId: tenantId.trim(), walletId: walletId.trim() });
  state.ledger.balances.set(walletAvailableAccountId({ tenantId: tenantId.trim(), walletId: walletId.trim() }), nextAvailable);
  state.ledger.balances.set(walletEscrowAccountId({ tenantId: tenantId.trim(), walletId: walletId.trim() }), nextEscrow);
  return {
    availableCents: nextAvailable,
    escrowLockedCents: nextEscrow
  };
}

export function applyEscrowOperation({ state, input }) {
  assertPlainObject(state, "state");
  if (!state.ledger || !state.operations) throw new TypeError("state is not an escrow ledger state");

  const normalizedInput = normalizeOperationInput(input, { now: state.now, currency: state.currency });
  const requestHash = operationRequestHash(normalizedInput);
  const existing = state.operations.get(normalizedInput.operationId) ?? null;
  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw conflictError("ESCROW_OPERATION_CONFLICT", "operationId was already used with a different request");
    }
    return { state, operation: clone(existing.operation), applied: false };
  }

  ensureWalletAccounts({ state, tenantId: normalizedInput.tenantId, walletId: normalizedInput.payerWalletId });
  if (normalizedInput.payeeWalletId) {
    ensureWalletAccounts({ state, tenantId: normalizedInput.tenantId, walletId: normalizedInput.payeeWalletId });
  }

  const postingPlan = buildPostingsForOperation({ input: normalizedInput });
  ensureSufficientBalance({ state, input: normalizedInput, fromAccountId: postingPlan.fromAccountId });

  const entryId = `escrow_${normalizedInput.operationId}`;
  const entry = createJournalEntry({
    id: entryId,
    at: normalizedInput.at,
    memo: normalizedInput.memo ?? `escrow:${normalizedInput.type}:${normalizedInput.operationId}`,
    postings: postingPlan.postings
  });
  const inserted = applyJournalEntry(state.ledger, entry);
  if (!inserted) throw conflictError("ESCROW_ENTRY_DUPLICATE", "ledger entry id already exists");

  const operation = {
    schemaVersion: "EscrowOperation.v1",
    operationId: normalizedInput.operationId,
    tenantId: normalizedInput.tenantId,
    type: normalizedInput.type,
    amountCents: normalizedInput.amountCents,
    currency: state.currency,
    payerWalletId: normalizedInput.payerWalletId,
    payeeWalletId: normalizedInput.payeeWalletId,
    entryId,
    fromAccountId: postingPlan.fromAccountId,
    toAccountId: postingPlan.toAccountId,
    at: normalizedInput.at,
    balancesAfter: {
      [postingPlan.fromAccountId]: getBalance(state.ledger, postingPlan.fromAccountId),
      [postingPlan.toAccountId]: getBalance(state.ledger, postingPlan.toAccountId)
    }
  };

  state.operations.set(normalizedInput.operationId, { requestHash, operation });
  return { state, operation: clone(operation), applied: true };
}
