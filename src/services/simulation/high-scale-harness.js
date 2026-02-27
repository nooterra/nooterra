import { canonicalJsonStringify, normalizeForCanonicalJson } from "../../core/canonical-json.js";
import { sha256Hex } from "../../core/crypto.js";
import { HUMAN_APPROVAL_DECISION_SCHEMA_VERSION } from "../human-approval/gate.js";
import { runDeterministicSimulation } from "./harness.js";

export const SIMULATION_HIGH_SCALE_HARNESS_SCHEMA_VERSION = "NooterraSimulationHighScaleHarness.v1";
export const SIMULATION_HIGH_SCALE_RUN_SCHEMA_VERSION = "NooterraSimulationHighScaleRun.v1";

const DEFAULT_NOW_ISO = "2026-01-01T00:00:00.000Z";

const TIER_SPECS = Object.freeze({
  smoke_100: Object.freeze({ tierId: "smoke_100", agentCount: 100, actionsPerAgent: 1, highRiskEvery: 10 }),
  scale_1000: Object.freeze({ tierId: "scale_1000", agentCount: 1_000, actionsPerAgent: 1, highRiskEvery: 20 }),
  scale_10000: Object.freeze({ tierId: "scale_10000", agentCount: 10_000, actionsPerAgent: 1, highRiskEvery: 25 })
});

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be a plain object`);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw new TypeError(`${name} must be a plain object`);
}

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
}

function assertSafeInt(value, name) {
  if (!Number.isSafeInteger(value)) throw new TypeError(`${name} must be a safe integer`);
}

function parseIso(value, name) {
  assertNonEmptyString(value, name);
  if (!Number.isFinite(Date.parse(value))) throw new TypeError(`${name} must be an ISO-8601 timestamp`);
}

function stableId(seed, prefix, parts) {
  return `${prefix}_${sha256Hex(`${seed}|${parts.map((v) => String(v)).join("|")}`).slice(0, 20)}`;
}

function stableHash(value) {
  return sha256Hex(canonicalJsonStringify(normalizeForCanonicalJson(value)));
}

function normalizeTierSpec(tier) {
  if (typeof tier !== "string" || !(tier in TIER_SPECS)) throw new TypeError(`tier must be one of ${Object.keys(TIER_SPECS).join(", ")}`);
  return TIER_SPECS[tier];
}

function normalizeLimits(raw) {
  if (raw == null) return {};
  assertPlainObject(raw, "limits");
  const out = {
    maxAgents: raw.maxAgents ?? null,
    maxActions: raw.maxActions ?? null,
    maxEstimatedMemoryBytes: raw.maxEstimatedMemoryBytes ?? null
  };
  for (const [key, value] of Object.entries(out)) {
    if (value == null) continue;
    assertSafeInt(value, `limits.${key}`);
    if (value < 0) throw new TypeError(`limits.${key} must be >= 0`);
  }
  return out;
}

function buildTierActions({ seed, tierSpec, managerId, ecosystemId }) {
  const actions = [];
  for (let i = 0; i < tierSpec.agentCount; i += 1) {
    const actorId = stableId(seed, "agent", [tierSpec.tierId, i + 1]);
    for (let j = 0; j < tierSpec.actionsPerAgent; j += 1) {
      const sequence = i * tierSpec.actionsPerAgent + j + 1;
      const highRisk = (i + 1) % tierSpec.highRiskEvery === 0;
      actions.push(
        normalizeForCanonicalJson({
          actionId: stableId(seed, "act", [tierSpec.tierId, sequence]),
          actorId,
          managerId,
          ecosystemId,
          actionType: highRisk ? "funds_transfer" : "coordination_ping",
          riskTier: highRisk ? "high" : "low",
          amountCents: highRisk ? 250_000 : 0,
          metadata: {
            tier: tierSpec.tierId,
            sequence
          }
        })
      );
    }
  }
  return actions;
}

function enforceLimits({ tierSpec, actions, limits }) {
  const diagnostics = [];
  const estimatedMemoryBytes = actions.length * 256;
  if (limits.maxAgents != null && tierSpec.agentCount > limits.maxAgents) {
    diagnostics.push({
      code: "SIM_RESOURCE_LIMIT_EXCEEDED",
      detail: "agent count exceeds configured maxAgents",
      observed: tierSpec.agentCount,
      limit: limits.maxAgents
    });
  }
  if (limits.maxActions != null && actions.length > limits.maxActions) {
    diagnostics.push({
      code: "SIM_RESOURCE_LIMIT_EXCEEDED",
      detail: "action count exceeds configured maxActions",
      observed: actions.length,
      limit: limits.maxActions
    });
  }
  if (limits.maxEstimatedMemoryBytes != null && estimatedMemoryBytes > limits.maxEstimatedMemoryBytes) {
    diagnostics.push({
      code: "SIM_RESOURCE_LIMIT_EXCEEDED",
      detail: "estimated memory footprint exceeds configured maxEstimatedMemoryBytes",
      observed: estimatedMemoryBytes,
      limit: limits.maxEstimatedMemoryBytes
    });
  }
  return {
    estimatedMemoryBytes,
    diagnostics
  };
}

function buildDeterministicApprovals({ previewRun, startedAt }) {
  const approvals = {};
  for (const row of previewRun.actionResults) {
    if (row.requiresExplicitApproval !== true) continue;
    approvals[row.actionId] = normalizeForCanonicalJson({
      schemaVersion: HUMAN_APPROVAL_DECISION_SCHEMA_VERSION,
      decisionId: `dec_${row.actionId}`,
      actionId: row.actionId,
      actionSha256: row.actionSha256,
      decidedBy: "human.simulation.operator",
      decidedAt: startedAt,
      approved: true,
      evidenceRefs: ["runbook:simulation/high-scale-harness"]
    });
  }
  return approvals;
}

export function listHighScaleSimulationTiers() {
  return Object.freeze(Object.keys(TIER_SPECS));
}

export function runHighScaleSimulationHarness({
  tier,
  seed,
  scenarioId = null,
  managerId = "manager.simulation",
  ecosystemId = "ecosystem.default",
  limits = {},
  startedAt = DEFAULT_NOW_ISO
}) {
  const tierSpec = normalizeTierSpec(tier);
  const normalizedLimits = normalizeLimits(limits);
  assertNonEmptyString(seed, "seed");
  if (scenarioId != null) assertNonEmptyString(scenarioId, "scenarioId");
  assertNonEmptyString(managerId, "managerId");
  assertNonEmptyString(ecosystemId, "ecosystemId");
  parseIso(startedAt, "startedAt");

  const resolvedScenarioId = scenarioId ?? `sim_${tierSpec.tierId}_${seed}`;
  const actions = buildTierActions({
    seed,
    tierSpec,
    managerId,
    ecosystemId
  });
  const { estimatedMemoryBytes, diagnostics } = enforceLimits({
    tierSpec,
    actions,
    limits: normalizedLimits
  });

  if (diagnostics.length > 0) {
    const failureCore = normalizeForCanonicalJson({
      schemaVersion: SIMULATION_HIGH_SCALE_RUN_SCHEMA_VERSION,
      tier: tierSpec.tierId,
      scenarioId: resolvedScenarioId,
      seed,
      startedAt,
      ok: false,
      telemetry: {
        agentCount: tierSpec.agentCount,
        actionCount: actions.length,
        estimatedMemoryBytes
      },
      diagnostics
    });
    return {
      ...failureCore,
      harnessSha256: stableHash(failureCore)
    };
  }

  const previewRun = runDeterministicSimulation({
    scenarioId: resolvedScenarioId,
    seed,
    actions,
    approvalPolicy: { requireApprovalAboveCents: 100_000 },
    startedAt,
    nowIso: () => startedAt
  });
  const approvalsByActionId = buildDeterministicApprovals({ previewRun, startedAt });
  const run = runDeterministicSimulation({
    scenarioId: resolvedScenarioId,
    seed,
    actions,
    approvalPolicy: { requireApprovalAboveCents: 100_000 },
    approvalsByActionId,
    startedAt,
    nowIso: () => startedAt
  });

  const successCore = normalizeForCanonicalJson({
    schemaVersion: SIMULATION_HIGH_SCALE_RUN_SCHEMA_VERSION,
    tier: tierSpec.tierId,
    scenarioId: resolvedScenarioId,
    seed,
    startedAt,
    ok: true,
    telemetry: {
      agentCount: tierSpec.agentCount,
      actionCount: actions.length,
      highRiskActions: run.summary.highRiskActions,
      approvedActions: run.summary.approvedActions,
      blockedActions: run.summary.blockedActions,
      estimatedMemoryBytes
    },
    diagnostics: [],
    run
  });
  return {
    ...successCore,
    harnessSha256: stableHash(successCore)
  };
}

export function createDefaultHighScaleHarnessSpec() {
  return normalizeForCanonicalJson({
    schemaVersion: SIMULATION_HIGH_SCALE_HARNESS_SCHEMA_VERSION,
    tier: "scale_10000",
    seed: "high-scale-default-seed",
    startedAt: DEFAULT_NOW_ISO,
    limits: {
      maxAgents: 20_000,
      maxActions: 20_000,
      maxEstimatedMemoryBytes: 10_000_000
    }
  });
}
