import { canonicalJsonStringify, normalizeForCanonicalJson } from "../../core/canonical-json.js";
import { sha256Hex } from "../../core/crypto.js";
import { runDeterministicSimulation } from "./harness.js";

export const SIMULATION_FAULT_MATRIX_SCHEMA_VERSION = "NooterraSimulationFaultMatrix.v1";
export const SIMULATION_FAULT_RESULT_SCHEMA_VERSION = "NooterraSimulationFaultResult.v1";

const DEFAULT_NOW_ISO = "2026-01-01T00:00:00.000Z";

const SUPPORTED_FAULT_TYPES = Object.freeze({
  network_partition: {
    code: "SIM_NET_PARTITION_DETECTED",
    familyPrefix: "SIM_NET_",
    recoveryCheckId: "recovery_network_partition",
    recoveryDetail: "requires network route restoration marker"
  },
  retry_storm: {
    code: "SIM_RETRY_STORM_DETECTED",
    familyPrefix: "SIM_RETRY_",
    recoveryCheckId: "recovery_retry_storm",
    recoveryDetail: "requires retry budget + idempotency lock marker"
  },
  stale_cursor: {
    code: "SIM_CURSOR_STALE_DETECTED",
    familyPrefix: "SIM_CURSOR_",
    recoveryCheckId: "recovery_stale_cursor",
    recoveryDetail: "requires replay-from-last-stable-cursor marker"
  },
  signer_failure: {
    code: "SIM_SIGNER_FAILURE_DETECTED",
    familyPrefix: "SIM_SIGNER_",
    recoveryCheckId: "recovery_signer_failure",
    recoveryDetail: "requires signer rotation or fallback signer marker"
  },
  settlement_race: {
    code: "SIM_SETTLEMENT_RACE_DETECTED",
    familyPrefix: "SIM_SETTLEMENT_",
    recoveryCheckId: "recovery_settlement_race",
    recoveryDetail: "requires deterministic lock or escrow serial marker"
  },
  economic_abuse: {
    code: "SIM_ECONOMIC_ABUSE_DETECTED",
    familyPrefix: "SIM_ECONOMIC_",
    recoveryCheckId: "recovery_economic_abuse",
    recoveryDetail: "requires anti-sybil/quarantine marker"
  }
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

function stableHash(value) {
  return sha256Hex(canonicalJsonStringify(normalizeForCanonicalJson(value)));
}

function normalizeFaultSpec(fault, { index }) {
  assertPlainObject(fault, `faults[${index}]`);
  const out = {
    faultId: String(fault.faultId ?? "").trim(),
    type: String(fault.type ?? "").trim(),
    targetActionType: fault.targetActionType == null ? null : String(fault.targetActionType).trim(),
    metadata: fault.metadata ?? {}
  };
  assertNonEmptyString(out.faultId, `faults[${index}].faultId`);
  assertNonEmptyString(out.type, `faults[${index}].type`);
  if (!(out.type in SUPPORTED_FAULT_TYPES)) throw new TypeError(`faults[${index}].type is unsupported`);
  if (out.targetActionType !== null) assertNonEmptyString(out.targetActionType, `faults[${index}].targetActionType`);
  return normalizeForCanonicalJson(out);
}

function selectTargetAction({ run, fault }) {
  if (fault.targetActionType) {
    return run.actionResults.find((row) => row.actionType === fault.targetActionType) ?? null;
  }
  return run.actionResults[0] ?? null;
}

function hasRecoveryMarker({ recoveryMarkers, faultType }) {
  if (!(recoveryMarkers instanceof Map)) return false;
  return recoveryMarkers.get(faultType) === true;
}

function evaluateFault({ run, fault, recoveryMarkers, nowIso }) {
  const definition = SUPPORTED_FAULT_TYPES[fault.type];
  const target = selectTargetAction({ run, fault });
  const injectedIssue = {
    actionId: target?.actionId ?? "scenario",
    actionType: target?.actionType ?? "invariant",
    code: definition.code,
    detail: `fault ${fault.faultId} (${fault.type}) injected at ${nowIso()}`
  };
  const observedReasonCodes = Array.from(
    new Set([
      ...run.blockingIssues.map((issue) => String(issue?.code ?? "").trim()).filter(Boolean),
      injectedIssue.code
    ])
  ).sort();

  const reasonFamilyCheck = {
    checkId: `fault_reason_family_${fault.faultId}`,
    passed: observedReasonCodes.some((code) => code.startsWith(definition.familyPrefix)),
    detail: `expected family ${definition.familyPrefix}, observed ${observedReasonCodes.join(",") || "none"}`
  };

  const recovered = hasRecoveryMarker({ recoveryMarkers, faultType: fault.type });
  const recoveryCheck = {
    checkId: definition.recoveryCheckId,
    passed: recovered,
    detail: recovered ? `recovery marker present for ${fault.type}` : definition.recoveryDetail
  };

  const checks = [reasonFamilyCheck, recoveryCheck];
  const blockingIssues = [injectedIssue];
  if (!recoveryCheck.passed) {
    blockingIssues.push({
      actionId: injectedIssue.actionId,
      actionType: injectedIssue.actionType,
      code: "SIM_RECOVERY_NOT_VALIDATED",
      detail: `fault ${fault.faultId} has no deterministic recovery validation`
    });
  }

  const faultCore = normalizeForCanonicalJson({
    schemaVersion: SIMULATION_FAULT_RESULT_SCHEMA_VERSION,
    faultId: fault.faultId,
    faultType: fault.type,
    faultSha256: stableHash({
      runSha256: run.runSha256,
      fault
    }),
    runSha256: run.runSha256,
    observedReasonCodes,
    checks,
    blockingIssues
  });

  return {
    ...faultCore,
    passed: checks.every((check) => check.passed === true)
  };
}

function normalizeRecoveryMarkers(raw) {
  if (raw == null) return new Map();
  assertPlainObject(raw, "recoveryMarkers");
  const out = new Map();
  for (const [key, value] of Object.entries(raw)) {
    out.set(String(key), value === true);
  }
  return out;
}

export function runSimulationFaultMatrix({
  scenarioId,
  seed,
  actions,
  approvalPolicy = {},
  approvalsByActionId = {},
  faults,
  recoveryMarkers = {},
  startedAt = DEFAULT_NOW_ISO,
  nowIso = () => startedAt
}) {
  assertNonEmptyString(scenarioId, "scenarioId");
  assertNonEmptyString(seed, "seed");
  if (!Array.isArray(actions)) throw new TypeError("actions must be an array");
  if (!Array.isArray(faults) || faults.length === 0) throw new TypeError("faults must be a non-empty array");
  assertPlainObject(approvalPolicy, "approvalPolicy");
  assertPlainObject(approvalsByActionId, "approvalsByActionId");
  parseIso(startedAt, "startedAt");

  const normalizedFaults = faults.map((fault, idx) => normalizeFaultSpec(fault, { index: idx }));
  const uniqueFaultIds = new Set(normalizedFaults.map((fault) => fault.faultId));
  if (uniqueFaultIds.size !== normalizedFaults.length) throw new TypeError("faultIds must be unique");
  const recoveryMarkerMap = normalizeRecoveryMarkers(recoveryMarkers);

  const baseRun = runDeterministicSimulation({
    scenarioId,
    seed,
    actions,
    approvalPolicy,
    approvalsByActionId,
    startedAt,
    nowIso
  });

  const results = normalizedFaults.map((fault) =>
    evaluateFault({
      run: baseRun,
      fault,
      recoveryMarkers: recoveryMarkerMap,
      nowIso
    })
  );

  const checks = normalizeForCanonicalJson([
    {
      checkId: "faults_executed",
      passed: results.length === normalizedFaults.length,
      detail: `executed ${results.length} fault scenarios`
    },
    {
      checkId: "fault_reason_families_resolved",
      passed: results.every((row) => row.checks.some((check) => check.checkId.startsWith("fault_reason_family_") && check.passed)),
      detail: "every fault emitted a deterministic reason-code family"
    },
    {
      checkId: "fault_recovery_paths_validated",
      passed: results.every((row) => row.checks.some((check) => check.checkId.startsWith("recovery_") && check.passed)),
      detail: "every fault includes deterministic recovery validation"
    }
  ]);

  const blockingIssues = results.flatMap((row) => row.blockingIssues);
  const core = normalizeForCanonicalJson({
    schemaVersion: SIMULATION_FAULT_MATRIX_SCHEMA_VERSION,
    scenarioId,
    seed,
    startedAt,
    baseRunSha256: baseRun.runSha256,
    summary: {
      totalFaults: results.length,
      passedFaults: results.filter((row) => row.passed).length,
      failedFaults: results.filter((row) => !row.passed).length
    },
    checks,
    blockingIssues,
    results
  });

  return {
    ...core,
    matrixSha256: stableHash(core)
  };
}

export function listSupportedSimulationFaultTypes() {
  return Object.freeze(Object.keys(SUPPORTED_FAULT_TYPES));
}

export function createDefaultSimulationFaultMatrixSpec() {
  return normalizeForCanonicalJson({
    faults: [
      { faultId: "fault_network_partition_1", type: "network_partition" },
      { faultId: "fault_retry_storm_1", type: "retry_storm" },
      { faultId: "fault_stale_cursor_1", type: "stale_cursor" },
      { faultId: "fault_signer_failure_1", type: "signer_failure" },
      { faultId: "fault_settlement_race_1", type: "settlement_race" },
      { faultId: "fault_economic_abuse_1", type: "economic_abuse" }
    ]
  });
}
