#!/usr/bin/env node
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { bootstrapLocalGateEnv } from "../ci/local-bootstrap.mjs";

import { canonicalJsonStringify } from "../../src/core/canonical-json.js";
import { createEd25519Keypair, sha256Hex, signHashHexEd25519, verifyHashHexEd25519 } from "../../src/core/crypto.js";
import { buildCapabilityAttestationV1, computeCapabilityAttestationSignaturePayloadHashV1 } from "../../src/core/capability-attestation.js";

const TRIAL_SCHEMA_VERSION = "CapabilityTrial.v1";
const REPORT_SCHEMA_VERSION = "CapabilityTrialRunReport.v1";

const TRIALS = Object.freeze([
  {
    schemaVersion: TRIAL_SCHEMA_VERSION,
    trialId: "work_order_worker_protocol.v1",
    displayName: "Work Order Worker Protocol",
    capability: "code.generation",
    description: "Validates the SubAgentWorkOrder.v1 lifecycle + settlement evidence binding invariants."
  }
]);

function nowIso() {
  return new Date().toISOString();
}

function usage() {
  return [
    "usage: node scripts/trials/run-capability-trial.mjs [options]",
    "",
    "options:",
    "  --list                                  List available trials",
    "  --trial <trial-id>                      Trial id (required unless --list)",
    "  --out <file>                            Report output path (default: artifacts/trials/<trial-id>.json)",
    "  --bootstrap-local                       Bootstrap local API + temporary API key (local only)",
    "  --bootstrap-base-url <url>              Bootstrap base URL (default: SETTLD_BASE_URL or http://127.0.0.1:3000)",
    "  --bootstrap-tenant-id <id>              Bootstrap tenant id (default: SETTLD_TENANT_ID or tenant_default)",
    "  --bootstrap-ops-token <tok>             Bootstrap ops token (default: PROXY_OPS_TOKEN or tok_ops)",
    "  --base-url <url>                        Settld API base URL (default: SETTLD_BASE_URL)",
    "  --tenant-id <id>                        Tenant id (default: SETTLD_TENANT_ID or tenant_default)",
    "  --api-key <key>                         API key (default: SETTLD_API_KEY)",
    "  --principal-agent-id <id>               Principal (manager) agentId (default: agt_trial_principal_1)",
    "  --worker-agent-id <id>                  Worker agentId (default: agt_trial_worker_1)",
    "  --attestor-agent-id <id>                Attestor issuer agentId (default: agt_trial_attestor_1)",
    "  --attestor-private-key-file <path>      Ed25519 private key PEM for attestor (optional; required when not auto-registering)",
    "  --no-auto-register                      Do not auto-register missing agents (default: auto when --bootstrap-local)",
    "  --no-issue-attestation                  Do not issue a capability attestation after a successful trial",
    "  --help                                  Show help"
  ].join("\n");
}

function normalizeNonEmptyString(value) {
  const text = String(value ?? "").trim();
  return text ? text : "";
}

function getTrial(trialId) {
  const wanted = normalizeNonEmptyString(trialId);
  if (!wanted) return null;
  return TRIALS.find((t) => t.trialId === wanted) ?? null;
}

