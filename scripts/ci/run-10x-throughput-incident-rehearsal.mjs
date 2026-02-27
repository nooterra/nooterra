#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

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

function makePolicyPayload({ policyId, policyVersion, amberReleaseRatePct, description }) {
  return {
    policyId,
    policyVersion,
    verificationMethod: {
      mode: "deterministic",
      source: "verifier://nooterra-verify"
    },
    policy: {
      mode: "automatic",
      rules: {
        requireDeterministicVerification: true,
        autoReleaseOnGreen: true,
        autoReleaseOnAmber: false,
        autoReleaseOnRed: false,
        greenReleaseRatePct: 100,
        amberReleaseRatePct,
        redReleaseRatePct: 0
      }
    },
    description
  };
}

function resolveIncidentReportPath(cwd = process.cwd(), env = process.env) {
  return resolve(
    cwd,
    env.THROUGHPUT_INCIDENT_REHEARSAL_REPORT_PATH || "artifacts/throughput/10x-incident-rehearsal-summary.json"
  );
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
    schemaVersion: "ThroughputIncidentRehearsalReport.v1",
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
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  process.stdout.write(`wrote throughput incident rehearsal report: ${reportPath}\n`);
}

async function main() {
  const startedAt = Date.now();
  const baseUrl = normalizeBaseUrl(process.env.BASE_URL);
  const opsToken = typeof process.env.OPS_TOKEN === "string" ? process.env.OPS_TOKEN.trim() : "";
  if (!opsToken) throw new Error("OPS_TOKEN is required");
  const tenantId =
    typeof process.env.TENANT_ID === "string" && process.env.TENANT_ID.trim() !== ""
      ? process.env.TENANT_ID.trim()
      : "tenant_default";
  const timeoutMs = parseIntEnv("HTTP_TIMEOUT_MS", 10_000, { min: 1000, max: 120_000 });
  const protocolVersion =
    typeof process.env.NOOTERRA_PROTOCOL === "string" && process.env.NOOTERRA_PROTOCOL.trim() !== ""
      ? process.env.NOOTERRA_PROTOCOL.trim()
      : "1.0";
  const reportPath = resolveIncidentReportPath(process.cwd(), process.env);
  const policyId =
    typeof process.env.INCIDENT_REHEARSAL_POLICY_ID === "string" && process.env.INCIDENT_REHEARSAL_POLICY_ID.trim() !== ""
      ? process.env.INCIDENT_REHEARSAL_POLICY_ID.trim()
      : "market.incident.rehearsal.v1";

  const rehearsalId = `inc_rh_${Date.now()}`;
  const noteDegraded = `${rehearsalId}:comms:announce_degraded_mode`;
  const noteRollback = `${rehearsalId}:comms:announce_rollback_complete`;

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
      const details =
        json && typeof json === "object"
          ? json
          : {
              body: text
            };
      const err = new Error(`${method} ${path} failed (${response.status})`);
      err.statusCode = response.status;
      err.details = details;
      throw err;
    }
    return {
      statusCode: response.status,
      json
    };
  }

  async function getPolicyState() {
    const res = await requestJson({
      method: "GET",
      path: `/ops/settlement-policies/state?policyId=${encodeURIComponent(policyId)}`
    });
    return res.json ?? {};
  }

  async function ensurePolicyVersion({ policyVersion, amberReleaseRatePct, description }) {
    const state = await getPolicyState();
    const policies = Array.isArray(state?.policies) ? state.policies : [];
    const existing = policies.find(
      (row) =>
        String(row?.policyId ?? "") === policyId &&
        Number(row?.policyVersion ?? -1) === Number(policyVersion)
    );
    if (existing) return existing;
    const created = await requestJson({
      method: "POST",
      path: "/marketplace/settlement-policies",
      write: true,
      idempotencyKey: `${rehearsalId}_policy_${policyVersion}`,
      body: makePolicyPayload({
        policyId,
        policyVersion,
        amberReleaseRatePct,
        description
      })
    });
    return created?.json?.policy ?? null;
  }

  function activeVersionFromState(state) {
    return Number(state?.rollout?.stages?.active?.policyVersion ?? NaN);
  }

  const checks = [];
  const snapshots = {};
  let failure = null;

  try {
    const health = await requestJson({ method: "GET", path: "/healthz" });
    checks.push({
      id: "api_healthy",
      ok: health?.json?.ok === true,
      details: health?.json ?? null
    });

    await ensurePolicyVersion({
      policyVersion: 1,
      amberReleaseRatePct: 10,
      description: "incident rehearsal degraded policy"
    });
    await ensurePolicyVersion({
      policyVersion: 2,
      amberReleaseRatePct: 30,
      description: "incident rehearsal stable policy"
    });

    const stateBefore = await getPolicyState();
    snapshots.stateBefore = stateBefore;
    const stateBeforeActive = activeVersionFromState(stateBefore);
    if (stateBeforeActive !== 2) {
      await requestJson({
        method: "POST",
        path: "/ops/settlement-policies/rollout",
        write: true,
        idempotencyKey: `${rehearsalId}_baseline_rollout`,
        body: {
          stage: "active",
          policyRef: { policyId, policyVersion: 2 },
          note: `${rehearsalId}:baseline_stable`
        }
      });
    }

    const degradedSignal = await requestJson({
      method: "GET",
      path:
        "/ops/network/command-center?windowHours=24&disputeSlaHours=1&emitAlerts=true&persistAlerts=true" +
        "&httpClientErrorRateThresholdPct=0&httpServerErrorRateThresholdPct=0&deliveryDlqThreshold=0" +
        "&disputeOverSlaThreshold=0&determinismRejectThreshold=0&kernelVerificationErrorThreshold=0"
    });
    snapshots.degradedSignal = degradedSignal?.json ?? null;
    const degradedBreachCount = Number(degradedSignal?.json?.alerts?.breachCount ?? 0);
    checks.push({
      id: "degraded_mode_alert_signal_emitted",
      ok: degradedBreachCount > 0,
      details: {
        breachCount: degradedBreachCount,
        emittedCount: Number(degradedSignal?.json?.alerts?.emittedCount ?? 0)
      }
    });

    const degradedRollout = await requestJson({
      method: "POST",
      path: "/ops/settlement-policies/rollout",
      write: true,
      idempotencyKey: `${rehearsalId}_degraded_rollout`,
      body: {
        stage: "active",
        policyRef: { policyId, policyVersion: 1 },
        note: noteDegraded
      }
    });
    snapshots.degradedRollout = degradedRollout?.json ?? null;

    const stateDegraded = await getPolicyState();
    snapshots.stateDegraded = stateDegraded;
    const degradedActiveVersion = activeVersionFromState(stateDegraded);
    checks.push({
      id: "degraded_policy_activated",
      ok: degradedActiveVersion === 1,
      details: {
        activePolicyVersion: Number.isFinite(degradedActiveVersion) ? degradedActiveVersion : null
      }
    });

    const rollback = await requestJson({
      method: "POST",
      path: "/ops/settlement-policies/rollback",
      write: true,
      idempotencyKey: `${rehearsalId}_rollback`,
      body: {
        note: noteRollback
      }
    });
    snapshots.rollback = rollback?.json ?? null;

    const stateRecovered = await getPolicyState();
    snapshots.stateRecovered = stateRecovered;
    const recoveredActiveVersion = activeVersionFromState(stateRecovered);
    checks.push({
      id: "rollback_restores_stable_policy",
      ok: recoveredActiveVersion === 2,
      details: {
        activePolicyVersion: Number.isFinite(recoveredActiveVersion) ? recoveredActiveVersion : null
      }
    });

    const postRunCommandCenter = await requestJson({
      method: "GET",
      path: "/ops/network/command-center?windowHours=24&disputeSlaHours=1&emitAlerts=true"
    });
    snapshots.postRunCommandCenter = postRunCommandCenter?.json ?? null;
    const postRunBreachCount = Number(postRunCommandCenter?.json?.alerts?.breachCount ?? 0);
    checks.push({
      id: "post_rollback_command_center_clear",
      ok: postRunBreachCount === 0,
      details: {
        breachCount: postRunBreachCount
      }
    });

    const audits = await requestJson({ method: "GET", path: "/ops/audit?limit=200" });
    const rows = Array.isArray(audits?.json?.audit) ? audits.json.audit : [];
    const noteSet = new Set(
      rows
        .map((row) => (typeof row?.details?.note === "string" ? row.details.note : ""))
        .filter(Boolean)
    );
    const hasDegradedCommsAudit = noteSet.has(noteDegraded);
    const hasRollbackCommsAudit = noteSet.has(noteRollback);
    checks.push({
      id: "communications_drill_audited",
      ok: hasDegradedCommsAudit && hasRollbackCommsAudit,
      details: {
        hasDegradedCommsAudit,
        hasRollbackCommsAudit
      }
    });
  } catch (err) {
    failure = {
      message: err?.message ?? String(err),
      statusCode: Number.isSafeInteger(err?.statusCode) ? err.statusCode : null,
      details: err?.details ?? null
    };
  }

  const ok = failure === null && checks.every((check) => check.ok === true);
  const report = {
    schemaVersion: "ThroughputIncidentRehearsalReport.v1",
    generatedAt: new Date().toISOString(),
    runConfig: {
      rehearsalId,
      baseUrl,
      tenantId,
      policyId,
      protocolVersion,
      timeoutMs
    },
    durationMs: Date.now() - startedAt,
    checks,
    snapshots,
    failure,
    verdict: {
      ok,
      requiredChecks: checks.length,
      passedChecks: checks.filter((check) => check.ok === true).length
    }
  };

  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  process.stdout.write(`wrote throughput incident rehearsal report: ${reportPath}\n`);
  if (!ok) process.exitCode = 1;
}

main().catch((err) => {
  const reportPath = resolveIncidentReportPath(process.cwd(), process.env);
  writeFailureReport({
    reportPath,
    runConfig: null,
    error: err
  })
    .catch((writeErr) => {
      process.stderr.write(`${writeErr?.stack || writeErr?.message || String(writeErr)}\n`);
    })
    .finally(() => {
      process.stderr.write(`${err?.stack || err?.message || String(err)}\n`);
      process.exit(1);
    });
});
