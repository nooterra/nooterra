import test from "node:test";
import assert from "node:assert/strict";

import {
  SLA_POLICY_TEMPLATE_CATALOG_VERSION,
  getSlaPolicyTemplate,
  listSlaPolicyTemplates,
  renderSlaPolicyTemplate
} from "../src/core/sla-policy-templates.js";

test("SLA templates: list exposes built-in catalog", () => {
  const templates = listSlaPolicyTemplates();
  assert.equal(Array.isArray(templates), true);
  assert.equal(templates.length, 7);
  assert.deepEqual(
    templates.map((item) => item.templateId),
    [
      "delivery_standard_v1",
      "delivery_priority_v1",
      "delivery_bulk_route_v1",
      "delivery_cold_chain_v1",
      "security_patrol_strict_v1",
      "security_patrol_compliance_v1",
      "security_perimeter_watch_v1"
    ]
  );
  assert.equal(SLA_POLICY_TEMPLATE_CATALOG_VERSION, "SlaPolicyTemplateCatalog.v1");
  assert.equal(templates.every((item) => item?.overridesSchema?.schemaVersion === "SlaPolicyTemplateOverrides.v1"), true);
});

test("SLA templates: list supports vertical filtering", () => {
  const delivery = listSlaPolicyTemplates({ vertical: "delivery" });
  assert.deepEqual(
    delivery.map((item) => item.templateId),
    ["delivery_standard_v1", "delivery_priority_v1", "delivery_bulk_route_v1", "delivery_cold_chain_v1"]
  );
  const security = listSlaPolicyTemplates({ vertical: "security" });
  assert.deepEqual(
    security.map((item) => item.templateId),
    ["security_patrol_strict_v1", "security_patrol_compliance_v1", "security_perimeter_watch_v1"]
  );
});

test("SLA templates: invalid vertical is rejected", () => {
  assert.throws(() => listSlaPolicyTemplates({ vertical: "healthcare" }), /vertical must be delivery or security/);
});

test("SLA templates: get and render handle missing template id", () => {
  assert.equal(getSlaPolicyTemplate({ templateId: "does_not_exist" }), null);
  assert.equal(renderSlaPolicyTemplate({ templateId: "does_not_exist" }), null);
});

test("SLA templates: render applies overrides without mutating source template", () => {
  const source = getSlaPolicyTemplate({ templateId: "delivery_standard_v1" });
  const rendered = renderSlaPolicyTemplate({
    templateId: "delivery_standard_v1",
    overrides: {
      requiresOperatorCoverage: true,
      sla: { maxExecutionMs: 1_200_000 },
      metrics: { targetCompletionMinutes: 45 }
    }
  });

  assert.equal(rendered.defaults.requiresOperatorCoverage, true);
  assert.equal(rendered.defaults.sla.maxExecutionMs, 1_200_000);
  assert.equal(rendered.defaults.metrics.targetCompletionMinutes, 45);

  const sourceAfter = getSlaPolicyTemplate({ templateId: "delivery_standard_v1" });
  assert.deepEqual(sourceAfter, source);
});

test("SLA templates: render rejects invalid override payloads", () => {
  assert.throws(
    () => renderSlaPolicyTemplate({ templateId: "delivery_standard_v1", overrides: { metrics: { targetCompletionMinutes: 0 } } }),
    /targetCompletionMinutes/
  );
  assert.throws(
    () => renderSlaPolicyTemplate({ templateId: "delivery_standard_v1", overrides: { sla: { maxExecutionMs: -1 } } }),
    /maxExecutionMs/
  );
  assert.throws(
    () => renderSlaPolicyTemplate({ templateId: "delivery_standard_v1", overrides: [] }),
    /overrides must be an object/
  );
});
