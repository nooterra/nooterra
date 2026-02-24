import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { createAjv2020 } from "./helpers/ajv-2020.js";

import { canonicalJsonStringify } from "../src/core/canonical-json.js";
import { sha256Hex } from "../src/core/crypto.js";
import {
  buildAgreementDelegationV1,
  validateAgreementDelegationV1,
  cascadeSettlementCheck,
  refundUnwindCheck,
  cascadeSettlementExecute,
  cascadeUnwindExecute,
  refundUnwindExecute,
  summarizeAgreementDelegationLedgerV1
} from "../src/core/agreement-delegation.js";

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function reverseObjectKeys(value) {
  if (Array.isArray(value)) return value.map((item) => reverseObjectKeys(item));
  if (!isPlainObject(value)) return value;
  const out = {};
  for (const key of Object.keys(value).reverse()) {
    out[key] = reverseObjectKeys(value[key]);
  }
  return out;
}

async function loadSchemas() {
  const base = path.resolve(process.cwd(), "docs/spec/schemas");
  const names = (await fs.readdir(base)).filter((n) => n.endsWith(".json")).sort();
  const schemas = [];
  for (const name of names) {
    const raw = await fs.readFile(path.join(base, name), "utf8");
    schemas.push(JSON.parse(raw));
  }
  return schemas;
}

async function loadExample(name) {
  const file = path.resolve(process.cwd(), "docs/spec/examples", name);
  return JSON.parse(await fs.readFile(file, "utf8"));
}

test("agreement delegation schema validates published example", async () => {
  const ajv = createAjv2020();
  for (const schema of await loadSchemas()) {
    if (schema && typeof schema === "object" && typeof schema.$id === "string") {
      ajv.addSchema(schema, schema.$id);
    }
  }

  const validate = ajv.getSchema("https://settld.local/schemas/AgreementDelegation.v1.schema.json");
  assert.ok(validate);

  const example = await loadExample("agreement_delegation_v1.example.json");
  assert.equal(validate(example), true, JSON.stringify(validate.errors ?? [], null, 2));
});

test("agreement delegation example produces stable canonical hashes independent of key insertion order", async () => {
  const example = await loadExample("agreement_delegation_v1.example.json");
  const h1 = sha256Hex(canonicalJsonStringify(example));
  const h2 = sha256Hex(canonicalJsonStringify(reverseObjectKeys(example)));
  assert.equal(h2, h1);
});

test("buildAgreementDelegationV1 round-trips and validates hash integrity", () => {
  const at = "2026-02-01T00:00:00.000Z";
  const parentAgreementHash = "a".repeat(64);
  const out = buildAgreementDelegationV1({
    delegationId: "dlg_test_0001",
    tenantId: "tenant_test",
    parentAgreementHash,
    childAgreementHash: "b".repeat(64),
    delegatorAgentId: "agt_delegator",
    delegateeAgentId: "agt_delegatee",
    budgetCapCents: 1234,
    currency: "USD",
    delegationDepth: 1,
    maxDelegationDepth: 3,
    ancestorChain: [parentAgreementHash],
    createdAt: at
  });
  assert.equal(validateAgreementDelegationV1(out), true);
  assert.equal(out.status, "active");
  assert.equal(out.createdAt, at);
  assert.equal(out.updatedAt, at);
});

test("cascadeSettlementCheck returns deterministic bottom-up parent order", () => {
  const at = "2026-02-01T00:00:00.000Z";
  const A = "a".repeat(64);
  const B = "b".repeat(64);
  const C = "c".repeat(64);
  const d1 = buildAgreementDelegationV1({
    delegationId: "dlg_ab",
    tenantId: "tenant_test",
    parentAgreementHash: A,
    childAgreementHash: B,
    delegatorAgentId: "agt_1",
    delegateeAgentId: "agt_2",
    budgetCapCents: 100,
    currency: "USD",
    delegationDepth: 1,
    maxDelegationDepth: 3,
    ancestorChain: [A],
    createdAt: at
  });
  const d2 = buildAgreementDelegationV1({
    delegationId: "dlg_bc",
    tenantId: "tenant_test",
    parentAgreementHash: B,
    childAgreementHash: C,
    delegatorAgentId: "agt_2",
    delegateeAgentId: "agt_3",
    budgetCapCents: 100,
    currency: "USD",
    delegationDepth: 2,
    maxDelegationDepth: 3,
    ancestorChain: [A, B],
    createdAt: at
  });

  const plan = cascadeSettlementCheck({ delegations: [d1, d2], fromChildHash: C });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.parentAgreementHashes, [B, A]);
});

