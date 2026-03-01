#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { createEd25519Keypair } from "../../src/core/crypto.js";
import { signOperatorActionV1 } from "../../src/core/operator-action.js";

function parseIntEnv(name, fallback, { min = null, max = null } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be an integer`);
  if (min !== null && value < min) throw new Error(`${name} must be >= ${min}`);
  if (max !== null && value > max) throw new Error(`${name} must be <= ${max}`);
  return value;
}

function normalizeBaseUrl(raw) {
  const value = typeof raw === "string" && raw.trim() !== "" ? raw.trim() : "http://127.0.0.1:3000";
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function resolveReportPath(cwd = process.cwd(), env = process.env) {
  return resolve(cwd, env.EMERGENCY_CONTAINMENT_REPORT_PATH || "artifacts/ops/emergency-containment-drill-summary.json");
}

function toFailureSummary(err) {
  return {
    message: err?.message ?? String(err),
    statusCode: Number.isSafeInteger(err?.statusCode) ? err.statusCode : null,
    details: err?.details ?? null
  };
}

async function writeFailureReport({ reportPath, runConfig = null, error }) {
  await mkdir(dirname(reportPath), { recursive: true });
  const report = {
    schemaVersion: "EmergencyContainmentDrillReport.v1",
    generatedAt: new Date().toISOString(),
    runConfig,
    durationMs: 0,
    checks: [],
    snapshots: {},
    failure: toFailureSummary(error),
    verdict: {
      ok: false,
      requiredChecks: 0,
      passedChecks: 0
    }
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`wrote emergency containment drill report: ${reportPath}\n`);
}

async function main() {
  const startedAt = Date.now();
  const runId = `emg_drill_${Date.now()}`;
  const baseUrl = normalizeBaseUrl(process.env.BASE_URL);
  const opsToken = typeof process.env.OPS_TOKEN === "string" ? process.env.OPS_TOKEN.trim() : "";
  if (!opsToken) throw new Error("OPS_TOKEN is required");
  const tenantId =
    typeof process.env.TENANT_ID === "string" && process.env.TENANT_ID.trim() !== ""
      ? process.env.TENANT_ID.trim()
      : "tenant_default";
  const protocolVersion =
    typeof process.env.NOOTERRA_PROTOCOL === "string" && process.env.NOOTERRA_PROTOCOL.trim() !== ""
      ? process.env.NOOTERRA_PROTOCOL.trim()
      : "1.0";
  const timeoutMs = parseIntEnv("HTTP_TIMEOUT_MS", 10_000, { min: 1000, max: 120_000 });
  const containmentTargetMs = parseIntEnv("EMERGENCY_CONTAINMENT_TARGET_MS", 5_000, { min: 1, max: 120_000 });
  const recoveryTargetMs = parseIntEnv("EMERGENCY_RECOVERY_TARGET_MS", 8_000, { min: 1, max: 120_000 });
  const signerRevocationTargetMs = parseIntEnv("EMERGENCY_SIGNER_REVOCATION_TARGET_MS", 5_000, { min: 1, max: 120_000 });
  const reportPath = resolveReportPath(process.cwd(), process.env);

  const runConfig = {
    runId,
    baseUrl,
    tenantId,
    protocolVersion,
    timeoutMs,
    targets: {
      containmentTargetMs,
      recoveryTargetMs,
      signerRevocationTargetMs
    }
  };
  await mkdir(dirname(reportPath), { recursive: true });

  const defaultHeaders = {
    "x-proxy-tenant-id": tenantId,
    "x-proxy-ops-token": opsToken,
    accept: "application/json"
  };

  async function requestJson({ method, path, body = null, write = false, idempotencyKey = null }) {
    const headers = { ...defaultHeaders };
    if (write) {
      headers["content-type"] = "application/json";
      headers["x-nooterra-protocol"] = protocolVersion;
      if (idempotencyKey) headers["x-idempotency-key"] = idempotencyKey;
    }
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === null ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {}
    if (!response.ok) {
      const details = json && typeof json === "object" ? json : { body: text };
      const err = new Error(`${method} ${path} failed (${response.status})`);
      err.statusCode = response.status;
      err.details = details;
      throw err;
    }
    return { statusCode: response.status, json };
  }

  let operatorActionSeq = 0;
  function buildSignedOperatorAction({ signer, operatorId, role, caseIdPrefix, action = "OVERRIDE_DENY" }) {
    operatorActionSeq += 1;
    return signOperatorActionV1({
      action: {
        actionId: `${runId}_oa_${operatorActionSeq}`,
        caseRef: { kind: "escalation", caseId: `${caseIdPrefix}_${operatorActionSeq}` },
        action,
        justificationCode: "OPS_EMERGENCY_CONTROL",
        justification: `${runId}:${caseIdPrefix}`,
        actor: { operatorId, role, tenantId },
        actedAt: new Date().toISOString()
      },
      publicKeyPem: signer.publicKeyPem,
      privateKeyPem: signer.privateKeyPem
    });
  }

  async function registerSigner({ description }) {
    const keypair = createEd25519Keypair();
    const created = await requestJson({
      method: "POST",
      path: "/ops/signer-keys",
      write: true,
      idempotencyKey: `${runId}_signer_${description.replaceAll(/[^a-z0-9]+/gi, "_").toLowerCase()}`,
      body: {
        publicKeyPem: keypair.publicKeyPem,
        purpose: "operator",
        description
      }
    });
    return {
      ...keypair,
      keyId: String(created?.json?.signerKey?.keyId ?? "")
    };
  }

  async function revokeSignerKey({ keyId }) {
    const started = Date.now();
    const res = await requestJson({
      method: "POST",
      path: `/ops/signer-keys/${encodeURIComponent(keyId)}/revoke`,
      write: true,
      idempotencyKey: `${runId}_revoke_signer_${keyId}`,
      body: {}
    });
    return { res, durationMs: Date.now() - started };
  }

  async function emergencyAction({ path, body, idempotencyKey }) {
    const started = Date.now();
    const res = await requestJson({
      method: "POST",
      path,
      write: true,
      idempotencyKey,
      body
    });
    return { res, durationMs: Date.now() - started };
  }

  async function listEmergencyState({ scopeType = null, scopeId = null, controlType = null } = {}) {
    const params = new URLSearchParams();
    params.set("active", "true");
    params.set("limit", "200");
    if (scopeType) params.set("scopeType", scopeType);
    if (scopeId) params.set("scopeId", scopeId);
    if (controlType) params.set("controlType", controlType);
    const out = await requestJson({ method: "GET", path: `/ops/emergency/state?${params.toString()}` });
    return Array.isArray(out?.json?.controls) ? out.json.controls : [];
  }

  const checks = [];
  const snapshots = {};
  let failure = null;

  function pushCheck(id, ok, details = null) {
    checks.push({
      id,
      ok: ok === true,
      details
    });
  }

  try {
    const health = await requestJson({ method: "GET", path: "/healthz" });
    pushCheck("api_healthy", health?.json?.ok === true, { statusCode: health.statusCode });

    const primarySigner = await registerSigner({ description: `${runId} primary` });
    const secondarySigner = await registerSigner({ description: `${runId} secondary` });
    const compromisedSigner = await registerSigner({ description: `${runId} compromised` });
    snapshots.signers = {
      primarySignerKeyId: primarySigner.keyId,
      secondarySignerKeyId: secondarySigner.keyId,
      compromisedSignerKeyId: compromisedSigner.keyId
    };

    const revokeSigner = await revokeSignerKey({ keyId: compromisedSigner.keyId });
    snapshots.revokeSigner = revokeSigner.res?.json ?? null;
    pushCheck("compromised_signer_revoked_within_target", revokeSigner.durationMs <= signerRevocationTargetMs, {
      durationMs: revokeSigner.durationMs,
      targetMs: signerRevocationTargetMs
    });

    const rejectedCompromisedSignerAttempt = await requestJson({
      method: "POST",
      path: "/ops/emergency/pause",
      write: true,
      idempotencyKey: `${runId}_revoked_signer_pause_attempt`,
      body: {
        reasonCode: "OPS_SIGNER_COMPROMISED",
        reason: `${runId}:revoked_signer_attempt`,
        operatorAction: buildSignedOperatorAction({
          signer: compromisedSigner,
          operatorId: "op_compromised",
          role: "oncall",
          caseIdPrefix: "revoked_signer_attempt"
        })
      }
    }).catch((err) => err);
    pushCheck(
      "revoked_signer_cannot_trigger_emergency_control",
      rejectedCompromisedSignerAttempt instanceof Error &&
        rejectedCompromisedSignerAttempt.statusCode === 409 &&
        String(rejectedCompromisedSignerAttempt?.details?.code ?? "") === "OPERATOR_ACTION_SIGNER_REVOKED",
      {
        statusCode:
          rejectedCompromisedSignerAttempt instanceof Error ? rejectedCompromisedSignerAttempt.statusCode ?? null : null,
        code: rejectedCompromisedSignerAttempt instanceof Error ? rejectedCompromisedSignerAttempt?.details?.code ?? null : null
      }
    );

    const compromisedAgentId = `agt_compromised_${runId}`;
    const compromisedAgentContainment = await emergencyAction({
      path: "/ops/emergency/revoke",
      idempotencyKey: `${runId}_agent_revoke`,
      body: {
        scope: { type: "agent", id: compromisedAgentId },
        reasonCode: "OPS_AGENT_COMPROMISED",
        reason: `${runId}:agent_containment`,
        operatorAction: buildSignedOperatorAction({
          signer: primarySigner,
          operatorId: "op_incident_commander",
          role: "incident_commander",
          caseIdPrefix: "agent_containment_primary"
        }),
        secondOperatorAction: buildSignedOperatorAction({
          signer: secondarySigner,
          operatorId: "op_ops_admin",
          role: "ops_admin",
          caseIdPrefix: "agent_containment_secondary"
        })
      }
    });
    snapshots.compromisedAgentContainment = compromisedAgentContainment.res?.json ?? null;
    pushCheck("agent_containment_within_target", compromisedAgentContainment.durationMs <= containmentTargetMs, {
      durationMs: compromisedAgentContainment.durationMs,
      targetMs: containmentTargetMs
    });

    const agentRevokeState = await listEmergencyState({ scopeType: "agent", scopeId: compromisedAgentId, controlType: "revoke" });
    pushCheck("agent_revoke_state_active", agentRevokeState.length > 0, { count: agentRevokeState.length });

    const agentRecovery = await emergencyAction({
      path: "/ops/emergency/resume",
      idempotencyKey: `${runId}_agent_resume`,
      body: {
        scope: { type: "agent", id: compromisedAgentId },
        controlTypes: ["revoke"],
        reasonCode: "OPS_RECOVERY_COMPLETE",
        reason: `${runId}:agent_recovered`,
        operatorAction: buildSignedOperatorAction({
          signer: primarySigner,
          operatorId: "op_incident_commander",
          role: "incident_commander",
          caseIdPrefix: "agent_recovery_primary"
        }),
        secondOperatorAction: buildSignedOperatorAction({
          signer: secondarySigner,
          operatorId: "op_ops_admin",
          role: "ops_admin",
          caseIdPrefix: "agent_recovery_secondary"
        })
      }
    });
    snapshots.agentRecovery = agentRecovery.res?.json ?? null;
    pushCheck("agent_recovery_within_target", agentRecovery.durationMs <= recoveryTargetMs, {
      durationMs: agentRecovery.durationMs,
      targetMs: recoveryTargetMs
    });

    const agentStateAfterRecovery = await listEmergencyState({ scopeType: "agent", scopeId: compromisedAgentId, controlType: "revoke" });
    pushCheck("agent_revoke_state_cleared", agentStateAfterRecovery.length === 0, { count: agentStateAfterRecovery.length });

    const killSwitchContainment = await emergencyAction({
      path: "/ops/emergency/kill-switch",
      idempotencyKey: `${runId}_killswitch_on`,
      body: {
        reasonCode: "OPS_KEY_COMPROMISED",
        reason: `${runId}:tenant_killswitch_on`,
        operatorAction: buildSignedOperatorAction({
          signer: primarySigner,
          operatorId: "op_incident_commander",
          role: "incident_commander",
          caseIdPrefix: "killswitch_on_primary"
        }),
        secondOperatorAction: buildSignedOperatorAction({
          signer: secondarySigner,
          operatorId: "op_ops_admin",
          role: "ops_admin",
          caseIdPrefix: "killswitch_on_secondary"
        })
      }
    });
    snapshots.killSwitchContainment = killSwitchContainment.res?.json ?? null;
    pushCheck("killswitch_containment_within_target", killSwitchContainment.durationMs <= containmentTargetMs, {
      durationMs: killSwitchContainment.durationMs,
      targetMs: containmentTargetMs
    });

    const killSwitchState = await listEmergencyState({ scopeType: "tenant", controlType: "kill-switch" });
    pushCheck(
      "killswitch_state_active",
      killSwitchState.some((row) => String(row?.controlType ?? "").toLowerCase() === "kill-switch"),
      { count: killSwitchState.length }
    );

    const killSwitchRecovery = await emergencyAction({
      path: "/ops/emergency/resume",
      idempotencyKey: `${runId}_killswitch_off`,
      body: {
        controlTypes: ["kill-switch"],
        reasonCode: "OPS_RECOVERY_COMPLETE",
        reason: `${runId}:tenant_killswitch_off`,
        operatorAction: buildSignedOperatorAction({
          signer: primarySigner,
          operatorId: "op_incident_commander",
          role: "incident_commander",
          caseIdPrefix: "killswitch_off_primary"
        }),
        secondOperatorAction: buildSignedOperatorAction({
          signer: secondarySigner,
          operatorId: "op_ops_admin",
          role: "ops_admin",
          caseIdPrefix: "killswitch_off_secondary"
        })
      }
    });
    snapshots.killSwitchRecovery = killSwitchRecovery.res?.json ?? null;
    pushCheck("killswitch_recovery_within_target", killSwitchRecovery.durationMs <= recoveryTargetMs, {
      durationMs: killSwitchRecovery.durationMs,
      targetMs: recoveryTargetMs
    });

    const killSwitchStateAfterRecovery = await listEmergencyState({ scopeType: "tenant", controlType: "kill-switch" });
    pushCheck("killswitch_state_cleared", killSwitchStateAfterRecovery.length === 0, { count: killSwitchStateAfterRecovery.length });

    const exportA = await requestJson({ method: "GET", path: "/ops/audit/export?domain=governance&limit=500" });
    const exportB = await requestJson({ method: "GET", path: "/ops/audit/export?domain=governance&limit=500" });
    snapshots.auditExport = {
      exportHashA: exportA?.json?.export?.exportHash ?? null,
      exportHashB: exportB?.json?.export?.exportHash ?? null,
      rowChainHeadHashA: exportA?.json?.export?.rowChainHeadHash ?? null,
      rowChainHeadHashB: exportB?.json?.export?.rowChainHeadHash ?? null
    };
    const rowsA = Array.isArray(exportA?.json?.export?.rows) ? exportA.json.export.rows : [];
    const rowsB = Array.isArray(exportB?.json?.export?.rows) ? exportB.json.export.rows : [];
    pushCheck(
      "governance_audit_export_deterministic",
      exportA?.json?.export?.exportHash === exportB?.json?.export?.exportHash && JSON.stringify(rowsA) === JSON.stringify(rowsB),
      {
        exportHashA: exportA?.json?.export?.exportHash ?? null,
        exportHashB: exportB?.json?.export?.exportHash ?? null,
        countA: rowsA.length,
        countB: rowsB.length
      }
    );

    const actions = new Set(rowsA.map((row) => String(row?.action ?? "")));
    const requiredActions = [
      "SIGNER_KEY_REVOKE",
      "EMERGENCY_CONTROL_REVOKE",
      "EMERGENCY_CONTROL_KILL_SWITCH",
      "EMERGENCY_CONTROL_RESUME"
    ];
    const missingActions = requiredActions.filter((action) => !actions.has(action));
    pushCheck("containment_actions_recorded_in_immutable_audit", missingActions.length === 0, {
      missingActions
    });
  } catch (err) {
    failure = toFailureSummary(err);
  }

  const passedChecks = checks.filter((check) => check.ok === true).length;
  const requiredChecks = checks.length;
  const ok = failure === null && passedChecks === requiredChecks;
  const report = {
    schemaVersion: "EmergencyContainmentDrillReport.v1",
    generatedAt: new Date().toISOString(),
    runConfig,
    durationMs: Date.now() - startedAt,
    checks,
    snapshots,
    failure,
    verdict: {
      ok,
      requiredChecks,
      passedChecks
    }
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`wrote emergency containment drill report: ${reportPath}\n`);

  if (!ok) {
    process.exitCode = 1;
  }
}

main().catch(async (err) => {
  const reportPath = resolveReportPath(process.cwd(), process.env);
  await writeFailureReport({ reportPath, runConfig: null, error: err });
  process.exitCode = 1;
});
