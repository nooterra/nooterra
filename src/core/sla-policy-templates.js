import { ENV_TIER } from "./booking.js";
import { computeSlaPolicy } from "./sla.js";

export const SLA_POLICY_TEMPLATE_CATALOG_VERSION = "SlaPolicyTemplateCatalog.v1";

export const SLA_POLICY_TEMPLATE_VERTICAL = Object.freeze({
  DELIVERY: "delivery",
  SECURITY: "security"
});

const OVERRIDES_SCHEMA_VERSION = "SlaPolicyTemplateOverrides.v1";

const ENVIRONMENT_TIER_OPTIONS = Object.freeze([
  ENV_TIER.ENV_HOSPITALITY,
  ENV_TIER.ENV_OFFICE_AFTER_HOURS,
  ENV_TIER.ENV_MANAGED_BUILDING,
  ENV_TIER.ENV_IN_HOME
]);

function makeOverridesSchema({ includeMinCheckpoints = false } = {}) {
  const fields = [
    {
      key: "environmentTier",
      path: "environmentTier",
      inputType: "select",
      valueType: "string",
      required: true,
      label: "Environment Tier",
      options: ENVIRONMENT_TIER_OPTIONS
    },
    {
      key: "requiresOperatorCoverage",
      path: "requiresOperatorCoverage",
      inputType: "boolean",
      valueType: "boolean",
      required: false,
      label: "Require Operator Coverage"
    },
    {
      key: "sla.maxExecutionMs",
      path: "sla.maxExecutionMs",
      inputType: "number",
      valueType: "integer",
      required: false,
      min: 60_000,
      max: 43_200_000,
      label: "Max Execution (ms)"
    },
    {
      key: "sla.maxStallMs",
      path: "sla.maxStallMs",
      inputType: "number",
      valueType: "integer",
      required: false,
      min: 1_000,
      max: 3_600_000,
      label: "Max Stall (ms)"
    },
    {
      key: "sla.mustStartWithinWindow",
      path: "sla.mustStartWithinWindow",
      inputType: "boolean",
      valueType: "boolean",
      required: false,
      label: "Must Start Within Window"
    },
    {
      key: "metrics.targetCompletionMinutes",
      path: "metrics.targetCompletionMinutes",
      inputType: "number",
      valueType: "integer",
      required: false,
      min: 1,
      max: 1_440,
      label: "Target Completion (minutes)"
    },
    {
      key: "metrics.maxCheckpointGapMinutes",
      path: "metrics.maxCheckpointGapMinutes",
      inputType: "number",
      valueType: "integer",
      required: false,
      min: 1,
      max: 240,
      label: "Max Checkpoint Gap (minutes)"
    }
  ];
  if (includeMinCheckpoints) {
    fields.push({
      key: "metrics.minCheckpointsRequired",
      path: "metrics.minCheckpointsRequired",
      inputType: "number",
      valueType: "integer",
      required: false,
      min: 1,
      max: 1_000,
      label: "Minimum Checkpoints Required"
    });
  }
  return Object.freeze({
    schemaVersion: OVERRIDES_SCHEMA_VERSION,
    required: Object.freeze(["environmentTier"]),
    fields: Object.freeze(fields.map((item) => Object.freeze(item)))
  });
}