test("refundUnwindCheck returns deterministic top-down child order", () => {
  const at = "2026-02-01T00:00:00.000Z";
  const A = "a".repeat(64);
  const B = "b".repeat(64);
  const C = "c".repeat(64);
  const d1 = buildAgreementDelegationV1({
    delegationId: "dlg_ab",
    tenantId: "tenant_test",
    parentAgreementHash: A,
    childAgreementHash: B,
    delegatorAgentId: "agt_1",
    delegateeAgentId: "agt_2",
    budgetCapCents: 100,
    currency: "USD",
    delegationDepth: 1,
    maxDelegationDepth: 3,
    ancestorChain: [A],
    createdAt: at
  });
  const d2 = buildAgreementDelegationV1({
    delegationId: "dlg_bc",
    tenantId: "tenant_test",
    parentAgreementHash: B,
    childAgreementHash: C,
    delegatorAgentId: "agt_2",
    delegateeAgentId: "agt_3",
    budgetCapCents: 100,
    currency: "USD",
    delegationDepth: 2,
    maxDelegationDepth: 3,
    ancestorChain: [A, B],
    createdAt: at
  });

  const plan = refundUnwindCheck({ delegations: [d2, d1], fromParentHash: A });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.childAgreementHashes, [B, C]);
});

test("depth enforcement: delegationDepth > maxDelegationDepth throws", () => {
  assert.throws(() => {
    buildAgreementDelegationV1({
      delegationId: "dlg_bad",
      tenantId: "tenant_test",
      parentAgreementHash: "a".repeat(64),
      childAgreementHash: "b".repeat(64),
      delegatorAgentId: "agt_1",
      delegateeAgentId: "agt_2",
      budgetCapCents: 100,
      currency: "USD",
      delegationDepth: 4,
      maxDelegationDepth: 3,
      createdAt: "2026-02-01T00:00:00.000Z"
    });
  });
});

test("cascadeUnwindExecute: 3-hop child failure unwinds to root idempotently and preserves ledger invariant", () => {
  const at = "2026-02-01T00:00:00.000Z";
  const resolvedAt = "2026-02-01T00:10:00.000Z";
  const A = "a".repeat(64);
  const B = "b".repeat(64);
  const C = "c".repeat(64);
  const d1 = buildAgreementDelegationV1({
    delegationId: "dlg_ab",
    tenantId: "tenant_test",
    parentAgreementHash: A,
    childAgreementHash: B,
    delegatorAgentId: "agt_1",
    delegateeAgentId: "agt_2",
    budgetCapCents: 100,
    currency: "USD",
    delegationDepth: 1,
    maxDelegationDepth: 3,
    ancestorChain: [A],
    createdAt: at
  });
  const d2 = buildAgreementDelegationV1({
    delegationId: "dlg_bc",
    tenantId: "tenant_test",
    parentAgreementHash: B,
    childAgreementHash: C,
    delegatorAgentId: "agt_2",
    delegateeAgentId: "agt_3",
    budgetCapCents: 100,
    currency: "USD",
    delegationDepth: 2,
    maxDelegationDepth: 3,
    ancestorChain: [A, B],
    createdAt: at
  });

  const first = cascadeUnwindExecute({
    delegations: [d1, d2],
    fromChildHash: C,
    resolvedAt,
    metadata: { reason: "child_failed" }
  });
  assert.equal(first.ok, true);
  assert.equal(first.kind, "cascade_unwind_execute_v1");
  assert.deepEqual(
    first.operations.map((row) => [row.delegationId, row.result, row.fromStatus, row.toStatus]),
    [
      ["dlg_bc", "applied", "active", "revoked"],
      ["dlg_ab", "applied", "active", "revoked"]
    ]
  );
  assert.equal(first.stats.applied, 2);
  assert.equal(first.stats.noop, 0);
  assert.equal(first.ledger.invariant.ok, true);
  assert.equal(first.ledger.revokedCount, 2);

  const second = cascadeUnwindExecute({
    delegations: first.delegations,
    fromChildHash: C,
    resolvedAt,
    metadata: { reason: "child_failed" }
  });
  assert.equal(second.ok, true);
  assert.equal(second.stats.attempted, 0);
  assert.equal(second.stats.applied, 0);
  assert.equal(second.stats.noop, 0);
  assert.equal(second.ledger.invariant.ok, true);
  assert.equal(second.ledger.revokedCount, 2);
  assert.equal(second.ledger.totalDelegations, 2);
});

