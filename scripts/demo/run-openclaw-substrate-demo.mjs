#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createEd25519Keypair } from "../../src/core/crypto.js";

const SCHEMA_VERSION = "OpenClawSubstrateDemoReport.v1";

function nowIso() {
  return new Date().toISOString();
}

function usage() {
  return [
    "usage: node scripts/demo/run-openclaw-substrate-demo.mjs [options]",
    "",
    "options:",
    "  --out <file>   Report path (default: artifacts/demo/openclaw-substrate-demo.json)",
    "  --help         Show help",
    "",
    "required env:",
    "  NOOTERRA_BASE_URL",
    "  NOOTERRA_TENANT_ID",
    "  NOOTERRA_API_KEY"
  ].join("\n");
}

function parseArgs(argv, cwd = process.cwd()) {
  const out = {
    help: false,
    out: path.resolve(cwd, "artifacts/demo/openclaw-substrate-demo.json")
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] ?? "").trim();
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`missing value for ${arg}`);
      return String(argv[i] ?? "").trim();
    };
    if (!arg) continue;
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--out") out.out = path.resolve(cwd, next());
    else if (arg.startsWith("--out=")) out.out = path.resolve(cwd, arg.slice("--out=".length).trim());
    else throw new Error(`unknown argument: ${arg}`);
  }
  return out;
}

function assertEnv(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class JsonRpcClient {
  constructor(child) {
    this.child = child;
    this.buffer = "";
    this.pending = new Map();
    this.closed = false;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => this.#onData(chunk));
    child.on("exit", (code, signal) => {
      this.closed = true;
      const message = `MCP child exited (code=${code ?? "null"} signal=${signal ?? "null"})`;
      for (const { reject } of this.pending.values()) reject(new Error(message));
      this.pending.clear();
    });
  }

  #onData(chunk) {
    this.buffer += String(chunk ?? "");
    for (;;) {
      const idx = this.buffer.indexOf("\n");
      if (idx === -1) break;
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      const id = parsed?.id;
      if (id === undefined || id === null) continue;
      const key = String(id);
      const pending = this.pending.get(key);
      if (!pending) continue;
      this.pending.delete(key);
      pending.resolve(parsed);
    }
  }

  async call(method, params, timeoutMs = 30_000) {
    if (this.closed) throw new Error(`MCP transport closed before ${method}`);
    const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    this.child.stdin.write(`${payload}\n`);
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        }
      });
    });
  }
}

function parseToolResult(response) {
  const text = response?.result?.content?.[0]?.text ?? "";
  if (typeof text !== "string" || text.trim() === "") {
    throw new Error("tool response missing content text");
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`tool response is not JSON: ${err?.message ?? String(err)}`);
  }
}

