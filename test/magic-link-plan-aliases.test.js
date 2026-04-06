import test from "node:test";
import assert from "node:assert/strict";

import { normalizeTenantPlan, resolveTenantEntitlements } from "../services/magic-link/src/tenant-settings.js";

test("magic-link tenant settings accepts world-model plan aliases", () => {
  assert.equal(normalizeTenantPlan("sandbox"), "free");
  assert.equal(normalizeTenantPlan("starter"), "builder");
  assert.equal(normalizeTenantPlan("pro"), "growth");
  assert.equal(normalizeTenantPlan("scale"), "enterprise");
  assert.equal(normalizeTenantPlan("finance_ops"), "enterprise");
});

test("magic-link entitlement resolution preserves legacy billing math behind aliases", () => {
  const starter = resolveTenantEntitlements({ settings: { plan: "starter" } });
  assert.equal(starter.plan, "builder");
  assert.equal(starter.billing.subscriptionCents, 9900);

  const sandbox = resolveTenantEntitlements({ settings: { plan: "sandbox" } });
  assert.equal(sandbox.plan, "free");
  assert.equal(sandbox.billing.subscriptionCents, 0);
});