const BUILTIN_TEMPLATES = Object.freeze([
  Object.freeze({
    templateId: "delivery_standard_v1",
    vertical: SLA_POLICY_TEMPLATE_VERTICAL.DELIVERY,
    name: "Delivery Standard",
    description: "General delivery SLA with balanced timing bounds for hospitality/office workloads.",
    overridesSchema: makeOverridesSchema({ includeMinCheckpoints: false }),
    defaults: Object.freeze({
      environmentTier: ENV_TIER.ENV_HOSPITALITY,
      requiresOperatorCoverage: false,
      sla: Object.freeze({
        ...computeSlaPolicy({ environmentTier: ENV_TIER.ENV_HOSPITALITY })
      }),
      metrics: Object.freeze({
        targetCompletionMinutes: 90,
        maxCheckpointGapMinutes: 15
      })
    })
  }),
  Object.freeze({
    templateId: "delivery_priority_v1",
    vertical: SLA_POLICY_TEMPLATE_VERTICAL.DELIVERY,
    name: "Delivery Priority",
    description: "Higher urgency delivery SLA with tighter completion and checkpoint targets.",
    overridesSchema: makeOverridesSchema({ includeMinCheckpoints: false }),
    defaults: Object.freeze({
      environmentTier: ENV_TIER.ENV_HOSPITALITY,
      requiresOperatorCoverage: true,
      sla: Object.freeze({
        ...computeSlaPolicy({ environmentTier: ENV_TIER.ENV_HOSPITALITY }),
        maxExecutionMs: 60 * 60_000
      }),
      metrics: Object.freeze({
        targetCompletionMinutes: 60,
        maxCheckpointGapMinutes: 10
      })
    })
  }),
  Object.freeze({
    templateId: "delivery_bulk_route_v1",
    vertical: SLA_POLICY_TEMPLATE_VERTICAL.DELIVERY,
    name: "Delivery Bulk Route",
    description: "Route-oriented SLA for batched logistics drops where consistency and checkpoint coverage matter.",
    overridesSchema: makeOverridesSchema({ includeMinCheckpoints: false }),
    defaults: Object.freeze({
      environmentTier: ENV_TIER.ENV_MANAGED_BUILDING,
      requiresOperatorCoverage: false,
      sla: Object.freeze({
        ...computeSlaPolicy({ environmentTier: ENV_TIER.ENV_MANAGED_BUILDING }),
        maxExecutionMs: 150 * 60_000
      }),
      metrics: Object.freeze({
        targetCompletionMinutes: 120,
        maxCheckpointGapMinutes: 12
      })
    })
  }),
  Object.freeze({
    templateId: "delivery_cold_chain_v1",
    vertical: SLA_POLICY_TEMPLATE_VERTICAL.DELIVERY,
    name: "Delivery Cold Chain",
    description: "Cold-chain SLA with tighter stall constraints for pharmaceutical and food handling windows.",
    overridesSchema: makeOverridesSchema({ includeMinCheckpoints: false }),
    defaults: Object.freeze({
      environmentTier: ENV_TIER.ENV_HOSPITALITY,
      requiresOperatorCoverage: true,
      sla: Object.freeze({
        ...computeSlaPolicy({ environmentTier: ENV_TIER.ENV_HOSPITALITY }),
        maxStallMs: 3 * 60_000,
        maxExecutionMs: 75 * 60_000
      }),
      metrics: Object.freeze({
        targetCompletionMinutes: 55,
        maxCheckpointGapMinutes: 6
      })
    })
  }),
  Object.freeze({
    templateId: "security_patrol_strict_v1",
    vertical: SLA_POLICY_TEMPLATE_VERTICAL.SECURITY,
    name: "Security Patrol Strict",
    description: "Patrol-focused SLA with strict checkpoint cadence and mandatory operator coverage.",
    overridesSchema: makeOverridesSchema({ includeMinCheckpoints: true }),
    defaults: Object.freeze({
      environmentTier: ENV_TIER.ENV_OFFICE_AFTER_HOURS,
      requiresOperatorCoverage: true,
      sla: Object.freeze({
        ...computeSlaPolicy({ environmentTier: ENV_TIER.ENV_OFFICE_AFTER_HOURS }),
        maxExecutionMs: 180 * 60_000
      }),
      metrics: Object.freeze({
        targetCompletionMinutes: 120,
        maxCheckpointGapMinutes: 5,
        minCheckpointsRequired: 10
      })
    })
  }),
  Object.freeze({
    templateId: "security_patrol_compliance_v1",
    vertical: SLA_POLICY_TEMPLATE_VERTICAL.SECURITY,
    name: "Security Patrol Compliance",
    description: "Compliance-heavy patrol profile optimized for regulated facilities and evidence retention.",
    overridesSchema: makeOverridesSchema({ includeMinCheckpoints: true }),
    defaults: Object.freeze({
      environmentTier: ENV_TIER.ENV_OFFICE_AFTER_HOURS,
      requiresOperatorCoverage: true,
      sla: Object.freeze({
        ...computeSlaPolicy({ environmentTier: ENV_TIER.ENV_OFFICE_AFTER_HOURS }),
        maxExecutionMs: 240 * 60_000,
        maxStallMs: 5 * 60_000
      }),
      metrics: Object.freeze({
        targetCompletionMinutes: 180,
        maxCheckpointGapMinutes: 4,
        minCheckpointsRequired: 14
      })
    })
  }),
  Object.freeze({
    templateId: "security_perimeter_watch_v1",
    vertical: SLA_POLICY_TEMPLATE_VERTICAL.SECURITY,
    name: "Security Perimeter Watch",
    description: "Perimeter-focused template for recurring site sweeps and missed-zone minimization.",
    overridesSchema: makeOverridesSchema({ includeMinCheckpoints: true }),
    defaults: Object.freeze({
      environmentTier: ENV_TIER.ENV_MANAGED_BUILDING,
      requiresOperatorCoverage: true,
      sla: Object.freeze({
        ...computeSlaPolicy({ environmentTier: ENV_TIER.ENV_MANAGED_BUILDING }),
        maxExecutionMs: 210 * 60_000
      }),
      metrics: Object.freeze({
        targetCompletionMinutes: 150,
        maxCheckpointGapMinutes: 5,
        minCheckpointsRequired: 12
      })
    })
  })
]);