export function parseArgs(argv, env = process.env, cwd = process.cwd()) {
  const out = {
    list: false,
    trialId: "",
    out: "",
    help: false,
    bootstrapLocal: false,
    bootstrapBaseUrl: normalizeNonEmptyString(env?.SETTLD_BASE_URL ?? "http://127.0.0.1:3000"),
    bootstrapTenantId: normalizeNonEmptyString(env?.SETTLD_TENANT_ID ?? "tenant_default"),
    bootstrapOpsToken: normalizeNonEmptyString(env?.PROXY_OPS_TOKEN ?? "tok_ops"),
    baseUrl: normalizeNonEmptyString(env?.SETTLD_BASE_URL ?? ""),
    tenantId: normalizeNonEmptyString(env?.SETTLD_TENANT_ID ?? "tenant_default"),
    apiKey: normalizeNonEmptyString(env?.SETTLD_API_KEY ?? ""),
    principalAgentId: "agt_trial_principal_1",
    workerAgentId: "agt_trial_worker_1",
    attestorAgentId: "agt_trial_attestor_1",
    attestorPrivateKeyFile: "",
    autoRegister: false,
    issueAttestation: true,
    cwd
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] ?? "").trim();
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`missing value for ${arg}`);
      return String(argv[i] ?? "").trim();
    };
    if (!arg) continue;
    if (!arg.startsWith("-") && !out.trialId && !out.list) {
      out.trialId = arg;
      continue;
    }
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--list") out.list = true;
    else if (arg === "--trial") out.trialId = next();
    else if (arg.startsWith("--trial=")) out.trialId = arg.slice("--trial=".length).trim();
    else if (arg === "--out") out.out = path.resolve(cwd, next());
    else if (arg.startsWith("--out=")) out.out = path.resolve(cwd, arg.slice("--out=".length).trim());
    else if (arg === "--bootstrap-local") out.bootstrapLocal = true;
    else if (arg === "--bootstrap-base-url") out.bootstrapBaseUrl = next();
    else if (arg.startsWith("--bootstrap-base-url=")) out.bootstrapBaseUrl = arg.slice("--bootstrap-base-url=".length).trim();
    else if (arg === "--bootstrap-tenant-id") out.bootstrapTenantId = next();
    else if (arg.startsWith("--bootstrap-tenant-id=")) out.bootstrapTenantId = arg.slice("--bootstrap-tenant-id=".length).trim();
    else if (arg === "--bootstrap-ops-token") out.bootstrapOpsToken = next();
    else if (arg.startsWith("--bootstrap-ops-token=")) out.bootstrapOpsToken = arg.slice("--bootstrap-ops-token=".length).trim();
    else if (arg === "--base-url") out.baseUrl = next();
    else if (arg.startsWith("--base-url=")) out.baseUrl = arg.slice("--base-url=".length).trim();
    else if (arg === "--tenant-id") out.tenantId = next();
    else if (arg.startsWith("--tenant-id=")) out.tenantId = arg.slice("--tenant-id=".length).trim();
    else if (arg === "--api-key") out.apiKey = next();
    else if (arg.startsWith("--api-key=")) out.apiKey = arg.slice("--api-key=".length).trim();
    else if (arg === "--principal-agent-id") out.principalAgentId = next();
    else if (arg.startsWith("--principal-agent-id=")) out.principalAgentId = arg.slice("--principal-agent-id=".length).trim();
    else if (arg === "--worker-agent-id") out.workerAgentId = next();
    else if (arg.startsWith("--worker-agent-id=")) out.workerAgentId = arg.slice("--worker-agent-id=".length).trim();
    else if (arg === "--attestor-agent-id") out.attestorAgentId = next();
    else if (arg.startsWith("--attestor-agent-id=")) out.attestorAgentId = arg.slice("--attestor-agent-id=".length).trim();
    else if (arg === "--attestor-private-key-file") out.attestorPrivateKeyFile = next();
    else if (arg.startsWith("--attestor-private-key-file=")) out.attestorPrivateKeyFile = arg.slice("--attestor-private-key-file=".length).trim();
    else if (arg === "--no-auto-register") out.autoRegister = false;
    else if (arg === "--no-issue-attestation") out.issueAttestation = false;
    else throw new Error(`unknown argument: ${arg}`);
  }

  if (out.bootstrapLocal) out.autoRegister = true;

  if (out.list || out.help) {
    out.out = out.out || path.resolve(cwd, "artifacts/trials/trials.json");
    return out;
  }

  const trial = getTrial(out.trialId);
  if (!trial) throw new Error(`unknown --trial: ${out.trialId || "(missing)"}`);

  if (!out.out) {
    out.out = path.resolve(cwd, `artifacts/trials/${trial.trialId}.json`);
  }

  if (!out.bootstrapLocal) {
    if (!out.baseUrl) throw new Error("--base-url (or SETTLD_BASE_URL) is required unless --bootstrap-local is used");
    if (!out.apiKey) throw new Error("--api-key (or SETTLD_API_KEY) is required unless --bootstrap-local is used");
  }

  return out;
}

async function requestJson(url, { method = "GET", headers = {}, body = null } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      ...(body === null ? {} : { "content-type": "application/json" }),
      ...headers
    },
    body: body === null ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: response.ok, statusCode: response.status, text, json };
}

function makeAuthHeaders({ tenantId, apiKey, extraHeaders = {} } = {}) {
  const t = normalizeNonEmptyString(tenantId);
  const k = normalizeNonEmptyString(apiKey);
  return {
    ...(t ? { "x-proxy-tenant-id": t } : {}),
    ...(k ? { authorization: `Bearer ${k}` } : {}),
    ...extraHeaders
  };
}

async function getAgentIdentity({ baseUrl, tenantId, apiKey, agentId }) {
  const resp = await requestJson(new URL(`/agents/${encodeURIComponent(agentId)}`, baseUrl).toString(), {
    method: "GET",
    headers: makeAuthHeaders({ tenantId, apiKey })
  });
  if (resp.statusCode === 404) return null;
  if (!resp.ok) {
    throw new Error(`GET /agents/${agentId} failed (HTTP ${resp.statusCode}): ${resp.text}`);
  }
  return resp.json?.agentIdentity ?? null;
}

async function registerAgent({ baseUrl, tenantId, apiKey, agentId, displayName, capabilities, publicKeyPem }) {
  const resp = await requestJson(new URL("/agents/register", baseUrl).toString(), {
    method: "POST",
    headers: makeAuthHeaders({
      tenantId,
      apiKey,
      extraHeaders: { "x-idempotency-key": `trial_agent_register_${agentId}` }
    }),
    body: {
      agentId,
      displayName,
      owner: { ownerType: "service", ownerId: `tenant:${tenantId}` },
      publicKeyPem,
      capabilities
    }
  });
  if (!resp.ok) {
    throw new Error(`POST /agents/register failed (HTTP ${resp.statusCode}): ${resp.text}`);
  }
  return resp.json?.agentIdentity ?? null;
}

