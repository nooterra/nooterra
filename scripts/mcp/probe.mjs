#!/usr/bin/env node
/**
 * MCP spike probe: spawns the stdio MCP server, sends initialize + tools/list, prints results, exits.
 *
 * Usage:
 *   npm run mcp:probe
 *   node scripts/mcp/probe.mjs --call nooterra.about '{}'
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import { verifyVerifiedInteractionGraphPackV1 } from "../../src/core/interaction-graph-pack.js";
import { keyMapFromNooterraKeyset } from "../../src/core/nooterra-keys.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseArgs(argv) {
  const out = {
    call: null,
    timeoutMs: null,
    x402Smoke: false,
    x402SmokeFile: null,
    interactionGraphSmoke: false,
    interactionGraphSmokeFile: null,
    requireTools: [],
    expectToolResult: "any"
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--call") {
      const name = argv[i + 1] || "";
      const argsRaw = argv[i + 2] || "{}";
      out.call = { name, argsRaw };
      i += 2;
    }
    if (a === "--call-file") {
      const name = argv[i + 1] || "";
      const file = argv[i + 2] || "";
      out.call = { name, argsRaw: null, file };
      i += 2;
    }
    if (a === "--timeout-ms") {
      const raw = argv[i + 1];
      out.timeoutMs = raw;
      i += 1;
    }
    if (a === "--x402-smoke") {
      out.x402Smoke = true;
    }
    if (a === "--x402-smoke-file") {
      out.x402Smoke = true;
      out.x402SmokeFile = argv[i + 1] || "";
      i += 1;
    }
    if (a === "--interaction-graph-smoke") {
      out.interactionGraphSmoke = true;
    }
    if (a === "--interaction-graph-smoke-file") {
      out.interactionGraphSmoke = true;
      out.interactionGraphSmokeFile = argv[i + 1] || "";
      i += 1;
    }
    if (a === "--expect-tool-error") {
      out.expectToolResult = "error";
    }
    if (a === "--expect-tool-success") {
      out.expectToolResult = "success";
    }
    if (a === "--require-tool") {
      const toolName = String(argv[i + 1] || "").trim();
      if (!toolName) throw new Error("--require-tool requires a non-empty tool name");
      out.requireTools.push(toolName);
      i += 1;
    }
    if (a.startsWith("--require-tool=")) {
      const toolName = String(a.slice("--require-tool=".length) || "").trim();
      if (!toolName) throw new Error("--require-tool requires a non-empty tool name");
      out.requireTools.push(toolName);
    }
  }
  out.requireTools = Array.from(new Set(out.requireTools));
  return out;
}

function assertNonEmptyString(value, name) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${name} must be a non-empty string`);
  return normalized;
}

function normalizeToolFailureMessage(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function detectToolCallFailure(callResponse, fallbackName = "unknown", parsedResult = null) {
  if (callResponse?.result?.isError === true) {
    const message = normalizeToolFailureMessage(callResponse?.result?.content?.[0]?.text) ?? "tool call failed";
    return { message };
  }
  const parsed =
    parsedResult ??
    (() => {
      const text = callResponse?.result?.content?.[0]?.text ?? "";
      try {
        return JSON.parse(text);
      } catch {
        return { tool: fallbackName, rawText: text };
      }
    })();
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const candidate =
    parsed?.result && typeof parsed.result === "object" && !Array.isArray(parsed.result) ? parsed.result : parsed;
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
  return { message, parsed };
}

async function readJsonResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch (err) {
    throw new Error(`invalid JSON response (HTTP ${response.status}): ${err?.message ?? err}`);
  }
}

async function fetchNooterraPayKeysetPublicKey({ baseUrl, signatureKeyId }) {
  const targetKeyId = assertNonEmptyString(signatureKeyId, "graphPack.signature.keyId");
  const response = await fetch(new URL("/.well-known/nooterra-keys.json", baseUrl).toString(), {
    method: "GET",
    headers: { accept: "application/json" }
  });
  if (!response.ok) {
    throw new Error(`failed loading nooterra keyset (HTTP ${response.status})`);
  }
  const keyset = await readJsonResponse(response);
  const keyMap = keyMapFromNooterraKeyset(keyset ?? {});
  const row = keyMap.get(targetKeyId) ?? null;
  if (!row?.publicKeyPem) {
    throw new Error(`nooterra keyset missing signature keyId: ${targetKeyId}`);
  }
  return row.publicKeyPem;
}

function assertProbeEnv() {
  const apiKey = process.env.NOOTERRA_API_KEY;
  if (typeof apiKey === "string" && apiKey.trim() !== "") return;
  throw new Error(
    [
      "[mcp:probe] missing required env var: NOOTERRA_API_KEY",
      "Set env and retry:",
      "  export NOOTERRA_BASE_URL=http://127.0.0.1:3000",
      "  export NOOTERRA_TENANT_ID=tenant_default",
      "  export NOOTERRA_API_KEY='sk_live_or_sk_test_keyid.secret'",
      "Docs: docs/QUICKSTART_MCP.md"
    ].join("\n")
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assertProbeEnv();

  const child = spawn(process.execPath, ["scripts/mcp/nooterra-mcp-server.mjs"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env }
  });

  child.stdout.setEncoding("utf8");
  let buf = "";
  const pending = new Map();
  let shuttingDown = false;

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    const reason = `mcp server exited before probe completed (code=${code ?? "null"} signal=${signal ?? ""})`;
    for (const { reject } of pending.values()) {
      reject(new Error(reason));
    }
    pending.clear();
  });

  function onLine(line) {
    let msg = null;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    const id = msg?.id;
    if (id !== undefined && pending.has(String(id))) {
      const { resolve } = pending.get(String(id));
      pending.delete(String(id));
      resolve(msg);
    } else {
      // Unexpected response; print it anyway.
      process.stdout.write(line + "\n");
    }
  }

  child.stdout.on("data", (chunk) => {
    buf += chunk;
    for (;;) {
      const idx = buf.indexOf("\n");
      if (idx === -1) break;
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      onLine(line);
    }
  });

  const timeoutMsRaw =
    args.timeoutMs !== null && args.timeoutMs !== undefined
      ? Number(args.timeoutMs)
      : typeof process !== "undefined"
        ? Number(process.env.MCP_PROBE_TIMEOUT_MS ?? 30_000)
        : 30_000;
  const timeoutMs = Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0 ? Math.floor(timeoutMsRaw) : 30_000;

  function rpc(method, params) {
    if (child.exitCode !== null) {
      throw new Error(`cannot call ${method}: mcp server already exited (code=${child.exitCode})`);
    }
    const id = String(Math.random()).slice(2);
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    child.stdin.write(payload + "\n");
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }, timeoutMs).unref?.();
    });
  }

  const init = await rpc("initialize", {
    protocolVersion: "2024-11-05",
    clientInfo: { name: "nooterra-mcp-probe", version: "s23" },
    capabilities: {}
  });
  process.stdout.write(JSON.stringify(init, null, 2) + "\n");

  const list = await rpc("tools/list", {});
  process.stdout.write(JSON.stringify(list, null, 2) + "\n");
  if (Array.isArray(args.requireTools) && args.requireTools.length > 0) {
    const tools = Array.isArray(list?.result?.tools) ? list.result.tools : [];
    const names = new Set(tools.map((row) => String(row?.name ?? "").trim()).filter(Boolean));
    const missing = args.requireTools.filter((toolName) => !names.has(toolName));
    if (missing.length > 0) {
      throw new Error(`missing required MCP tools: ${missing.join(", ")}`);
    }
  }

  function parseToolCallResult(callResponse, fallbackName = "unknown") {
    const text = callResponse?.result?.content?.[0]?.text ?? "";
    try {
      return JSON.parse(text);
    } catch {
      return { tool: fallbackName, rawText: text };
    }
  }

  async function callToolStrict(name, callArgs) {
    const called = await rpc("tools/call", { name, arguments: callArgs ?? {} });
    process.stdout.write(JSON.stringify(called, null, 2) + "\n");
    const parsed = parseToolCallResult(called, name);
    const failure = detectToolCallFailure(called, name, parsed);
    if (failure) {
      throw new Error(`${name} failed: ${failure.message}`);
    }
    return parsed;
  }

  if (args.call) {
    let callArgs = {};
    try {
      if (args.call.file) {
        const raw = fs.readFileSync(String(args.call.file), "utf8");
        callArgs = JSON.parse(raw);
      } else {
        callArgs = JSON.parse(args.call.argsRaw);
      }
    } catch (err) {
      const flag = args.call.file ? "--call-file" : "--call";
      throw new Error(`${flag} args must be JSON: ${err?.message ?? err}`);
    }
    const called = await rpc("tools/call", { name: args.call.name, arguments: callArgs });
    process.stdout.write(JSON.stringify(called, null, 2) + "\n");
    const parsed = parseToolCallResult(called, args.call.name);
    const toolIsError = Boolean(detectToolCallFailure(called, args.call.name, parsed));
    if (args.expectToolResult === "error" && !toolIsError) {
      throw new Error("expected tool call to return isError=true");
    }
    if (args.expectToolResult === "success" && toolIsError) {
      throw new Error("expected tool call to return isError=false");
    }
  }

  if (args.x402Smoke) {
    let smokeCfg = {};
    if (args.x402SmokeFile) {
      try {
        const raw = fs.readFileSync(String(args.x402SmokeFile), "utf8");
        smokeCfg = JSON.parse(raw);
      } catch (err) {
        throw new Error(`--x402-smoke-file must be valid JSON: ${err?.message ?? err}`);
      }
    }

    const seed = String(Date.now());
    const createArgs = {
      gateId: `x402gate_probe_${seed}`,
      payerAgentId: `agt_probe_payer_${seed}`,
      payeeAgentId: `agt_probe_payee_${seed}`,
      amountCents: 100,
      autoFundPayerCents: 1000,
      idempotencyKey: `mcp_probe_x402_gate_create_${seed}`,
      ...(smokeCfg?.create && typeof smokeCfg.create === "object" ? smokeCfg.create : {})
    };
    const createRes = await rpc("tools/call", { name: "nooterra.x402_gate_create", arguments: createArgs });
    process.stdout.write(JSON.stringify(createRes, null, 2) + "\n");
    const createParsed = parseToolCallResult(createRes, "nooterra.x402_gate_create");
    const gateId =
      createParsed?.result?.gateId ??
      createParsed?.result?.gate?.gateId ??
      createParsed?.gateId ??
      createParsed?.gate?.gateId ??
      createArgs.gateId;

    const verifyArgs = {
      gateId,
      ensureAuthorized: true,
      authorizeIdempotencyKey: `mcp_probe_x402_gate_authorize_${seed}`,
      idempotencyKey: `mcp_probe_x402_gate_verify_${seed}`,
      ...(smokeCfg?.verify && typeof smokeCfg.verify === "object" ? smokeCfg.verify : {})
    };
    const verifyRes = await rpc("tools/call", { name: "nooterra.x402_gate_verify", arguments: verifyArgs });
    process.stdout.write(JSON.stringify(verifyRes, null, 2) + "\n");

    const getArgs = {
      gateId,
      ...(smokeCfg?.get && typeof smokeCfg.get === "object" ? smokeCfg.get : {})
    };
    const getRes = await rpc("tools/call", { name: "nooterra.x402_gate_get", arguments: getArgs });
    process.stdout.write(JSON.stringify(getRes, null, 2) + "\n");
  }

  if (args.interactionGraphSmoke) {
    let smokeCfg = {};
    if (args.interactionGraphSmokeFile) {
      try {
        const raw = fs.readFileSync(String(args.interactionGraphSmokeFile), "utf8");
        smokeCfg = JSON.parse(raw);
      } catch (err) {
        throw new Error(`--interaction-graph-smoke-file must be valid JSON: ${err?.message ?? err}`);
      }
    }

    const seed = String(Date.now());
    const createAgreementArgs = {
      amountCents: 125,
      currency: "USD",
      title: `mcp probe interaction graph smoke ${seed}`,
      description: "deterministic signed graph pack smoke",
      capability: "agent-task:interaction-graph-smoke",
      payerDisplayName: `mcp_probe_payer_${seed}`,
      payeeDisplayName: `mcp_probe_payee_${seed}`,
      ...(smokeCfg?.createAgreement && typeof smokeCfg.createAgreement === "object" ? smokeCfg.createAgreement : {})
    };
    const createAgreement = await callToolStrict("nooterra.create_agreement", createAgreementArgs);
    const createAgreementResult =
      createAgreement?.result && typeof createAgreement.result === "object" && !Array.isArray(createAgreement.result)
        ? createAgreement.result
        : createAgreement;
    const payerAgentId = assertNonEmptyString(createAgreementResult?.payerAgentId, "create_agreement.payerAgentId");
    const payeeAgentId = assertNonEmptyString(createAgreementResult?.payeeAgentId, "create_agreement.payeeAgentId");
    const runId = assertNonEmptyString(createAgreementResult?.runId, "create_agreement.runId");

    const submitEvidenceArgs = {
      agentId: payeeAgentId,
      runId,
      evidenceRef: `evidence://mcp-probe/interaction-graph/${seed}/output.json`,
      ...(smokeCfg?.submitEvidence && typeof smokeCfg.submitEvidence === "object" ? smokeCfg.submitEvidence : {})
    };
    await callToolStrict("nooterra.submit_evidence", submitEvidenceArgs);

    const settleRunArgs = {
      agentId: payeeAgentId,
      runId,
      outcome: "completed",
      outputRef: `evidence://mcp-probe/interaction-graph/${seed}/output.json`,
      ...(smokeCfg?.settleRun && typeof smokeCfg.settleRun === "object" ? smokeCfg.settleRun : {})
    };
    await callToolStrict("nooterra.settle_run", settleRunArgs);

    const graphPackArgs = {
      agentId: payeeAgentId,
      sign: true,
      reputationVersion: "v2",
      reputationWindow: "allTime",
      asOf: "2030-01-01T00:00:00.000Z",
      visibility: "all",
      limit: 10,
      offset: 0,
      ...(smokeCfg?.graphPack && typeof smokeCfg.graphPack === "object" ? smokeCfg.graphPack : {})
    };
    graphPackArgs.sign = true;
    const envSignerKeyId = String(process.env.NOOTERRA_INTERACTION_GRAPH_PACK_SIGNER_KEY_ID ?? "").trim();
    if (!graphPackArgs.signerKeyId && envSignerKeyId) graphPackArgs.signerKeyId = envSignerKeyId;
    const graphPackResponse = await callToolStrict("nooterra.interaction_graph_pack_get", graphPackArgs);
    const graphPackResult =
      graphPackResponse?.result && typeof graphPackResponse.result === "object" && !Array.isArray(graphPackResponse.result)
        ? graphPackResponse.result
        : graphPackResponse;
    const graphPack =
      graphPackResult?.graphPack && typeof graphPackResult.graphPack === "object" && !Array.isArray(graphPackResult.graphPack)
        ? graphPackResult.graphPack
        : null;
    if (!graphPack) {
      throw new Error("interaction graph smoke missing graphPack in MCP response");
    }
    const signatureKeyId = assertNonEmptyString(graphPack?.signature?.keyId, "graphPack.signature.keyId");

    const explicitPublicKeyPem =
      String(smokeCfg?.verify?.publicKeyPem ?? "").trim() ||
      String(smokeCfg?.publicKeyPem ?? "").trim() ||
      String(process.env.NOOTERRA_INTERACTION_GRAPH_PACK_SIGNER_PUBLIC_KEY_PEM ?? "").trim() ||
      String(process.env.PROXY_INTERACTION_GRAPH_PACK_SIGNER_PUBLIC_KEY_PEM ?? "").trim() ||
      null;
    const publicKeyPem =
      explicitPublicKeyPem ||
      (await fetchNooterraPayKeysetPublicKey({
        baseUrl: process.env.NOOTERRA_BASE_URL || "http://127.0.0.1:3000",
        signatureKeyId
      }));

    const verifyResult = verifyVerifiedInteractionGraphPackV1({ graphPack, publicKeyPem });
    if (!verifyResult?.ok) {
      throw new Error(
        `interaction graph signature verification failed (${verifyResult?.code ?? "UNKNOWN"}): ${verifyResult?.error ?? "unknown"}`
      );
    }

    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          smoke: "interaction_graph_signed",
          payerAgentId,
          payeeAgentId,
          runId,
          packHash: verifyResult.packHash,
          keyId: verifyResult.keyId
        },
        null,
        2
      )}\n`
    );
  }

  shuttingDown = true;
  child.kill("SIGTERM");
  await Promise.race([sleep(50), new Promise((r) => child.once("exit", r))]);
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
    const message = typeof err?.message === "string" ? err.message : String(err);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}

export { detectToolCallFailure, parseArgs };
