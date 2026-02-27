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
  assertSafeInt(out.amountCents, "action.amountCents");
  if (out.amountCents < 0) throw new TypeError("action.amountCents must be >= 0");

  return normalizeForCanonicalJson(out);
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
  approvalPolicy = {},
  approvalsByActionId = {},
  startedAt = DEFAULT_NOW_ISO,
  nowIso = () => startedAt
}) {
  assertNonEmptyString(scenarioId, "scenarioId");
  assertNonEmptyString(seed, "seed");
  parseIso(startedAt, "startedAt");
  if (!Array.isArray(actions)) throw new TypeError("actions must be an array");
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
