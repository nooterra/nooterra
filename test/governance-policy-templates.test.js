import test from "node:test";
import assert from "node:assert/strict";

import {
  GOVERNANCE_POLICY_DECISION_CODE,
  GOVERNANCE_POLICY_TEMPLATE_CATALOG_SCHEMA_VERSION,
  GOVERNANCE_POLICY_TEMPLATE_SCHEMA_VERSION,
  OPERATING_PROFILE,
  buildGovernancePolicyTemplateCatalog,
  evaluateGovernancePolicyTemplate,
  getGovernancePolicyTemplate,
  listGovernancePolicyTemplates
} from "../src/core/governance-policy-templates.js";

test("governance policy templates: catalog publishes deterministic operating-profile templates", () => {
  const catalog = buildGovernancePolicyTemplateCatalog();
  assert.equal(catalog.schemaVersion, GOVERNANCE_POLICY_TEMPLATE_CATALOG_SCHEMA_VERSION);
  assert.equal(Array.isArray(catalog.templates), true);
  assert.equal(catalog.templates.length, 3);
  assert.deepEqual(
    catalog.templates.map((row) => row.operatingProfile),
    [OPERATING_PROFILE.INDIE, OPERATING_PROFILE.SMB, OPERATING_PROFILE.ENTERPRISE]
  );
  for (const row of catalog.templates) {
    assert.equal(row.schemaVersion, GOVERNANCE_POLICY_TEMPLATE_SCHEMA_VERSION);
    assert.match(String(row.templateHash ?? ""), /^[0-9a-f]{64}$/);
  }
});

test("governance policy templates: list returns deep-cloned values", () => {
  const first = listGovernancePolicyTemplates();
  first[0].name = "tampered";
  first[0].controls.spend.perActionUsdCents = 1;

  const second = listGovernancePolicyTemplates();
  assert.notEqual(second[0].name, "tampered");
  assert.notEqual(second[0].controls.spend.perActionUsdCents, 1);
});

test("governance policy templates: evaluation is deterministic for identical input", () => {
  const template = getGovernancePolicyTemplate({ operatingProfile: OPERATING_PROFILE.SMB });
  assert.ok(template);

  const request = {
    amountUsdCents: 80_000,
    monthlySpendUsdCents: 200_000,
    dataClass: "internal",
    riskLevel: "high",
    approvalsProvided: 1,
    externalTransfer: false
  };
  const first = evaluateGovernancePolicyTemplate({ template, request });
  const second = evaluateGovernancePolicyTemplate({ template, request });

  assert.deepEqual(second, first);
  assert.equal(first.decision, "allow");
  assert.equal(first.requiredApprovers, 1);
});

test("governance policy templates: enterprise external transfer and restricted data fail closed", () => {
  const template = getGovernancePolicyTemplate({ operatingProfile: OPERATING_PROFILE.ENTERPRISE });
  assert.ok(template);

  const out = evaluateGovernancePolicyTemplate({
    template,
    request: {
      amountUsdCents: 30_000,
      monthlySpendUsdCents: 50_000,
      dataClass: "restricted",
      riskLevel: "medium",
      approvalsProvided: 2,
      externalTransfer: true
    }
  });
  assert.equal(out.decision, "deny");
  assert.equal(
    out.blockingIssues.some((row) => row.code === GOVERNANCE_POLICY_DECISION_CODE.DATA_CLASS_FORBIDDEN),
    true
  );
  assert.equal(
    out.blockingIssues.some((row) => row.code === GOVERNANCE_POLICY_DECISION_CODE.EXTERNAL_TRANSFER_FORBIDDEN),
    true
  );
});

test("governance policy templates: unsafe tier-gap template fails closed", () => {
  const template = getGovernancePolicyTemplate({ operatingProfile: OPERATING_PROFILE.INDIE });
  assert.ok(template);

  // Force an unsafe gap where spend allows a higher amount than approval tiers cover.
  template.controls.approvals.tiers = [{ tierId: "auto", maxAmountUsdCents: 10_000, requiredApprovers: 0, approverRole: "none" }];
  template.templateHash = null;

  const out = evaluateGovernancePolicyTemplate({
    template,
    request: {
      amountUsdCents: 20_000,
      monthlySpendUsdCents: 0,
      dataClass: "internal",
      riskLevel: "low",
      approvalsProvided: 0,
      externalTransfer: false
    }
  });
  assert.equal(out.decision, "deny");
  assert.equal(out.blockingIssues[0]?.code, GOVERNANCE_POLICY_DECISION_CODE.TEMPLATE_INVALID);
});
