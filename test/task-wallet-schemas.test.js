import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { createAjv2020 } from "./helpers/ajv-2020.js";
import { canonicalJsonStringify } from "../src/core/canonical-json.js";
import { sha256Hex } from "../src/core/crypto.js";
import {
  TASK_WALLET_REVIEW_MODE,
  TASK_WALLET_SCHEMA_VERSION,
  buildTaskWalletV1,
  validateTaskWalletV1
} from "../src/core/task-wallet.js";
import { buildTaskWalletSpendPlanV1 } from "../src/core/task-wallet-spend-plan.js";

function isPlainObject(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}

function reverseObjectKeys(value) {
  if (Array.isArray(value)) return value.map((item) => reverseObjectKeys(item));
  if (!isPlainObject(value)) return value;
  const out = {};
  for (const key of Object.keys(value).reverse()) out[key] = reverseObjectKeys(value[key]);
  return out;
}

async function loadSchemas() {
  const base = path.resolve(process.cwd(), "docs/spec/schemas");
  const names = (await fs.readdir(base)).filter((name) => name.endsWith(".json")).sort();
  const schemas = [];
  for (const name of names) schemas.push(JSON.parse(await fs.readFile(path.join(base, name), "utf8")));
  return schemas;
}

function buildFixtureTaskWallet() {
  return buildTaskWalletV1({
    walletId: "twal_launch_1_task_1",
    tenantId: "tenant_default",
    launchId: "rlaunch_demo_1",
    taskId: "t_purchase",
    rfqId: "rfq_purchase_1",
    ownerAgentId: "agt_requester",
    categoryId: "purchases_under_cap",
    currency: "usd",
    maxSpendCents: 8000,
    evidenceRequirements: ["receipt", "merchant_confirmation", "price_breakdown"],
    approvalMode: null,
    expiresAt: "2026-03-08T12:00:00.000Z",
    createdAt: "2026-03-07T20:00:00.000Z"
  });
}

test("task wallet schema validates constructed fixture", async () => {
  const ajv = createAjv2020();
  for (const schema of await loadSchemas()) {
    if (schema && typeof schema === "object" && typeof schema.$id === "string") ajv.addSchema(schema, schema.$id);
  }
  const validate = ajv.getSchema("https://nooterra.local/schemas/TaskWallet.v1.schema.json");
  assert.ok(validate);

  const wallet = buildFixtureTaskWallet();
  assert.equal(wallet.schemaVersion, TASK_WALLET_SCHEMA_VERSION);
  assert.equal(validate(wallet), true, JSON.stringify(validate.errors ?? [], null, 2));
  assert.equal(validateTaskWalletV1(wallet), true);
});

test("task wallet canonical hash is deterministic independent of key insertion order", () => {
  const wallet = buildFixtureTaskWallet();
  const first = sha256Hex(canonicalJsonStringify(wallet));
  const second = sha256Hex(canonicalJsonStringify(reverseObjectKeys(wallet)));
  assert.equal(first, second);
});

test("task wallet derives bounded managed-bazaar review mode and specialist scope", () => {
  const wallet = buildFixtureTaskWallet();
  assert.equal(wallet.reviewMode, TASK_WALLET_REVIEW_MODE.OPERATOR_SUPERVISED);
  assert.deepEqual(wallet.allowedMerchantScopes, ["consumer_commerce"]);
  assert.deepEqual(wallet.allowedSpecialistProfileIds, ["comparison_concierge", "purchase_runner"]);
  assert.equal(wallet.delegationPolicy.allowOpenMarketplace, false);
  assert.equal(wallet.settlementPolicy.settlementModel, "platform_managed");
});

test("task wallet spend plan derives the launch payment rails deterministically", () => {
  const wallet = buildFixtureTaskWallet();
  const spendPlan = buildTaskWalletSpendPlanV1(wallet);
  assert.equal(spendPlan.schemaVersion, "TaskWalletSpendPlan.v1");
  assert.equal(spendPlan.walletId, wallet.walletId);
  assert.equal(spendPlan.consumerSpendRail, "stripe_issuing_task_wallet");
  assert.equal(spendPlan.platformSettlementRail, "stripe_connect_marketplace_split");
  assert.equal(spendPlan.machineSpendRail, "x402_optional_later");
  assert.equal(spendPlan.authorizationPattern, "operator_supervised_checkout");
  assert.equal(spendPlan.finalizationRule, "evidence_required_before_finalize");
  assert.equal(spendPlan.refundMode, "platform_refund_and_dispute");
});
