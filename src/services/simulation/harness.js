import { canonicalJsonStringify, normalizeForCanonicalJson } from "../../core/canonical-json.js";
import { sha256Hex } from "../../core/crypto.js";
import {
  createApprovalRequest,
  enforceHighRiskApproval,
  HUMAN_APPROVAL_POLICY_SCHEMA_VERSION
} from "../human-approval/gate.js";

export const SIMULATION_HARNESS_SCHEMA_VERSION = "NooterraSimulationHarness.v1";
export const SIMULATION_RUN_SCHEMA_VERSION = "NooterraSimulationRun.v1";
export const PERSONAL_AGENT_ECOSYSTEM_SCENARIO_SCHEMA_VERSION = "NooterraPersonalAgentEcosystemScenario.v1";
export const SIMULATION_SCENARIO_DSL_SCHEMA_VERSION = "NooterraSimulationScenarioDsl.v1";

const DEFAULT_NOW_ISO = "2026-01-01T00:00:00.000Z";

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be a plain object`);
  }
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

function assertSafeIntGteZero(value, name) {
  assertSafeInt(value, name);
  if (value < 0) throw new TypeError(`${name} must be >= 0`);
}

function normalizeAction(action, { actionId, sequence }) {
  assertPlainObject(action, "action");
  const out = {
    actionId,
    sequence,
    actorId: String(action.actorId ?? "").trim(),
    managerId: String(action.managerId ?? "").trim(),
    ecosystemId: String(action.ecosystemId ?? "").trim(),
    actionType: String(action.actionType ?? "").trim(),
    riskTier: String(action.riskTier ?? "").trim(),
    amountCents: action.amountCents ?? 0,
    metadata: action.metadata ?? {}
  };

  assertNonEmptyString(out.actorId, "action.actorId");
  assertNonEmptyString(out.managerId, "action.managerId");
  assertNonEmptyString(out.ecosystemId, "action.ecosystemId");
  assertNonEmptyString(out.actionType, "action.actionType");
  assertNonEmptyString(out.riskTier, "action.riskTier");
  if (!["low", "medium", "high"].includes(out.riskTier)) throw new TypeError("action.riskTier must be low, medium, or high");
  assertSafeIntGteZero(out.amountCents, "action.amountCents");

  return normalizeForCanonicalJson(out);
}

function normalizeScenarioDslActorRole(role, { index }) {
  assertPlainObject(role, `actorRoles[${index}]`);
  const out = {
    roleId: String(role.roleId ?? "").trim(),
    count: role.count ?? 1
  };
  assertNonEmptyString(out.roleId, `actorRoles[${index}].roleId`);
  assertSafeIntGteZero(out.count, `actorRoles[${index}].count`);
  if (out.count < 1) throw new TypeError(`actorRoles[${index}].count must be >= 1`);
  return normalizeForCanonicalJson(out);
}

function normalizeScenarioDslFlowAction(action, { index }) {
  assertPlainObject(action, `flow[${index}]`);
  const out = {
    actionType: String(action.actionType ?? "").trim(),
    roleId: String(action.roleId ?? "").trim(),
    riskTier: String(action.riskTier ?? "").trim(),
    amountCents: action.amountCents ?? 0,
    metadata: action.metadata ?? {}
  };
  assertNonEmptyString(out.actionType, `flow[${index}].actionType`);
  assertNonEmptyString(out.roleId, `flow[${index}].roleId`);
  assertNonEmptyString(out.riskTier, `flow[${index}].riskTier`);
  if (!["low", "medium", "high"].includes(out.riskTier)) throw new TypeError(`flow[${index}].riskTier must be low, medium, or high`);
  assertSafeIntGteZero(out.amountCents, `flow[${index}].amountCents`);
  return normalizeForCanonicalJson(out);
}

function normalizeScenarioDslInvariant(hook, { index }) {
  assertPlainObject(hook, `invariants[${index}]`);
  const out = {
    hookId: String(hook.hookId ?? "").trim(),
    type: String(hook.type ?? "").trim(),
    max: hook.max ?? null
  };
  assertNonEmptyString(out.hookId, `invariants[${index}].hookId`);
  assertNonEmptyString(out.type, `invariants[${index}].type`);
  if (!["blocked_actions_at_most", "high_risk_actions_at_most", "all_checks_passed"].includes(out.type)) {
    throw new TypeError(`invariants[${index}].type is unsupported`);
  }
  if (out.type !== "all_checks_passed") assertSafeIntGteZero(out.max, `invariants[${index}].max`);
  return normalizeForCanonicalJson(out);
}

function resolveActorForRole({ actorIndexByRole, roleId, sequence }) {
  const actors = actorIndexByRole.get(roleId) ?? null;
  if (!Array.isArray(actors) || actors.length === 0) {
    throw new TypeError(`flow roleId '${roleId}' is not defined in actorRoles`);
  }
  return actors[(sequence - 1) % actors.length];
}

function evaluateInvariantHook({ hook, runCore }) {
  if (hook.type === "blocked_actions_at_most") {
    const blocked = Number(runCore.summary?.blockedActions ?? 0);
    const passed = blocked <= hook.max;
    return {
      checkId: `invariant_${hook.hookId}`,
      passed,
      detail: passed ? `blocked actions ${blocked} <= ${hook.max}` : `blocked actions ${blocked} > ${hook.max}`,
      issue: passed ? null : {
        actionId: "scenario",
        actionType: "invariant",
        code: "SIMULATION_INVARIANT_FAILED",
        detail: `hookId=${hook.hookId} blocked actions exceeded max=${hook.max}`
      }
    };
  }
  if (hook.type === "high_risk_actions_at_most") {
    const highRisk = Number(runCore.summary?.highRiskActions ?? 0);
    const passed = highRisk <= hook.max;
    return {
      checkId: `invariant_${hook.hookId}`,
      passed,
      detail: passed ? `high-risk actions ${highRisk} <= ${hook.max}` : `high-risk actions ${highRisk} > ${hook.max}`,
      issue: passed ? null : {
        actionId: "scenario",
        actionType: "invariant",
        code: "SIMULATION_INVARIANT_FAILED",
        detail: `hookId=${hook.hookId} high-risk actions exceeded max=${hook.max}`
      }
    };
  }
  const allChecksPassed = Array.isArray(runCore.checks) && runCore.checks.every((check) => check?.passed === true);
  return {
    checkId: `invariant_${hook.hookId}`,
    passed: allChecksPassed,
    detail: allChecksPassed ? "all base checks passed" : "base checks contain failures",
    issue: allChecksPassed
      ? null
      : {
          actionId: "scenario",
          actionType: "invariant",
          code: "SIMULATION_INVARIANT_FAILED",
          detail: `hookId=${hook.hookId} required all base checks to pass`
        }
  };
}

export function createSimulationHarnessPrimitives({ seed }) {
  assertNonEmptyString(seed, "seed");

  const stableId = (prefix, parts) => {
    assertNonEmptyString(prefix, "prefix");
    const normalizedParts = Array.isArray(parts) ? parts.map((v) => String(v)) : [String(parts ?? "")];
    return `${prefix}_${sha256Hex(`${seed}|${normalizedParts.join("|")}`).slice(0, 20)}`;
  };

  const canonicalHash = (value) => sha256Hex(canonicalJsonStringify(normalizeForCanonicalJson(value)));

  return Object.freeze({
    schemaVersion: SIMULATION_HARNESS_SCHEMA_VERSION,
    seed,
    stableId,
    canonicalHash
  });
}

export function runDeterministicSimulation({
  scenarioId,
  seed,
  actions,
  invariantHooks = [],
  approvalPolicy = {},
  approvalsByActionId = {},
  startedAt = DEFAULT_NOW_ISO,
  nowIso = () => startedAt
}) {
  assertNonEmptyString(scenarioId, "scenarioId");
  assertNonEmptyString(seed, "seed");
  parseIso(startedAt, "startedAt");
  if (!Array.isArray(actions)) throw new TypeError("actions must be an array");
  if (!Array.isArray(invariantHooks)) throw new TypeError("invariantHooks must be an array");
  assertPlainObject(approvalPolicy, "approvalPolicy");
  assertPlainObject(approvalsByActionId, "approvalsByActionId");

  const primitives = createSimulationHarnessPrimitives({ seed });
  const normalizedActions = actions.map((action, idx) => {
    const actionId = action?.actionId ? String(action.actionId).trim() : primitives.stableId("act", [scenarioId, idx + 1, action?.actionType ?? "unknown"]);
    return normalizeAction(action, { actionId, sequence: idx + 1 });
  });

  const actionResults = [];
  const blockingIssues = [];

  for (const action of normalizedActions) {
    const approvalDecision = approvalsByActionId[action.actionId] ?? null;
    const approvalCheck = enforceHighRiskApproval({
      action,
      approvalPolicy,
      approvalDecision,
      nowIso
    });
    const approvalRequest = approvalCheck.requiresExplicitApproval
      ? createApprovalRequest({
          action,
          requestedBy: action.managerId,
          requestedAt: startedAt
        })
      : null;

    const row = {
      actionId: action.actionId,
      actionType: action.actionType,
      actorId: action.actorId,
      riskTier: action.riskTier,
      amountCents: action.amountCents,
      approved: approvalCheck.approved,
      requiresExplicitApproval: approvalCheck.requiresExplicitApproval,
      actionSha256: approvalCheck.actionSha256,
      approvalRequest,
      checks: approvalCheck.checks,
      blockingIssues: approvalCheck.blockingIssues
    };
    actionResults.push(row);
    if (!row.approved) {
      for (const issue of row.blockingIssues) {
        blockingIssues.push({
          actionId: row.actionId,
          actionType: row.actionType,
          code: issue.code,
          detail: issue.detail
        });
      }
    }
  }

  const highRiskCount = actionResults.filter((row) => row.requiresExplicitApproval).length;
  const blockedCount = actionResults.filter((row) => !row.approved).length;
  const checks = [
    {
      checkId: "simulation_actions_processed",
      passed: true,
      detail: `processed ${actionResults.length} actions`
    },
    {
      checkId: "high_risk_actions_require_explicit_approval",
      passed: blockingIssues.every((issue) => issue.code !== "HUMAN_APPROVAL_REQUIRED"),
      detail:
        highRiskCount === 0
          ? "no high-risk actions in scenario"
          : `${highRiskCount} high-risk actions evaluated with explicit approval gate`
    },
    {
      checkId: "simulation_fail_closed",
      passed: blockedCount === 0,
      detail: blockedCount === 0 ? "no blocking issues" : `${blockedCount} actions blocked fail-closed`
    }
  ];

  const runCore = {
    schemaVersion: SIMULATION_RUN_SCHEMA_VERSION,
    scenarioId,
    seed,
    startedAt,
    approvalPolicy: {
      ...approvalPolicy,
      schemaVersion: HUMAN_APPROVAL_POLICY_SCHEMA_VERSION
    },
    summary: {
      totalActions: actionResults.length,
      highRiskActions: highRiskCount,
      approvedActions: actionResults.length - blockedCount,
      blockedActions: blockedCount
    },
    checks,
    blockingIssues,
    actionResults
  };

  const normalizedInvariantHooks = invariantHooks.map((hook, idx) => normalizeScenarioDslInvariant(hook, { index: idx }));
  for (const hook of normalizedInvariantHooks) {
    const result = evaluateInvariantHook({ hook, runCore });
    runCore.checks.push({
      checkId: result.checkId,
      passed: result.passed,
      detail: result.detail
    });
    if (result.issue) runCore.blockingIssues.push(result.issue);
  }

  const failClosedCheck = runCore.checks.find((check) => check.checkId === "simulation_fail_closed");
  const blockedActions = runCore.actionResults.filter((row) => row.approved !== true).length;
  const invariantBlocked = runCore.blockingIssues.filter((issue) => issue.code === "SIMULATION_INVARIANT_FAILED").length;
  runCore.summary.blockedActions = blockedActions + invariantBlocked;
  runCore.summary.approvedActions = Math.max(runCore.summary.totalActions - runCore.summary.blockedActions, 0);
  if (failClosedCheck) {
    failClosedCheck.passed = runCore.summary.blockedActions === 0;
    failClosedCheck.detail =
      runCore.summary.blockedActions === 0
        ? "no blocking issues"
        : `${runCore.summary.blockedActions} actions blocked fail-closed`;
  }

  return {
    ...runCore,
    runSha256: primitives.canonicalHash(runCore)
  };
}

export function buildPersonalAgentEcosystemScenario({ scenarioId, seed, managerId, ecosystemId, actions }) {
  assertNonEmptyString(scenarioId, "scenarioId");
  assertNonEmptyString(seed, "seed");
  assertNonEmptyString(managerId, "managerId");
  assertNonEmptyString(ecosystemId, "ecosystemId");
  if (!Array.isArray(actions)) throw new TypeError("actions must be an array");

  return normalizeForCanonicalJson({
    schemaVersion: PERSONAL_AGENT_ECOSYSTEM_SCENARIO_SCHEMA_VERSION,
    scenarioId,
    seed,
    managerId,
    ecosystemId,
    actions
  });
}

export function buildSimulationScenarioFromDsl({
  scenarioId,
  seed,
  managerId,
  ecosystemId,
  actorRoles,
  flow,
  invariants = []
}) {
  assertNonEmptyString(scenarioId, "scenarioId");
  assertNonEmptyString(seed, "seed");
  assertNonEmptyString(managerId, "managerId");
  assertNonEmptyString(ecosystemId, "ecosystemId");
  if (!Array.isArray(actorRoles) || actorRoles.length === 0) throw new TypeError("actorRoles must be a non-empty array");
  if (!Array.isArray(flow) || flow.length === 0) throw new TypeError("flow must be a non-empty array");
  if (!Array.isArray(invariants)) throw new TypeError("invariants must be an array");

  const primitives = createSimulationHarnessPrimitives({ seed });
  const normalizedRoles = actorRoles.map((role, idx) => normalizeScenarioDslActorRole(role, { index: idx }));
  const normalizedFlow = flow.map((action, idx) => normalizeScenarioDslFlowAction(action, { index: idx }));
  const normalizedInvariants = invariants.map((hook, idx) => normalizeScenarioDslInvariant(hook, { index: idx }));

  const actorIndexByRole = new Map();
  for (const role of normalizedRoles) {
    const actors = [];
    for (let i = 0; i < role.count; i += 1) {
      actors.push(primitives.stableId("agent", [scenarioId, role.roleId, i + 1]));
    }
    actorIndexByRole.set(role.roleId, actors);
  }

  const actions = normalizedFlow.map((item, idx) => {
    const actorId = resolveActorForRole({ actorIndexByRole, roleId: item.roleId, sequence: idx + 1 });
    return normalizeForCanonicalJson({
      actionId: primitives.stableId("act", [scenarioId, idx + 1, item.roleId, item.actionType]),
      actorId,
      managerId,
      ecosystemId,
      actionType: item.actionType,
      riskTier: item.riskTier,
      amountCents: item.amountCents,
      metadata: item.metadata
    });
  });

  return normalizeForCanonicalJson({
    schemaVersion: SIMULATION_SCENARIO_DSL_SCHEMA_VERSION,
    scenarioId,
    seed,
    managerId,
    ecosystemId,
    actorRoles: normalizedRoles,
    flow: normalizedFlow,
    invariants: normalizedInvariants,
    generatedScenario: buildPersonalAgentEcosystemScenario({
      scenarioId,
      seed,
      managerId,
      ecosystemId,
      actions
    })
  });
}