async function ensureAgent({
  baseUrl,
  tenantId,
  apiKey,
  agentId,
  displayName,
  capabilities,
  autoRegister,
  keypair = null
} = {}) {
  const existing = await getAgentIdentity({ baseUrl, tenantId, apiKey, agentId });
  if (existing) {
    // Fail-closed if required capabilities are missing.
    const caps = Array.isArray(existing?.capabilities) ? existing.capabilities : [];
    for (const required of capabilities) {
      if (!caps.includes(required)) {
        throw new Error(`agent ${agentId} missing required capability: ${required}`);
      }
    }
    return { agentIdentity: existing, keypair: null };
  }
  if (!autoRegister) {
    throw new Error(`agent identity not found: ${agentId} (register it or rerun with --bootstrap-local)`);
  }

  const kp = keypair ?? createEd25519Keypair();
  const agentIdentity = await registerAgent({
    baseUrl,
    tenantId,
    apiKey,
    agentId,
    displayName,
    capabilities,
    publicKeyPem: kp.publicKeyPem
  });
  return { agentIdentity, keypair: kp };
}

export function computeDeterministicTrialReportHash({ trial, subjectAgentId, ok, checks, issuedAttestationId = null } = {}) {
  const stable = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    trialId: trial?.trialId ?? null,
    subjectAgentId: subjectAgentId ?? null,
    ok: ok === true,
    checks: Array.isArray(checks)
      ? checks.map((check) => ({
          id: check?.id ?? null,
          ok: check?.ok === true,
          code: check?.code ?? null
        }))
      : [],
    issuedAttestationId
  };
  return sha256Hex(canonicalJsonStringify(stable));
}

async function upsertCapabilityAttestation({
  baseUrl,
  tenantId,
  apiKey,
  trial,
  reportHash,
  attestationId,
  subjectAgentId,
  issuerAgentId,
  issuerKeyId,
  issuerPrivateKeyPem,
  level = "attested"
} = {}) {
  const validity = {
    issuedAt: "2026-02-23T00:00:00.000Z",
    notBefore: "2026-02-23T00:00:00.000Z",
    expiresAt: "2027-02-23T00:00:00.000Z"
  };
  const verificationMethod = {
    mode: "capability_trial",
    trialId: trial.trialId,
    reportHash
  };
  const evidenceRefs = [`report://capability_trial/${reportHash}`];

  const preview = buildCapabilityAttestationV1({
    attestationId,
    tenantId,
    subjectAgentId,
    capability: trial.capability,
    level,
    issuerAgentId,
    validity,
    signature: { algorithm: "ed25519", keyId: issuerKeyId, signature: "sig_preview" },
    verificationMethod,
    evidenceRefs,
    createdAt: "2026-02-23T00:00:00.000Z"
  });
  const payloadHashHex = computeCapabilityAttestationSignaturePayloadHashV1(preview);
  const signatureBase64 = signHashHexEd25519(payloadHashHex, issuerPrivateKeyPem);

  const resp = await requestJson(new URL("/capability-attestations", baseUrl).toString(), {
    method: "POST",
    headers: makeAuthHeaders({
      tenantId,
      apiKey,
      extraHeaders: { "x-idempotency-key": `trial_capability_attest_${attestationId}` }
    }),
    body: {
      attestationId,
      subjectAgentId,
      capability: trial.capability,
      level,
      issuerAgentId,
      validity,
      signature: {
        algorithm: "ed25519",
        keyId: issuerKeyId,
        signature: signatureBase64
      },
      verificationMethod,
      evidenceRefs
    }
  });
  if (!resp.ok) {
    throw new Error(`POST /capability-attestations failed (HTTP ${resp.statusCode}): ${resp.text}`);
  }
  return resp.json?.capabilityAttestation ?? null;
}

async function upsertAgentCard({ baseUrl, tenantId, apiKey, agentId, displayName, capabilities, visibility = "public" } = {}) {
  const resp = await requestJson(new URL("/agent-cards", baseUrl).toString(), {
    method: "POST",
    headers: makeAuthHeaders({ tenantId, apiKey, extraHeaders: { "x-idempotency-key": `trial_agent_card_${agentId}` } }),
    body: {
      agentId,
      displayName,
      capabilities,
      visibility,
      host: { runtime: "openclaw", endpoint: `https://example.invalid/${agentId}`, protocols: ["mcp"] }
    }
  });
  if (!resp.ok) {
    throw new Error(`POST /agent-cards failed (HTTP ${resp.statusCode}): ${resp.text}`);
  }
  return resp.json?.agentCard ?? null;
}