test("cascadeSettlementExecute marks chain settled and retries are no-op", () => {
  const at = "2026-02-01T00:00:00.000Z";
  const resolvedAt = "2026-02-01T00:10:00.000Z";
  const A = "d".repeat(64);
  const B = "e".repeat(64);
  const C = "f".repeat(64);
  const d1 = buildAgreementDelegationV1({
    delegationId: "dlg_de",
    tenantId: "tenant_test",
    parentAgreementHash: A,
    childAgreementHash: B,
    delegatorAgentId: "agt_4",
    delegateeAgentId: "agt_5",
    budgetCapCents: 200,
    currency: "USD",
    delegationDepth: 1,
    maxDelegationDepth: 3,
    ancestorChain: [A],
    createdAt: at
  });
  const d2 = buildAgreementDelegationV1({
    delegationId: "dlg_ef",
    tenantId: "tenant_test",
    parentAgreementHash: B,
    childAgreementHash: C,
    delegatorAgentId: "agt_5",
    delegateeAgentId: "agt_6",
    budgetCapCents: 150,
    currency: "USD",
    delegationDepth: 2,
    maxDelegationDepth: 3,
    ancestorChain: [A, B],
    createdAt: at
  });

  const settled = cascadeSettlementExecute({
    delegations: [d1, d2],
    fromChildHash: C,
    resolvedAt
  });
  assert.equal(settled.stats.applied, 2);
  assert.equal(settled.ledger.settledCount, 2);
  assert.equal(settled.ledger.invariant.ok, true);

  const retry = cascadeSettlementExecute({
    delegations: settled.delegations,
    fromChildHash: C,
    resolvedAt
  });
  assert.equal(retry.stats.applied, 0);
  assert.equal(retry.stats.noop, 2);
  assert.equal(retry.ledger.settledCount, 2);
  assert.equal(retry.ledger.invariant.ok, true);
});

test("refundUnwindExecute applies deterministic top-down revoke order", () => {
  const at = "2026-02-01T00:00:00.000Z";
  const resolvedAt = "2026-02-01T00:15:00.000Z";
  const A = "1".repeat(64);
  const B = "2".repeat(64);
  const C = "3".repeat(64);
  const d1 = buildAgreementDelegationV1({
    delegationId: "dlg_12",
    tenantId: "tenant_test",
    parentAgreementHash: A,
    childAgreementHash: B,
    delegatorAgentId: "agt_1",
    delegateeAgentId: "agt_2",
    budgetCapCents: 100,
    currency: "USD",
    delegationDepth: 1,
    maxDelegationDepth: 3,
    ancestorChain: [A],
    createdAt: at
  });
  const d2 = buildAgreementDelegationV1({
    delegationId: "dlg_23",
    tenantId: "tenant_test",
    parentAgreementHash: B,
    childAgreementHash: C,
    delegatorAgentId: "agt_2",
    delegateeAgentId: "agt_3",
    budgetCapCents: 100,
    currency: "USD",
    delegationDepth: 2,
    maxDelegationDepth: 3,
    ancestorChain: [A, B],
    createdAt: at
  });

  const out = refundUnwindExecute({
    delegations: [d2, d1],
    fromParentHash: A,
    resolvedAt,
    metadata: { cause: "refund" }
  });
  assert.equal(out.ok, true);
  assert.deepEqual(
    out.operations.map((row) => row.delegationId),
    ["dlg_12", "dlg_23"]
  );
  assert.equal(out.stats.applied, 2);
  assert.equal(out.ledger.revokedCount, 2);
  assert.equal(out.ledger.invariant.ok, true);

  const summary = summarizeAgreementDelegationLedgerV1({ delegations: out.delegations });
  assert.equal(summary.revokedCount, 2);
  assert.equal(summary.invariant.ok, true);
});