function normalizeToolFailureMessage(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function detectToolFailure(response, parsedResult) {
  if (response?.result?.isError === true) {
    const message = normalizeToolFailureMessage(response?.result?.content?.[0]?.text) ?? "tool call failed";
    return { message };
  }

  if (!parsedResult || typeof parsedResult !== "object" || Array.isArray(parsedResult)) return null;
  const candidate =
    parsedResult?.result && typeof parsedResult.result === "object" && !Array.isArray(parsedResult.result)
      ? parsedResult.result
      : parsedResult;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;

  const hasOwn = (key) => Object.prototype.hasOwnProperty.call(candidate, key);
  const rawError = hasOwn("error") ? candidate.error : null;
  const hasError =
    rawError !== null &&
    rawError !== undefined &&
    !(typeof rawError === "string" && rawError.trim() === "");
  const statusCode =
    Number.isInteger(candidate.statusCode) ? candidate.statusCode : Number.isInteger(candidate.status) ? candidate.status : null;
  const failed = candidate.ok === false || hasError || (Number.isInteger(statusCode) && statusCode >= 400);
  if (!failed) return null;

  const rawErrorMessage =
    normalizeToolFailureMessage(rawError) ||
    (rawError && typeof rawError === "object"
      ? normalizeToolFailureMessage(rawError.message) || normalizeToolFailureMessage(rawError.error)
      : null);
  const message =
    rawErrorMessage ||
    normalizeToolFailureMessage(candidate.message) ||
    "tool call reported upstream failure";
  const code =
    normalizeToolFailureMessage(candidate.code) ||
    (rawError && typeof rawError === "object" ? normalizeToolFailureMessage(rawError.code) : null);
  return { message, code };
}

function sanitizeId(value, fallback) {
  const normalized = String(value ?? "").trim().replace(/[^A-Za-z0-9:_-]/g, "_");
  return normalized || fallback;
}

async function registerAgentIdentity({ baseUrl, tenantId, apiKey, agentId, displayName, capabilities = [] }) {
  const { publicKeyPem } = createEd25519Keypair();
  const res = await fetch(new URL("/agents/register", baseUrl), {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "x-proxy-tenant-id": tenantId,
      "x-idempotency-key": `demo_agent_register_${agentId}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      agentId,
      displayName,
      owner: { ownerType: "service", ownerId: "svc_openclaw_demo" },
      publicKeyPem,
      capabilities
    })
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`agent register failed for ${agentId}: HTTP ${res.status} ${text}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const baseUrl = assertEnv("NOOTERRA_BASE_URL");
  const tenantId = assertEnv("NOOTERRA_TENANT_ID");
  const apiKey = assertEnv("NOOTERRA_API_KEY");

  const demoSeed = `${Date.now()}`;
  const principalAgentId = sanitizeId(`agt_openclaw_demo_principal_${demoSeed}`, `agt_openclaw_demo_principal`);
  const workerAgentId = sanitizeId(`agt_openclaw_demo_worker_${demoSeed}`, `agt_openclaw_demo_worker`);
  const sessionId = sanitizeId(`sess_openclaw_demo_${demoSeed}`, "sess_openclaw_demo");
  const traceId = sanitizeId(`trace_openclaw_demo_${demoSeed}`, "trace_openclaw_demo");
  const x402ToolId = "openclaw_substrate_demo";
  const x402ProviderId = workerAgentId;
  const startedAt = nowIso();
  const transcript = [];
  let child = null;

  try {
    await registerAgentIdentity({
      baseUrl,
      tenantId,
      apiKey,
      agentId: principalAgentId,
      displayName: "OpenClaw Demo Principal",
      capabilities: ["orchestration", "travel.booking"]
    });
    await registerAgentIdentity({
      baseUrl,
      tenantId,
      apiKey,
      agentId: workerAgentId,
      displayName: "OpenClaw Demo Worker",
      capabilities: ["travel.booking.flights"]
    });

    child = spawn(process.execPath, ["scripts/mcp/nooterra-mcp-server.mjs"], {
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: ["pipe", "pipe", "inherit"]
    });
    const rpc = new JsonRpcClient(child);

    const initialize = await rpc.call("initialize", {
      protocolVersion: "2024-11-05",
      clientInfo: { name: "openclaw-substrate-demo", version: "v1" },
      capabilities: {}
    });
    transcript.push({ step: "initialize", ok: !initialize?.error, response: initialize?.error ?? initialize?.result ?? null });

    const toolsList = await rpc.call("tools/list", {});
    transcript.push({
      step: "tools_list",
      ok: !toolsList?.error,
      toolsCount: Array.isArray(toolsList?.result?.tools) ? toolsList.result.tools.length : null
    });

    async function tool(name, callArgs) {
      const response = await rpc.call("tools/call", { name, arguments: callArgs });
      if (response?.error) {
        transcript.push({ step: name, ok: false, error: response.error });
        throw new Error(`${name} failed: ${response.error?.message ?? "unknown error"}`);
      }
      const parsed = parseToolResult(response);
      const detectedFailure = detectToolFailure(response, parsed);
      transcript.push({ step: name, ok: !detectedFailure, result: parsed });
      if (detectedFailure) {
        const errorCode = detectedFailure.code ?? null;
        const details =
          parsed?.details && typeof parsed.details === "object" ? JSON.stringify(parsed.details) : null;
        throw new Error(
          `${name} failed: ${String(detectedFailure.message ?? "tool returned isError")}${
            errorCode ? ` [${errorCode}]` : ""
          }${details ? ` details=${details}` : ""}`
        );
      }
      return parsed;
    }

    const about = await tool("nooterra.about", {});
    const gateCreate = await tool("nooterra.x402_gate_create", {
      amountCents: 275,
      currency: "USD",
      payerAgentId: principalAgentId,
      payeeAgentId: workerAgentId,
      autoFundPayerCents: 5000,
      toolId: x402ToolId,
      idempotencyKey: `demo_gate_create_${demoSeed}`
    });
    const gateId =
      gateCreate?.result?.gateId ??
      gateCreate?.result?.gate?.gateId ??
      gateCreate?.gateId ??
      null;
    if (!gateId) throw new Error("x402 gate id missing from nooterra.x402_gate_create");

    const gateVerify = await tool("nooterra.x402_gate_verify", {
      gateId,
      ensureAuthorized: true,
      verificationStatus: "green",
      runStatus: "completed",
      authorizeIdempotencyKey: `demo_gate_auth_${demoSeed}`,
      idempotencyKey: `demo_gate_verify_${demoSeed}`
    });

    const gateGet = await tool("nooterra.x402_gate_get", { gateId });
    const x402RunId =
      gateGet?.result?.gate?.runId ??
      gateVerify?.result?.gate?.runId ??
      gateCreate?.result?.gate?.runId ??
      null;
    if (!x402RunId) throw new Error("x402 run id missing for work order settlement binding");

    await tool("nooterra.agent_card_upsert", {
      agentId: principalAgentId,
      displayName: "OpenClaw Demo Principal",
      capabilities: ["orchestration", "travel.booking"],
      visibility: "public",
      hostRuntime: "openclaw",
      hostProtocols: ["mcp", "json-rpc"]
    });
    await tool("nooterra.agent_card_upsert", {
      agentId: workerAgentId,
      displayName: "OpenClaw Demo Worker",
      capabilities: ["travel.booking.flights"],
      visibility: "public",
      hostRuntime: "openclaw",
      hostProtocols: ["mcp", "json-rpc"]
    });

    await tool("nooterra.session_create", {
      sessionId,
      visibility: "tenant",
      participants: [principalAgentId, workerAgentId],
      principalId: principalAgentId,
      policyRef: "policy://openclaw/substrate-demo/session-default",
      idempotencyKey: `demo_session_create_${demoSeed}`
    });
    await tool("nooterra.session_event_append", {
      sessionId,
      principalId: principalAgentId,
      eventType: "TASK_REQUESTED",
      traceId,
      payload: {
        taskId: `task_openclaw_demo_${demoSeed}`,
        requiredCapability: "travel.booking.flights",
        budgetCents: 27500
      },
      idempotencyKey: `demo_session_event_${demoSeed}`
    });

    const delegationGrant = await tool("nooterra.delegation_grant_issue", {
      grantId: `dgrant_openclaw_demo_${demoSeed}`,
      delegatorAgentId: principalAgentId,
      delegateeAgentId: workerAgentId,
      allowedRiskClasses: ["financial"],
      sideEffectingAllowed: true,
      maxPerCallCents: 1000,
      maxTotalCents: 2000,
      maxDelegationDepth: 1,
      currency: "USD",
      idempotencyKey: `demo_delegation_issue_${demoSeed}`
    });
    const delegationGrantRef =
      delegationGrant?.delegationGrant?.grantId ??
      delegationGrant?.result?.delegationGrant?.grantId ??
      `dgrant_openclaw_demo_${demoSeed}`;

    const taskQuote = await tool("nooterra.task_quote_issue", {
      quoteId: `tquote_openclaw_demo_${demoSeed}`,
      buyerAgentId: principalAgentId,
      sellerAgentId: workerAgentId,
      requiredCapability: "travel.booking.flights",
      amountCents: 275,
      currency: "USD",
      traceId,
      idempotencyKey: `demo_task_quote_${demoSeed}`
    });
    const quoteId =
      taskQuote?.taskQuote?.quoteId ??
      taskQuote?.result?.taskQuote?.quoteId ??
      `tquote_openclaw_demo_${demoSeed}`;
    const quoteHash =
      taskQuote?.taskQuote?.quoteHash ??
      taskQuote?.result?.taskQuote?.quoteHash ??
      null;
    if (!quoteHash) throw new Error("task quote hash missing from nooterra.task_quote_issue");

    const taskOffer = await tool("nooterra.task_offer_issue", {
      offerId: `toffer_openclaw_demo_${demoSeed}`,
      buyerAgentId: principalAgentId,
      sellerAgentId: workerAgentId,
      quoteId,
      quoteHash,
      amountCents: 275,
      currency: "USD",
      traceId,
      idempotencyKey: `demo_task_offer_${demoSeed}`
    });
    const offerId =
      taskOffer?.taskOffer?.offerId ??
      taskOffer?.result?.taskOffer?.offerId ??
      `toffer_openclaw_demo_${demoSeed}`;

    const taskAcceptance = await tool("nooterra.task_acceptance_issue", {
      acceptanceId: `taccept_openclaw_demo_${demoSeed}`,
      quoteId,
      offerId,
      acceptedByAgentId: principalAgentId,
      traceId,
      idempotencyKey: `demo_task_acceptance_${demoSeed}`
    });
    const acceptanceId =
      taskAcceptance?.taskAcceptance?.acceptanceId ??
      taskAcceptance?.result?.taskAcceptance?.acceptanceId ??
      `taccept_openclaw_demo_${demoSeed}`;
    const acceptanceHash =
      taskAcceptance?.taskAcceptance?.acceptanceHash ??
      taskAcceptance?.result?.taskAcceptance?.acceptanceHash ??
      null;

    const workOrderCreate = await tool("nooterra.work_order_create", {
      workOrderId: `workord_openclaw_demo_${demoSeed}`,
      principalAgentId,
      subAgentId: workerAgentId,
      requiredCapability: "travel.booking.flights",
      traceId,
      specification: {
        intent: "book cheapest direct flight under budget",
        budgetCents: 27500,
        route: "SFO->JFK"
      },
      amountCents: 275,
      currency: "USD",
      x402ToolId,
      x402ProviderId,
      delegationGrantRef,
      acceptanceRef: {
        acceptanceId,
        ...(acceptanceHash ? { acceptanceHash } : {})
      },
      idempotencyKey: `demo_workorder_create_${demoSeed}`
    });
    const workOrderId =
      workOrderCreate?.workOrder?.workOrderId ??
      workOrderCreate?.result?.workOrder?.workOrderId ??
      `workord_openclaw_demo_${demoSeed}`;

    await tool("nooterra.work_order_accept", {
      workOrderId,
      acceptedByAgentId: workerAgentId,
      idempotencyKey: `demo_workorder_accept_${demoSeed}`
    });

    await tool("nooterra.work_order_progress", {
      workOrderId,
      eventType: "progress",
      message: "queried providers and selected itinerary",
      percentComplete: 80,
      evidenceRefs: [`artifact://openclaw_demo/${demoSeed}/selection`],
      idempotencyKey: `demo_workorder_progress_${demoSeed}`
    });

    const workOrderComplete = await tool("nooterra.work_order_complete", {
      workOrderId,
      receiptId: `worec_openclaw_demo_${demoSeed}`,
      status: "success",
      outputs: { itineraryId: `itn_${demoSeed}`, provider: "demo_provider" },
      metrics: { plannerMs: 2100, providerCount: 4 },
      evidenceRefs: [
        `artifact://openclaw_demo/${demoSeed}/itinerary`,
        `sha256:${"a".repeat(64)}`,
        `verification://openclaw_demo/${demoSeed}/itinerary_check`
      ],
      traceId,
      amountCents: 275,
      currency: "USD",
      idempotencyKey: `demo_workorder_complete_${demoSeed}`
    });
    const completionReceiptId =
      workOrderComplete?.completionReceipt?.receiptId ??
      workOrderComplete?.result?.completionReceipt?.receiptId ??
      `worec_openclaw_demo_${demoSeed}`;
    const completionReceiptHash =
      workOrderComplete?.completionReceipt?.receiptHash ??
      workOrderComplete?.result?.completionReceipt?.receiptHash ??
      null;

    const workOrderSettle = await tool("nooterra.work_order_settle", {
      workOrderId,
      completionReceiptId,
      completionReceiptHash,
      status: "released",
      x402GateId: gateId,
      x402RunId,
      x402SettlementStatus: "released",
      traceId,
      idempotencyKey: `demo_workorder_settle_${demoSeed}`
    });

    const auditLineage = await tool("nooterra.audit_lineage_list", {
      traceId,
      includeSessionEvents: true,
      limit: 200,
      offset: 0,
      scanLimit: 1000
    });
    const lineageObject =
      auditLineage?.lineage ??
      auditLineage?.result?.lineage ??
      null;
    if (!lineageObject || typeof lineageObject !== "object") {
      throw new Error("audit lineage response missing lineage payload");
    }
    const demoArtifactsDir = path.dirname(args.out);
    await mkdir(demoArtifactsDir, { recursive: true });
    const lineageInputPath = path.resolve(demoArtifactsDir, `openclaw-substrate-demo-lineage-${demoSeed}.json`);
    const lineageVerificationPath = path.resolve(demoArtifactsDir, `openclaw-substrate-demo-lineage-verify-${demoSeed}.json`);
    await writeFile(lineageInputPath, `${JSON.stringify({ lineage: lineageObject }, null, 2)}\n`, "utf8");
    const verifyResult = spawnSync(
      process.execPath,
      ["scripts/ops/verify-audit-lineage.mjs", "--in", lineageInputPath, "--json-out", lineageVerificationPath],
      { cwd: process.cwd(), encoding: "utf8" }
    );
    const verifyStdout = String(verifyResult.stdout ?? "").trim();
    const verifyStderr = String(verifyResult.stderr ?? "").trim();
    const verifyStatus = Number.isInteger(verifyResult.status) ? verifyResult.status : -1;
    if (verifyStatus !== 0) {
      transcript.push({
        step: "ops.audit_lineage_verify",
        ok: false,
        exitCode: verifyStatus,
        stdout: verifyStdout || null,
        stderr: verifyStderr || null
      });
      throw new Error(
        `audit lineage verification failed (exit=${verifyStatus})${
          verifyStderr ? ` stderr=${verifyStderr}` : verifyStdout ? ` stdout=${verifyStdout}` : ""
        }`
      );
    }
    let lineageVerification = null;
    try {
      const verificationRaw = await readFile(lineageVerificationPath, "utf8");
      lineageVerification = JSON.parse(verificationRaw);
    } catch (err) {
      throw new Error(`failed to read lineage verification report: ${err?.message ?? String(err)}`);
    }
    transcript.push({
      step: "ops.audit_lineage_verify",
      ok: lineageVerification?.ok === true,
      result: lineageVerification
    });
    if (lineageVerification?.ok !== true) {
      throw new Error(`audit lineage verification report is not ok: ${lineageVerification?.code ?? "UNKNOWN"}`);
    }

    const sessionReplayPackResult = await tool("nooterra.session_replay_pack_get", { sessionId, principalId: principalAgentId });
    const sessionReplayPack =
      sessionReplayPackResult?.replayPack ??
      sessionReplayPackResult?.result?.replayPack ??
      null;
    if (!sessionReplayPack || typeof sessionReplayPack !== "object") {
      throw new Error("session replay pack payload missing");
    }
    if (sessionReplayPack?.schemaVersion !== "SessionReplayPack.v1") {
      throw new Error(`unexpected session replay pack schema: ${sessionReplayPack?.schemaVersion ?? "null"}`);
    }

    const sessionTranscriptResult = await tool("nooterra.session_transcript_get", { sessionId, principalId: principalAgentId });
    const sessionTranscript =
      sessionTranscriptResult?.transcript ??
      sessionTranscriptResult?.result?.transcript ??
      null;
    if (!sessionTranscript || typeof sessionTranscript !== "object") {
      throw new Error("session transcript payload missing");
    }
    if (sessionTranscript?.schemaVersion !== "SessionTranscript.v1") {
      throw new Error(`unexpected session transcript schema: ${sessionTranscript?.schemaVersion ?? "null"}`);
    }
    if (sessionTranscript?.verification?.chainOk !== true) {
      throw new Error("session transcript verification.chainOk must be true");
    }
    if (sessionTranscript?.verification?.provenance?.ok !== true) {
      throw new Error("session transcript verification.provenance.ok must be true");
    }
    if (Number(sessionTranscript?.eventCount ?? -1) !== Number(sessionReplayPack?.eventCount ?? -2)) {
      throw new Error("session transcript eventCount mismatch vs replay pack");
    }
    if (String(sessionTranscript?.headChainHash ?? "") !== String(sessionReplayPack?.headChainHash ?? "")) {
      throw new Error("session transcript headChainHash mismatch vs replay pack");
    }
    if (
      typeof sessionTranscript?.sessionHash === "string" &&
      typeof sessionReplayPack?.sessionHash === "string" &&
      sessionTranscript.sessionHash !== sessionReplayPack.sessionHash
    ) {
      throw new Error("session transcript sessionHash mismatch vs replay pack");
    }

    const discover = await tool("nooterra.agent_discover", {
      capability: "travel.booking.flights",
      includeReputation: true,
      limit: 5
    });

    const report = {
      schemaVersion: SCHEMA_VERSION,
      ok: true,
      startedAt,
      completedAt: nowIso(),
      ids: {
        gateId,
        x402RunId,
        principalAgentId,
        workerAgentId,
        sessionId,
        traceId,
        quoteId,
        offerId,
        acceptanceId,
        acceptanceHash,
        workOrderId,
        completionReceiptId,
        delegationGrantRef,
        lineageInputPath,
        lineageVerificationPath
      },
      summary: {
        aboutOk: Boolean(about?.ok ?? true),
        settlementStatus:
          workOrderSettle?.workOrder?.settlement?.status ??
          workOrderSettle?.result?.workOrder?.settlement?.status ??
          null,
        auditLineageHash:
          auditLineage?.lineage?.lineageHash ??
          auditLineage?.result?.lineage?.lineageHash ??
          null,
        auditLineageTotalRecords:
          auditLineage?.lineage?.totalRecords ??
          auditLineage?.lineage?.summary?.totalRecords ??
          auditLineage?.result?.lineage?.totalRecords ??
          auditLineage?.result?.lineage?.summary?.totalRecords ??
          null,
        auditLineageVerificationOk: lineageVerification?.ok === true,
        auditLineageVerificationCode: lineageVerification?.code ?? null,
        sessionReplayPackHash: sessionReplayPack?.packHash ?? null,
        sessionReplayPackEventCount: sessionReplayPack?.eventCount ?? null,
        sessionTranscriptHash: sessionTranscript?.transcriptHash ?? null,
        sessionTranscriptEventCount: sessionTranscript?.eventCount ?? null,
        sessionTranscriptVerificationOk: sessionTranscript?.verification?.chainOk === true,
        sessionTranscriptProvenanceVerificationOk: sessionTranscript?.verification?.provenance?.ok === true,
        workOrderAcceptanceBound:
          workOrderCreate?.workOrder?.acceptanceBinding?.acceptanceId === acceptanceId ||
          workOrderCreate?.result?.workOrder?.acceptanceBinding?.acceptanceId === acceptanceId,
        discoveredAgents:
          Array.isArray(discover?.result?.results) ? discover.result.results.length : Array.isArray(discover?.results) ? discover.results.length : null
      },
      transcript
    };

    await mkdir(path.dirname(args.out), { recursive: true });
    await writeFile(args.out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    if (child) {
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore
      }
      await sleep(50);
    }
  }
}

main().catch(async (err) => {
  const failure = {
    schemaVersion: SCHEMA_VERSION,
    ok: false,
    completedAt: nowIso(),
    error: {
      message: err?.message ?? String(err),
      stack: err?.stack ?? null
    }
  };
  try {
    const args = parseArgs(process.argv.slice(2));
    await mkdir(path.dirname(args.out), { recursive: true });
    await writeFile(args.out, `${JSON.stringify(failure, null, 2)}\n`, "utf8");
  } catch {
    // ignore
  }
  process.stderr.write(`${err?.stack ?? err?.message ?? String(err)}\n`);
  process.exit(1);
});