function deepClone(value) {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

function normalizedVertical(vertical) {
  if (vertical === null || vertical === undefined) return null;
  const text = String(vertical).trim().toLowerCase();
  if (!text) return null;
  if (text === SLA_POLICY_TEMPLATE_VERTICAL.DELIVERY) return SLA_POLICY_TEMPLATE_VERTICAL.DELIVERY;
  if (text === SLA_POLICY_TEMPLATE_VERTICAL.SECURITY) return SLA_POLICY_TEMPLATE_VERTICAL.SECURITY;
  throw new TypeError("vertical must be delivery or security");
}

function normalizeMetricsPatch(metricsRaw) {
  if (metricsRaw === undefined || metricsRaw === null) return null;
  if (!metricsRaw || typeof metricsRaw !== "object" || Array.isArray(metricsRaw)) {
    throw new TypeError("overrides.metrics must be an object");
  }
  const out = {};
  if (metricsRaw.targetCompletionMinutes !== undefined) {
    const value = Number(metricsRaw.targetCompletionMinutes);
    if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError("overrides.metrics.targetCompletionMinutes must be a positive integer");
    out.targetCompletionMinutes = value;
  }
  if (metricsRaw.maxCheckpointGapMinutes !== undefined) {
    const value = Number(metricsRaw.maxCheckpointGapMinutes);
    if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError("overrides.metrics.maxCheckpointGapMinutes must be a positive integer");
    out.maxCheckpointGapMinutes = value;
  }
  if (metricsRaw.minCheckpointsRequired !== undefined) {
    const value = Number(metricsRaw.minCheckpointsRequired);
    if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError("overrides.metrics.minCheckpointsRequired must be a positive integer");
    out.minCheckpointsRequired = value;
  }
  return out;
}

function normalizeSlaPatch(slaRaw) {
  if (slaRaw === undefined || slaRaw === null) return null;
  if (!slaRaw || typeof slaRaw !== "object" || Array.isArray(slaRaw)) {
    throw new TypeError("overrides.sla must be an object");
  }
  const out = {};
  if (slaRaw.mustStartWithinWindow !== undefined) out.mustStartWithinWindow = Boolean(slaRaw.mustStartWithinWindow);
  if (slaRaw.maxStallMs !== undefined) {
    const value = Number(slaRaw.maxStallMs);
    if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError("overrides.sla.maxStallMs must be a positive integer");
    out.maxStallMs = value;
  }
  if (slaRaw.maxExecutionMs !== undefined) {
    const value = Number(slaRaw.maxExecutionMs);
    if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError("overrides.sla.maxExecutionMs must be a positive integer");
    out.maxExecutionMs = value;
  }
  return out;
}

export function listSlaPolicyTemplates({ vertical = null } = {}) {
  const v = normalizedVertical(vertical);
  return BUILTIN_TEMPLATES.filter((template) => (v ? template.vertical === v : true)).map((template) => deepClone(template));
}

export function getSlaPolicyTemplate({ templateId } = {}) {
  const id = String(templateId ?? "").trim();
  if (!id) throw new TypeError("templateId is required");
  const template = BUILTIN_TEMPLATES.find((item) => item.templateId === id) ?? null;
  return template ? deepClone(template) : null;
}

export function renderSlaPolicyTemplate({ templateId, overrides = null } = {}) {
  const template = getSlaPolicyTemplate({ templateId });
  if (!template) return null;
  const patch = overrides === null || overrides === undefined ? {} : overrides;
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new TypeError("overrides must be an object");

  const out = deepClone(template);

  if (patch.environmentTier !== undefined) {
    const tier = String(patch.environmentTier).trim();
    if (!tier) throw new TypeError("overrides.environmentTier must be a non-empty string");
    out.defaults.environmentTier = tier;
  }

  if (patch.requiresOperatorCoverage !== undefined) out.defaults.requiresOperatorCoverage = Boolean(patch.requiresOperatorCoverage);

  const slaPatch = normalizeSlaPatch(patch.sla);
  if (slaPatch) out.defaults.sla = { ...(out.defaults.sla ?? {}), ...slaPatch };

  const metricsPatch = normalizeMetricsPatch(patch.metrics);
  if (metricsPatch) out.defaults.metrics = { ...(out.defaults.metrics ?? {}), ...metricsPatch };

  return out;
}