async function discoverAgentCardWithAttestation({
  baseUrl,
  tenantId,
  apiKey,
  capability,
  issuerAgentId,
  minLevel = "attested"
} = {}) {
  const url = new URL("/agent-cards/discover", baseUrl);
  url.searchParams.set("capability", capability);
  url.searchParams.set("visibility", "public");
  url.searchParams.set("runtime", "openclaw");
  url.searchParams.set("status", "active");
  url.searchParams.set("includeReputation", "false");
  url.searchParams.set("requireCapabilityAttestation", "true");
  url.searchParams.set("attestationMinLevel", minLevel);
  url.searchParams.set("attestationIssuerAgentId", issuerAgentId);
  url.searchParams.set("includeAttestationMetadata", "true");
  url.searchParams.set("limit", "10");
  url.searchParams.set("offset", "0");

  const resp = await requestJson(url.toString(), {
    method: "GET",
    headers: makeAuthHeaders({ tenantId, apiKey })
  });
  if (!resp.ok) throw new Error(`GET /agent-cards/discover failed (HTTP ${resp.statusCode}): ${resp.text}`);
  return resp.json ?? null;
}

async function runWorkOrderWorkerTrial({
  baseUrl,
  tenantId,
  apiKey,
  trial,
  principalAgentId,
  workerAgentId,
  attestorAgentId,
  autoRegister,
  issueAttestation,
  attestorPrivateKeyPem
} = {}) {
  const checks = [];
  const blockingIssues = [];

  function pushCheck(row) {
    checks.push(row);
    if (!row.ok) blockingIssues.push({ id: row.id, message: row.message ?? "check failed", code: row.code ?? null });
  }

  let attestorKeypair = null;
  let attestorIdentity = null;
  let attestorPrivateKey = attestorPrivateKeyPem ?? null;

  // 1) Ensure identities exist (and are capability-declared).
  try {
    await ensureAgent({
      baseUrl,
      tenantId,
      apiKey,
      agentId: principalAgentId,
      displayName: "Trial Principal",
      capabilities: ["orchestration"],
      autoRegister
    });
    await ensureAgent({
      baseUrl,
      tenantId,
      apiKey,
      agentId: workerAgentId,
      displayName: "Trial Worker",
      capabilities: [trial.capability],
      autoRegister
    });
    const autoRegisterAttestor = autoRegister && !attestorPrivateKey;
    const ensuredAttestor = await ensureAgent({
      baseUrl,
      tenantId,
      apiKey,
      agentId: attestorAgentId,
      displayName: "Trial Attestor",
      capabilities: ["attestation.issue"],
      autoRegister: autoRegisterAttestor,
      keypair: autoRegisterAttestor ? createEd25519Keypair() : null
    });
    attestorKeypair = ensuredAttestor.keypair;
    attestorIdentity = ensuredAttestor.agentIdentity;
    if (!attestorPrivateKey && attestorKeypair?.privateKeyPem) attestorPrivateKey = attestorKeypair.privateKeyPem;

    pushCheck({ id: "ensure_identities", ok: true });
  } catch (err) {
    pushCheck({ id: "ensure_identities", ok: false, code: "IDENTITIES_MISSING", message: err?.message ?? String(err) });
    return { ok: false, checks, blockingIssues, issuedAttestation: null, reportHash: null };
  }

  // 2) DelegationGrant issue (required for realistic work order creation).
  try {
    const resp = await requestJson(new URL("/delegation-grants", baseUrl).toString(), {
      method: "POST",
      headers: makeAuthHeaders({
        tenantId,
        apiKey,
        extraHeaders: { "x-idempotency-key": "trial_dgrant_issue_1" }
      }),
      body: {
        grantId: "dgrant_trial_1",
        delegatorAgentId: principalAgentId,
        delegateeAgentId: workerAgentId,
        scope: {
          allowedProviderIds: [workerAgentId],
          allowedToolIds: ["code_generation"],
          allowedRiskClasses: ["financial"],
          sideEffectingAllowed: true
        },
        spendLimit: { currency: "USD", maxPerCallCents: 10_000, maxTotalCents: 50_000 },
        chainBinding: { depth: 0, maxDelegationDepth: 1 },
        validity: {
          issuedAt: "2026-02-23T00:00:00.000Z",
          notBefore: "2026-02-23T00:00:00.000Z",
          expiresAt: "2027-02-23T00:00:00.000Z"
        }
      }
    });
    if (!(resp.ok || resp.statusCode === 409)) {
      throw new Error(`delegation grant issue failed (HTTP ${resp.statusCode}): ${resp.text}`);
    }
    pushCheck({ id: "delegation_grant_issue", ok: true });
  } catch (err) {
    pushCheck({ id: "delegation_grant_issue", ok: false, code: "DELEGATION_GRANT_FAILED", message: err?.message ?? String(err) });
    return { ok: false, checks, blockingIssues, issuedAttestation: null, reportHash: null };
  }

  // 3) Work order lifecycle.
  let receiptHash = null;
  try {
    const created = await requestJson(new URL("/work-orders", baseUrl).toString(), {
      method: "POST",
      headers: makeAuthHeaders({ tenantId, apiKey, extraHeaders: { "x-idempotency-key": "trial_work_order_create_1" } }),
      body: {
        workOrderId: "workord_trial_1",
        principalAgentId,
        subAgentId: workerAgentId,
        requiredCapability: trial.capability,
        specification: { taskType: "codegen", language: "javascript", prompt: "Implement deterministic parser" },
        pricing: { amountCents: 450, currency: "USD", quoteId: "quote_trial_1" },
        constraints: { maxDurationSeconds: 300, maxCostCents: 450, retryLimit: 1 },
        delegationGrantRef: "dgrant_trial_1",
        metadata: { priority: "normal" }
      }
    });
    if (!created.ok) throw new Error(`work order create failed (HTTP ${created.statusCode}): ${created.text}`);

    const accepted = await requestJson(new URL("/work-orders/workord_trial_1/accept", baseUrl).toString(), {
      method: "POST",
      headers: makeAuthHeaders({ tenantId, apiKey, extraHeaders: { "x-idempotency-key": "trial_work_order_accept_1" } }),
      body: { acceptedByAgentId: workerAgentId, acceptedAt: "2026-02-23T00:10:00.000Z" }
    });
    if (!accepted.ok) throw new Error(`work order accept failed (HTTP ${accepted.statusCode}): ${accepted.text}`);

    const progressed = await requestJson(new URL("/work-orders/workord_trial_1/progress", baseUrl).toString(), {
      method: "POST",
      headers: makeAuthHeaders({ tenantId, apiKey, extraHeaders: { "x-idempotency-key": "trial_work_order_progress_1" } }),
      body: {
        progressId: "prog_trial_1",
        eventType: "progress",
        message: "Core implementation done",
        percentComplete: 60,
        evidenceRefs: ["artifact://diff/1"],
        at: "2026-02-23T00:20:00.000Z"
      }
    });
    if (!progressed.ok) throw new Error(`work order progress failed (HTTP ${progressed.statusCode}): ${progressed.text}`);

    const completed = await requestJson(new URL("/work-orders/workord_trial_1/complete", baseUrl).toString(), {
      method: "POST",
      headers: makeAuthHeaders({ tenantId, apiKey, extraHeaders: { "x-idempotency-key": "trial_work_order_complete_1" } }),
      body: {
        receiptId: "worec_trial_1",
        status: "success",
        outputs: { artifactRef: "artifact://code/1" },
        metrics: { tokensIn: 1200, tokensOut: 800 },
        evidenceRefs: ["artifact://code/1", "report://verification/1"],
        amountCents: 450,
        currency: "USD",
        deliveredAt: "2026-02-23T00:30:00.000Z",
        completedAt: "2026-02-23T00:31:00.000Z"
      }
    });
    if (!completed.ok) throw new Error(`work order complete failed (HTTP ${completed.statusCode}): ${completed.text}`);
    receiptHash = normalizeNonEmptyString(completed.json?.completionReceipt?.receiptHash);
    if (!receiptHash) throw new Error("work order completion missing receiptHash");

    const settled = await requestJson(new URL("/work-orders/workord_trial_1/settle", baseUrl).toString(), {
      method: "POST",
      headers: makeAuthHeaders({ tenantId, apiKey, extraHeaders: { "x-idempotency-key": "trial_work_order_settle_1" } }),
      body: {
        completionReceiptId: "worec_trial_1",
        completionReceiptHash: receiptHash,
        status: "released",
        x402GateId: "x402gate_trial_1",
        x402RunId: "run_trial_1",
        x402SettlementStatus: "released",
        x402ReceiptId: "x402rcpt_trial_1",
        settledAt: "2026-02-23T00:40:00.000Z"
      }
    });
    if (!settled.ok) throw new Error(`work order settle failed (HTTP ${settled.statusCode}): ${settled.text}`);
    pushCheck({ id: "work_order_lifecycle", ok: true });
  } catch (err) {
    pushCheck({ id: "work_order_lifecycle", ok: false, code: "WORK_ORDER_LIFECYCLE_FAILED", message: err?.message ?? String(err) });
    return { ok: false, checks, blockingIssues, issuedAttestation: null, reportHash: null };
  }

  // 4) Evidence binding invariants.
  try {
    const createdEvidence1 = await requestJson(new URL("/work-orders", baseUrl).toString(), {
      method: "POST",
      headers: makeAuthHeaders({ tenantId, apiKey, extraHeaders: { "x-idempotency-key": "trial_work_order_create_evidence_1" } }),
      body: {
        workOrderId: "workord_evidence_trial_1",
        principalAgentId,
        subAgentId: workerAgentId,
        requiredCapability: trial.capability,
        pricing: { amountCents: 900, currency: "USD" }
      }
    });
    if (!createdEvidence1.ok) throw new Error(`evidence work order create failed (HTTP ${createdEvidence1.statusCode}): ${createdEvidence1.text}`);

    const acceptedEvidence1 = await requestJson(new URL("/work-orders/workord_evidence_trial_1/accept", baseUrl).toString(), {
      method: "POST",
      headers: makeAuthHeaders({ tenantId, apiKey, extraHeaders: { "x-idempotency-key": "trial_work_order_accept_evidence_1" } }),
      body: { acceptedByAgentId: workerAgentId, acceptedAt: "2026-02-23T02:10:00.000Z" }
    });
    if (!acceptedEvidence1.ok) throw new Error(`evidence work order accept failed (HTTP ${acceptedEvidence1.statusCode}): ${acceptedEvidence1.text}`);

    const completedMissingEvidence = await requestJson(new URL("/work-orders/workord_evidence_trial_1/complete", baseUrl).toString(), {
      method: "POST",
      headers: makeAuthHeaders({ tenantId, apiKey, extraHeaders: { "x-idempotency-key": "trial_work_order_complete_evidence_missing_1" } }),
      body: {
        receiptId: "worec_evidence_missing_trial_1",
        status: "success",
        outputs: { artifactRef: "artifact://code/evidence/missing" },
        evidenceRefs: ["artifact://code/evidence/missing"],
        amountCents: 900,
        currency: "USD",
        deliveredAt: "2026-02-23T02:20:00.000Z",
        completedAt: "2026-02-23T02:21:00.000Z"
      }
    });
    if (!completedMissingEvidence.ok) {
      throw new Error(`evidence work order complete(missing) failed (HTTP ${completedMissingEvidence.statusCode}): ${completedMissingEvidence.text}`);
    }

    const settleMissingEvidenceBlocked = await requestJson(new URL("/work-orders/workord_evidence_trial_1/settle", baseUrl).toString(), {
      method: "POST",
      headers: makeAuthHeaders({ tenantId, apiKey, extraHeaders: { "x-idempotency-key": "trial_work_order_settle_evidence_missing_blocked_1" } }),
      body: {
        completionReceiptId: "worec_evidence_missing_trial_1",
        completionReceiptHash: completedMissingEvidence.json?.completionReceipt?.receiptHash,
        status: "released",
        x402GateId: "x402gate_evidence_missing_trial_1",
        x402RunId: "run_evidence_missing_trial_1",
        x402SettlementStatus: "released",
        x402ReceiptId: "x402rcpt_evidence_missing_trial_1",
        settledAt: "2026-02-23T02:30:00.000Z"
      }
    });
    if (settleMissingEvidenceBlocked.statusCode !== 409) {
      throw new Error(`expected 409 for missing evidence, got ${settleMissingEvidenceBlocked.statusCode}`);
    }
    if (settleMissingEvidenceBlocked.json?.code !== "WORK_ORDER_EVIDENCE_BINDING_BLOCKED") {
      throw new Error(`expected WORK_ORDER_EVIDENCE_BINDING_BLOCKED, got ${settleMissingEvidenceBlocked.json?.code ?? "(missing)"}`);
    }

    const createdEvidence2 = await requestJson(new URL("/work-orders", baseUrl).toString(), {
      method: "POST",
      headers: makeAuthHeaders({ tenantId, apiKey, extraHeaders: { "x-idempotency-key": "trial_work_order_create_evidence_2" } }),
      body: {
        workOrderId: "workord_evidence_trial_2",
        principalAgentId,
        subAgentId: workerAgentId,
        requiredCapability: trial.capability,
        pricing: { amountCents: 910, currency: "USD" }
      }
    });
    if (!createdEvidence2.ok) throw new Error(`evidence2 work order create failed (HTTP ${createdEvidence2.statusCode}): ${createdEvidence2.text}`);

    const acceptedEvidence2 = await requestJson(new URL("/work-orders/workord_evidence_trial_2/accept", baseUrl).toString(), {
      method: "POST",
      headers: makeAuthHeaders({ tenantId, apiKey, extraHeaders: { "x-idempotency-key": "trial_work_order_accept_evidence_2" } }),
      body: { acceptedByAgentId: workerAgentId, acceptedAt: "2026-02-23T03:10:00.000Z" }
    });
    if (!acceptedEvidence2.ok) throw new Error(`evidence2 work order accept failed (HTTP ${acceptedEvidence2.statusCode}): ${acceptedEvidence2.text}`);

    const completedValidEvidence = await requestJson(new URL("/work-orders/workord_evidence_trial_2/complete", baseUrl).toString(), {
      method: "POST",
      headers: makeAuthHeaders({ tenantId, apiKey, extraHeaders: { "x-idempotency-key": "trial_work_order_complete_evidence_valid_2" } }),
      body: {
        receiptId: "worec_evidence_valid_trial_2",
        status: "success",
        outputs: { artifactRef: "artifact://code/evidence/valid" },
        evidenceRefs: ["artifact://code/evidence/valid", "report://verification/evidence/valid"],
        amountCents: 910,
        currency: "USD",
        deliveredAt: "2026-02-23T03:20:00.000Z",
        completedAt: "2026-02-23T03:21:00.000Z"
      }
    });
    if (!completedValidEvidence.ok) throw new Error(`evidence2 complete failed (HTTP ${completedValidEvidence.statusCode}): ${completedValidEvidence.text}`);

    const settleMismatchBlocked = await requestJson(new URL("/work-orders/workord_evidence_trial_2/settle", baseUrl).toString(), {
      method: "POST",
      headers: makeAuthHeaders({ tenantId, apiKey, extraHeaders: { "x-idempotency-key": "trial_work_order_settle_evidence_mismatch_blocked_2" } }),
      body: {
        completionReceiptId: "worec_evidence_valid_trial_2",
        completionReceiptHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        status: "released",
        x402GateId: "x402gate_evidence_mismatch_trial_2",
        x402RunId: "run_evidence_mismatch_trial_2",
        x402SettlementStatus: "released",
        x402ReceiptId: "x402rcpt_evidence_mismatch_trial_2",
        settledAt: "2026-02-23T03:30:00.000Z"
      }
    });
    if (settleMismatchBlocked.statusCode !== 409) {
      throw new Error(`expected 409 for receipt hash mismatch, got ${settleMismatchBlocked.statusCode}`);
    }
    if (settleMismatchBlocked.json?.code !== "WORK_ORDER_EVIDENCE_BINDING_BLOCKED") {
      throw new Error(`expected WORK_ORDER_EVIDENCE_BINDING_BLOCKED, got ${settleMismatchBlocked.json?.code ?? "(missing)"}`);
    }

    const settleValid = await requestJson(new URL("/work-orders/workord_evidence_trial_2/settle", baseUrl).toString(), {
      method: "POST",
      headers: makeAuthHeaders({ tenantId, apiKey, extraHeaders: { "x-idempotency-key": "trial_work_order_settle_evidence_valid_2" } }),
      body: {
        completionReceiptId: "worec_evidence_valid_trial_2",
        completionReceiptHash: completedValidEvidence.json?.completionReceipt?.receiptHash,
        status: "released",
        x402GateId: "x402gate_evidence_valid_trial_2",
        x402RunId: "run_evidence_valid_trial_2",
        x402SettlementStatus: "released",
        x402ReceiptId: "x402rcpt_evidence_valid_trial_2",
        settledAt: "2026-02-23T03:31:00.000Z"
      }
    });
    if (!settleValid.ok) throw new Error(`expected settle valid success, got HTTP ${settleValid.statusCode}: ${settleValid.text}`);
    pushCheck({ id: "evidence_binding", ok: true });
  } catch (err) {
    pushCheck({ id: "evidence_binding", ok: false, code: "EVIDENCE_BINDING_FAILED", message: err?.message ?? String(err) });
    return { ok: false, checks, blockingIssues, issuedAttestation: null, reportHash: null };
  }

  const reportHash = computeDeterministicTrialReportHash({ trial, subjectAgentId: workerAgentId, ok: blockingIssues.length === 0, checks });

  let issuedAttestation = null;
  if (issueAttestation) {
    try {
      if (!attestorIdentity) throw new Error("attestor agent identity missing");
      const issuerKeyId = normalizeNonEmptyString(attestorIdentity?.keys?.keyId);
      const issuerPublicKeyPem = normalizeNonEmptyString(attestorIdentity?.keys?.publicKeyPem);
      if (!issuerKeyId) throw new Error("attestor keyId missing");
      if (!issuerPublicKeyPem) throw new Error("attestor publicKeyPem missing");
      if (!attestorPrivateKey) {
        throw new Error("attestor private key is required to issue an attestation (use --attestor-private-key-file or --bootstrap-local)");
      }

      // Sanity check: prove private key matches the registered public key before signing any attestations.
      const sanityHash = sha256Hex(`capability-trial-sanity:${trial.trialId}:${reportHash}`);
      const sanitySig = signHashHexEd25519(sanityHash, attestorPrivateKey);
      if (verifyHashHexEd25519({ hashHex: sanityHash, signatureBase64: sanitySig, publicKeyPem: issuerPublicKeyPem }) !== true) {
        throw new Error("attestor private key does not match registered public key");
      }

      const attestationId = `catt_trial_${workerAgentId}`;
      issuedAttestation = await upsertCapabilityAttestation({
        baseUrl,
        tenantId,
        apiKey,
        trial,
        reportHash,
        attestationId,
        subjectAgentId: workerAgentId,
        issuerAgentId: attestorAgentId,
        issuerKeyId,
        issuerPrivateKeyPem: attestorPrivateKey,
        level: "attested"
      });
      pushCheck({ id: "issue_attestation", ok: true });
    } catch (err) {
      pushCheck({ id: "issue_attestation", ok: false, code: "ATTESTATION_ISSUE_FAILED", message: err?.message ?? String(err) });
      // Keep going; the core protocol trial succeeded, but issuance failed.
    }
  } else {
    pushCheck({ id: "issue_attestation", ok: true, code: "SKIPPED" });
  }

  if (issuedAttestation && issueAttestation) {
    try {
      await upsertAgentCard({
        baseUrl,
        tenantId,
        apiKey,
        agentId: workerAgentId,
        displayName: "Trial Worker (Public)",
        capabilities: [trial.capability],
        visibility: "public"
      });
      const discovery = await discoverAgentCardWithAttestation({
        baseUrl,
        tenantId,
        apiKey,
        capability: trial.capability,
        issuerAgentId: attestorAgentId,
        minLevel: "attested"
      });
      const results = Array.isArray(discovery?.results) ? discovery.results : [];
      const found = results.some((row) => row?.agentCard?.agentId === workerAgentId);
      if (!found) throw new Error("agent card not discoverable with attestation filters");
      pushCheck({ id: "discover_with_attestation", ok: true });
    } catch (err) {
      pushCheck({ id: "discover_with_attestation", ok: false, code: "DISCOVERY_FAILED", message: err?.message ?? String(err) });
    }
  } else if (issueAttestation) {
    pushCheck({ id: "discover_with_attestation", ok: true, code: "SKIPPED" });
  }

  return { ok: blockingIssues.length === 0, checks, blockingIssues, issuedAttestation, reportHash };
}

export async function runCapabilityTrial(args, options = {}) {
  const bootstrapFn = typeof options.bootstrapFn === "function" ? options.bootstrapFn : bootstrapLocalGateEnv;
  const trial = getTrial(args.trialId);
  if (!trial) throw new Error(`unknown trial: ${args.trialId}`);

  const bootstrap = await bootstrapFn({
    enabled: args.bootstrapLocal,
    baseUrl: args.bootstrapBaseUrl,
    tenantId: args.bootstrapTenantId,
    opsToken: args.bootstrapOpsToken,
    logger: (line) => process.stderr.write(`[bootstrap] ${line}\n`)
  });

  const baseUrl = normalizeNonEmptyString(args.baseUrl || bootstrap.envPatch?.SETTLD_BASE_URL || "");
  const tenantId = normalizeNonEmptyString(args.tenantId || bootstrap.envPatch?.SETTLD_TENANT_ID || "tenant_default");
  const apiKey = normalizeNonEmptyString(args.apiKey || bootstrap.envPatch?.SETTLD_API_KEY || "");

  let attestorPrivateKeyPem = null;
  if (args.attestorPrivateKeyFile) {
    attestorPrivateKeyPem = (await readFile(path.resolve(args.cwd, args.attestorPrivateKeyFile), "utf8")).trim();
  }

  const startedAt = nowIso();
  let report;
  try {
    const result = await runWorkOrderWorkerTrial({
      baseUrl,
      tenantId,
      apiKey,
      trial,
      principalAgentId: args.principalAgentId,
      workerAgentId: args.workerAgentId,
      attestorAgentId: args.attestorAgentId,
      autoRegister: args.autoRegister,
      issueAttestation: args.issueAttestation && (args.bootstrapLocal || Boolean(attestorPrivateKeyPem)),
      attestorPrivateKeyPem
    });
    const completedAt = nowIso();
    report = {
      schemaVersion: REPORT_SCHEMA_VERSION,
      trial,
      ok: result.ok,
      startedAt,
      completedAt,
      baseUrl,
      tenantId,
      subject: { agentId: args.workerAgentId },
      principal: { agentId: args.principalAgentId },
      attestor: { agentId: args.attestorAgentId },
      reportHash: result.reportHash ?? computeDeterministicTrialReportHash({ trial, subjectAgentId: args.workerAgentId, ok: result.ok, checks: result.checks }),
      checks: result.checks,
      blockingIssues: result.blockingIssues,
      issuedAttestation: result.issuedAttestation
        ? {
            attestationId: result.issuedAttestation.attestationId,
            capability: result.issuedAttestation.capability,
            level: result.issuedAttestation.level,
            issuerAgentId: result.issuedAttestation.issuerAgentId
          }
        : null,
      bootstrap: bootstrap.metadata ?? { enabled: false }
    };
  } finally {
    await bootstrap.cleanup?.();
  }

  return { report };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (args.list) {
    process.stdout.write(`${JSON.stringify({ schemaVersion: "CapabilityTrialCatalog.v1", trials: TRIALS }, null, 2)}\n`);
    return;
  }

  const { report } = await runCapabilityTrial(args);
  await mkdir(path.dirname(args.out), { recursive: true });
  await writeFile(args.out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exit(1);
}

const isDirectExecution = (() => {
  try {
    return import.meta.url === new URL(`file://${process.argv[1]}`).href;
  } catch {
    return false;
  }
})();

if (isDirectExecution) {
  main().catch((err) => {
    process.stderr.write(`${err?.stack ?? err?.message ?? String(err)}\n`);
    process.exit(1);
  });
}
