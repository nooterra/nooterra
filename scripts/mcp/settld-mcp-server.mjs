#!/usr/bin/env node
/**
 * Sprint 23 MCP spike: JSON-RPC 2.0 over stdio exposing curated Settld tools.
 *
 * - Transport: stdio
 * - Framing: newline-delimited JSON; also accepts Content-Length framed messages.
 * - Auth: x-proxy-api-key (SETTLD_API_KEY)
 *
 * Production hardening (SSE, auth variants, rate limiting, telemetry) is Sprint 25+.
 */

import crypto from "node:crypto";

import { fetchWithSettldAutopay } from "../../packages/api-sdk/src/x402-autopay.js";

function nowMs() {
  return Date.now();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertNonEmptyString(v, name) {
  if (typeof v !== "string" || v.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
}

function parseOptionalJsonObject(value, name) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const raw = String(value).trim();
  const tryParse = (text) => {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new TypeError(`${name} must decode to a JSON object`);
    return parsed;
  };
  try {
    return tryParse(raw);
  } catch {
    try {
      const decoded = Buffer.from(raw, "base64url").toString("utf8");
      return tryParse(decoded);
    } catch (err) {
      throw new TypeError(`${name} must be JSON or base64url-encoded JSON`);
    }
  }
}

function safeJsonParse(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return { ok: false, error: err };
  }
}

function jsonRpcError(code, message, data = null) {
  return { code, message, data };
}

function redactSecrets(value) {
  // Best-effort redaction for logs/results; do not rely on this for security.
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (value.startsWith("sk_") || value.startsWith("tok_")) return "[redacted]";
    return value;
  }
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (String(k).toLowerCase().includes("secret") || String(k).toLowerCase().includes("password") || String(k).toLowerCase().includes("token")) {
        out[k] = "[redacted]";
      } else {
        out[k] = redactSecrets(v);
      }
    }
    return out;
  }
  return value;
}

function contentText(text) {
  return { type: "text", text: String(text ?? "") };
}

function asTextResult(obj) {
  const text = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  return { content: [contentText(text)], isError: false };
}

function asErrorResult(err) {
  const out = {
    error: true,
    message: err?.message ?? String(err ?? "error"),
    details: err?.details ?? null,
    statusCode: err?.statusCode ?? null
  };
  return { content: [contentText(JSON.stringify(out, null, 2))], isError: true };
}

function makeIdempotencyKey(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function sha256HexText(value) {
  return crypto.createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

function isSha256Hex(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value.trim());
}

function collectSettldHeaders(responseHeaders) {
  const out = {};
  for (const [k, v] of responseHeaders.entries()) {
    const key = String(k).toLowerCase();
    if (key.startsWith("x-settld-")) out[key] = v;
  }
  return out;
}

function parseCsvHeader(value) {
  if (typeof value !== "string" || value.trim() === "") return [];
  return value
    .split(",")
    .map((row) => row.trim())
    .filter(Boolean);
}

function normalizePolicyDecision(value) {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  return ["allow", "challenge", "deny", "escalate"].includes(raw) ? raw : null;
}

function parseSettldDecisionMetadata(headers) {
  const policyVersionRaw = Number(headers["x-settld-policy-version"] ?? Number.NaN);
  const reasonCodes = parseCsvHeader(headers["x-settld-verification-codes"]);
  const reasonCode = typeof headers["x-settld-reason-code"] === "string" && headers["x-settld-reason-code"].trim() !== ""
    ? headers["x-settld-reason-code"].trim()
    : reasonCodes[0] ?? null;
  return {
    policyDecision: normalizePolicyDecision(headers["x-settld-policy-decision"]),
    decisionId: typeof headers["x-settld-decision-id"] === "string" && headers["x-settld-decision-id"].trim() !== ""
      ? headers["x-settld-decision-id"].trim()
      : null,
    policyHash:
      typeof headers["x-settld-policy-hash"] === "string" && /^[0-9a-f]{64}$/i.test(headers["x-settld-policy-hash"].trim())
        ? headers["x-settld-policy-hash"].trim().toLowerCase()
        : null,
    policyVersion: Number.isSafeInteger(policyVersionRaw) && policyVersionRaw > 0 ? policyVersionRaw : null,
    reasonCode,
    reasonCodes
  };
}

function assertPolicyRuntimeMetadata({ headers, toolName }) {
  const required = [
    "x-settld-settlement-status",
    "x-settld-verification-status",
    "x-settld-policy-decision",
    "x-settld-policy-hash",
    "x-settld-decision-id"
  ];
  const missing = required.filter((key) => typeof headers[key] !== "string" || headers[key].trim() === "");
  if (missing.length > 0) {
    const err = new Error(`${toolName} response missing settld policy runtime metadata`);
    err.code = "SETTLD_POLICY_RUNTIME_METADATA_MISSING";
    err.details = { missingHeaders: missing };
    throw err;
  }
  const metadata = parseSettldDecisionMetadata(headers);
  if (!metadata.policyDecision) {
    const err = new Error(`${toolName} returned unsupported x-settld-policy-decision value`);
    err.code = "SETTLD_POLICY_RUNTIME_DECISION_INVALID";
    err.details = { policyDecision: headers["x-settld-policy-decision"] ?? null };
    throw err;
  }
  return metadata;
}

function generateEd25519PublicKeyPem() {
  const { publicKey } = crypto.generateKeyPairSync("ed25519");
  return publicKey.export({ format: "pem", type: "spki" });
}

class StdioJsonRpcStream {
  constructor({ input, output }) {
    this.input = input;
    this.output = output;
    this._buf = Buffer.alloc(0);
    this._onMessage = null;
    this._onError = null;
    input.on("data", (chunk) => this._onData(chunk));
    input.on("error", (err) => this._emitError(err));
  }

  onMessage(fn) {
    this._onMessage = fn;
  }

  onError(fn) {
    this._onError = fn;
  }

  send(obj) {
    const payload = Buffer.from(JSON.stringify(obj), "utf8");
    // Newline-delimited JSON output is sufficient for MCP clients; we also accept Content-Length on input.
    this.output.write(payload);
    this.output.write("\n");
  }

  _emitMessage(text) {
    if (this._onMessage) this._onMessage(text);
  }

  _emitError(err) {
    if (this._onError) this._onError(err);
  }

  _onData(chunk) {
    if (!chunk || chunk.length === 0) return;
    this._buf = Buffer.concat([this._buf, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
    this._drain();
  }

  _drain() {
    for (;;) {
      if (this._buf.length === 0) return;

      // Content-Length framed messages (LSP-style).
      const prefix = this._buf.slice(0, 15).toString("utf8");
      if (prefix === "Content-Length:") {
        const headerEnd = this._buf.indexOf("\r\n\r\n");
        if (headerEnd === -1) return;
        const header = this._buf.slice(0, headerEnd).toString("utf8");
        const m = header.match(/Content-Length:\\s*(\\d+)/i);
        if (!m) {
          this._emitError(new Error("invalid Content-Length framing (missing length)"));
          this._buf = Buffer.alloc(0);
          return;
        }
        const len = Number(m[1]);
        if (!Number.isFinite(len) || len < 0) {
          this._emitError(new Error("invalid Content-Length framing (bad length)"));
          this._buf = Buffer.alloc(0);
          return;
        }
        const start = headerEnd + 4;
        const end = start + len;
        if (this._buf.length < end) return;
        const jsonText = this._buf.slice(start, end).toString("utf8");
        this._buf = this._buf.slice(end);
        this._emitMessage(jsonText);
        continue;
      }

      // Newline-delimited JSON messages.
      const nl = this._buf.indexOf("\n");
      if (nl === -1) return;
      const line = this._buf.slice(0, nl).toString("utf8").trim();
      this._buf = this._buf.slice(nl + 1);
      if (!line) continue;
      this._emitMessage(line);
    }
  }
}

function makeSettldClient({ baseUrl, tenantId, apiKey, protocol }) {
  let cachedProtocol = protocol || null;

  async function discoverProtocol() {
    if (cachedProtocol) return cachedProtocol;
    try {
      const res = await fetch(new URL("/healthz", baseUrl), {
        method: "GET",
        headers: {
          "x-proxy-tenant-id": tenantId,
          "x-proxy-api-key": apiKey
        }
      });
      const hdr = res.headers.get("x-settld-protocol");
      if (hdr && String(hdr).trim() !== "") {
        cachedProtocol = String(hdr).trim();
        return cachedProtocol;
      }
    } catch {
      // Ignore; we will fallback.
    }
    cachedProtocol = cachedProtocol || "1.0";
    return cachedProtocol;
  }

  async function requestJson(path, { method = "GET", body = null, write = false, headers = {}, idem = null } = {}) {
    const url = new URL(path, baseUrl);
    const protocolHeader = write ? await discoverProtocol() : null;
    const h = {
      "x-proxy-tenant-id": tenantId,
      "x-proxy-api-key": apiKey,
      ...(write ? { "x-settld-protocol": protocolHeader } : {}),
      ...(body !== null ? { "content-type": "application/json" } : {}),
      ...(idem ? { "x-idempotency-key": String(idem) } : {}),
      ...headers
    };
    const res = await fetch(url, {
      method,
      headers: h,
      body: body === null ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const msg =
        (json && (json.message || json.error)) ? String(json.message || json.error) :
        text ? String(text) :
        `HTTP ${res.status}`;
      const err = new Error(msg);
      err.statusCode = res.status;
      err.details = json && (json.details || json.errorDetails) ? (json.details || json.errorDetails) : json;
      throw err;
    }
    return json;
  }

  async function getRunPrevChainHash({ agentId, runId }) {
    const out = await requestJson(`/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}/events`, { method: "GET" });
    const events = Array.isArray(out?.events) ? out.events : [];
    const last = events.length ? events[events.length - 1] : null;
    const prev = last && typeof last.chainHash === "string" && last.chainHash.trim() !== "" ? last.chainHash : null;
    return { prevChainHash: prev, events };
  }

  return {
    discoverProtocol,
    requestJson,
    getRunPrevChainHash
  };
}

function makePaidToolsClient({ baseUrl, tenantId, fetchImpl = fetch, agentPassport = null }) {
  const normalizedBaseUrl = (() => {
    if (typeof baseUrl !== "string" || baseUrl.trim() === "") return null;
    return baseUrl.trim();
  })();

  async function exaSearch({ query, numResults = 5 } = {}) {
    if (!normalizedBaseUrl) throw new Error("SETTLD_PAID_TOOLS_BASE_URL is required for settld.exa_search_paid");
    const normalizedQuery = String(query ?? "").trim();
    assertNonEmptyString(normalizedQuery, "query");

    const normalizedNumResultsRaw = Number(numResults ?? 5);
    if (!Number.isSafeInteger(normalizedNumResultsRaw) || normalizedNumResultsRaw < 1 || normalizedNumResultsRaw > 10) {
      throw new TypeError("numResults must be an integer between 1 and 10");
    }
    const normalizedNumResults = normalizedNumResultsRaw;

    const url = new URL("/exa/search", normalizedBaseUrl);
    url.searchParams.set("q", normalizedQuery);
    url.searchParams.set("numResults", String(normalizedNumResults));

    let challenge = null;
    const res = await fetchWithSettldAutopay(
      url,
      {
        method: "GET",
        headers: { "x-proxy-tenant-id": tenantId }
      },
      {
        fetch: fetchImpl,
        ...(agentPassport ? { agentPassport } : {}),
        onChallenge: (metadata) => {
          challenge = metadata;
        }
      }
    );
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const msg = json?.error ?? json?.message ?? text ?? `HTTP ${res.status}`;
      const err = new Error(String(msg));
      err.statusCode = res.status;
      err.details = json;
      throw err;
    }

    const headers = collectSettldHeaders(res.headers);
    const decision = assertPolicyRuntimeMetadata({ headers, toolName: "settld.exa_search_paid" });

    return {
      ok: true,
      query: normalizedQuery,
      numResults: normalizedNumResults,
      response: json,
      headers,
      decision,
      challenge
    };
  }

  async function weatherCurrent({ city, unit = "c" } = {}) {
    if (!normalizedBaseUrl) throw new Error("SETTLD_PAID_TOOLS_BASE_URL is required for settld.weather_current_paid");
    const normalizedCity = String(city ?? "").trim();
    assertNonEmptyString(normalizedCity, "city");

    const normalizedUnitRaw = String(unit ?? "c").trim().toLowerCase();
    if (normalizedUnitRaw !== "c" && normalizedUnitRaw !== "f") {
      throw new TypeError("unit must be c or f");
    }
    const normalizedUnit = normalizedUnitRaw;

    const url = new URL("/weather/current", normalizedBaseUrl);
    url.searchParams.set("city", normalizedCity);
    url.searchParams.set("unit", normalizedUnit);

    let challenge = null;
    const res = await fetchWithSettldAutopay(
      url,
      {
        method: "GET",
        headers: { "x-proxy-tenant-id": tenantId }
      },
      {
        fetch: fetchImpl,
        ...(agentPassport ? { agentPassport } : {}),
        onChallenge: (metadata) => {
          challenge = metadata;
        }
      }
    );
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const msg = json?.error ?? json?.message ?? text ?? `HTTP ${res.status}`;
      const err = new Error(String(msg));
      err.statusCode = res.status;
      err.details = json;
      throw err;
    }

    const headers = collectSettldHeaders(res.headers);
    const decision = assertPolicyRuntimeMetadata({ headers, toolName: "settld.weather_current_paid" });

    return {
      ok: true,
      city: normalizedCity,
      unit: normalizedUnit,
      response: json,
      headers,
      decision,
      challenge
    };
  }

  async function llmCompletion({ prompt, model = "gpt-4o-mini", maxTokens = 128 } = {}) {
    if (!normalizedBaseUrl) throw new Error("SETTLD_PAID_TOOLS_BASE_URL is required for settld.llm_completion_paid");
    const normalizedPrompt = String(prompt ?? "").trim();
    assertNonEmptyString(normalizedPrompt, "prompt");

    const normalizedModel = String(model ?? "").trim() || "gpt-4o-mini";
    const normalizedMaxTokensRaw = Number(maxTokens ?? 128);
    if (!Number.isSafeInteger(normalizedMaxTokensRaw) || normalizedMaxTokensRaw < 1 || normalizedMaxTokensRaw > 512) {
      throw new TypeError("maxTokens must be an integer between 1 and 512");
    }
    const normalizedMaxTokens = normalizedMaxTokensRaw;

    const url = new URL("/llm/completions", normalizedBaseUrl);
    url.searchParams.set("prompt", normalizedPrompt);
    url.searchParams.set("model", normalizedModel);
    url.searchParams.set("maxTokens", String(normalizedMaxTokens));

    let challenge = null;
    const res = await fetchWithSettldAutopay(
      url,
      {
        method: "GET",
        headers: { "x-proxy-tenant-id": tenantId }
      },
      {
        fetch: fetchImpl,
        ...(agentPassport ? { agentPassport } : {}),
        onChallenge: (metadata) => {
          challenge = metadata;
        }
      }
    );
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const msg = json?.error ?? json?.message ?? text ?? `HTTP ${res.status}`;
      const err = new Error(String(msg));
      err.statusCode = res.status;
      err.details = json;
      throw err;
    }

    const headers = collectSettldHeaders(res.headers);
    const decision = assertPolicyRuntimeMetadata({ headers, toolName: "settld.llm_completion_paid" });

    return {
      ok: true,
      prompt: normalizedPrompt,
      model: normalizedModel,
      maxTokens: normalizedMaxTokens,
      response: json,
      headers,
      decision,
      challenge
    };
  }

  return { exaSearch, weatherCurrent, llmCompletion };
}

function buildTools() {
  return [
    {
      name: "settld.create_agreement",
      description:
        "Create a marketplace-backed agreement + run by registering payer/payee agents, funding payer, creating an RFQ, submitting a bid, and accepting it.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          amountCents: { type: "integer", minimum: 1, default: 500 },
          currency: { type: "string", default: "USD" },
          title: { type: "string", default: "MCP spike agreement" },
          description: { type: ["string", "null"], default: null },
          capability: { type: "string", default: "agent-task:demo" },
          disputeWindowDays: { type: "integer", minimum: 0, default: 7 },
          payerDisplayName: { type: "string", default: "MCP Payer" },
          payeeDisplayName: { type: "string", default: "MCP Payee" }
        }
      }
    },
    {
      name: "settld.submit_evidence",
      description: "Append an EVIDENCE_ADDED event to an agent run (handles expected prevChainHash precondition).",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["agentId", "runId", "evidenceRef"],
        properties: {
          agentId: { type: "string" },
          runId: { type: "string" },
          evidenceRef: { type: "string" }
        }
      }
    },
    {
      name: "settld.settle_run",
      description: "Append a RUN_COMPLETED or RUN_FAILED event (triggers settlement auto-resolution).",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["agentId", "runId"],
        properties: {
          agentId: { type: "string" },
          runId: { type: "string" },
          outcome: { type: "string", enum: ["completed", "failed"], default: "completed" },
          outputRef: { type: ["string", "null"], default: null },
          errorCode: { type: ["string", "null"], default: null },
          errorMessage: { type: ["string", "null"], default: null }
        }
      }
    },
    {
      name: "settld.exa_search_paid",
      description: "Execute a paid Exa-style search through the x402 gateway with transparent Settld autopay.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["query"],
        properties: {
          query: { type: "string" },
          numResults: { type: "integer", minimum: 1, maximum: 10, default: 5 }
        }
      }
    },
    {
      name: "settld.weather_current_paid",
      description: "Fetch paid current weather through the x402 gateway with transparent Settld autopay.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["city"],
        properties: {
          city: { type: "string" },
          unit: { type: "string", enum: ["c", "f"], default: "c" }
        }
      }
    },
    {
      name: "settld.llm_completion_paid",
      description: "Execute a paid LLM completion through the x402 gateway with transparent Settld autopay.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["prompt"],
        properties: {
          prompt: { type: "string" },
          model: { type: "string", default: "gpt-4o-mini" },
          maxTokens: { type: "integer", minimum: 1, maximum: 512, default: 128 }
        }
      }
    },
    {
      name: "settld.resolve_settlement",
      description:
        "Manually resolve a run settlement (released/refunded). Useful for demos where the policy engine would otherwise leave the settlement locked.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["runId"],
        properties: {
          runId: { type: "string" },
          status: { type: "string", enum: ["released", "refunded"], default: "released" },
          releaseRatePct: { type: ["integer", "null"], minimum: 0, maximum: 100, default: null },
          releasedAmountCents: { type: ["integer", "null"], minimum: 0, default: null },
          refundedAmountCents: { type: ["integer", "null"], minimum: 0, default: null },
          reason: { type: ["string", "null"], default: null },
          resolvedByAgentId: { type: ["string", "null"], default: null }
        }
      }
    },
    {
      name: "settld.open_dispute",
      description: "Open a dispute on a resolved run settlement (requires dispute window still open).",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["runId"],
        properties: {
          runId: { type: "string" },
          reason: { type: ["string", "null"], default: null },
          evidenceRefs: { type: "array", items: { type: "string" }, default: [] },
          waitMs: {
            type: "integer",
            minimum: 0,
            default: 0,
            description: "Optional: wait up to this many milliseconds for settlement resolution before opening the dispute."
          },
          disputeType: { type: ["string", "null"], default: null },
          priority: { type: ["string", "null"], default: null },
          channel: { type: ["string", "null"], default: null }
        }
      }
    },
    {
      name: "settld.dispute_add_evidence",
      description: "Attach dispute evidence to an open dispute.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["runId", "evidenceRef"],
        properties: {
          runId: { type: "string" },
          disputeId: { type: ["string", "null"], default: null },
          evidenceRef: { type: "string" },
          submittedByAgentId: { type: ["string", "null"], default: null },
          reason: { type: ["string", "null"], default: null },
          idempotencyKey: { type: ["string", "null"], default: null }
        }
      }
    },
    {
      name: "settld.dispute_escalate",
      description: "Escalate an open dispute to a higher level (counterparty/arbiter/external).",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["runId", "escalationLevel"],
        properties: {
          runId: { type: "string" },
          disputeId: { type: ["string", "null"], default: null },
          escalationLevel: { type: "string", enum: ["l1_counterparty", "l2_arbiter", "l3_external"] },
          channel: { type: ["string", "null"], default: null },
          escalatedByAgentId: { type: ["string", "null"], default: null },
          reason: { type: ["string", "null"], default: null },
          idempotencyKey: { type: ["string", "null"], default: null }
        }
      }
    },
    {
      name: "settld.dispute_close",
      description: "Close an open dispute with optional signed verdict material.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["runId"],
        properties: {
          runId: { type: "string" },
          disputeId: { type: ["string", "null"], default: null },
          resolution: { type: ["object", "null"], additionalProperties: true, default: null },
          verdict: { type: ["object", "null"], additionalProperties: true, default: null },
          arbitrationVerdict: { type: ["object", "null"], additionalProperties: true, default: null },
          idempotencyKey: { type: ["string", "null"], default: null }
        }
      }
    },
    {
      name: "settld.arbitration_open",
      description: "Open an arbitration case for an already-open dispute.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["runId"],
        properties: {
          runId: { type: "string" },
          caseId: { type: ["string", "null"], default: null },
          disputeId: { type: ["string", "null"], default: null },
          arbiterAgentId: { type: ["string", "null"], default: null },
          panelCandidateAgentIds: { type: ["array", "null"], items: { type: "string" }, default: null },
          evidenceRefs: { type: ["array", "null"], items: { type: "string" }, default: null },
          summary: { type: ["string", "null"], default: null },
          idempotencyKey: { type: ["string", "null"], default: null }
        }
      }
    },
    {
      name: "settld.arbitration_issue_verdict",
      description: "Issue a signed arbitration verdict for a case.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["runId", "caseId", "arbitrationVerdict"],
        properties: {
          runId: { type: "string" },
          caseId: { type: "string" },
          arbitrationVerdict: { type: "object", additionalProperties: true },
          idempotencyKey: { type: ["string", "null"], default: null }
        }
      }
    },
    {
      name: "settld.agreement_delegation_create",
      description: "Create an AgreementDelegation.v1 edge (idempotent via idempotencyKey).",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["parentAgreementHash", "childAgreementHash", "delegatorAgentId", "delegateeAgentId", "budgetCapCents"],
        properties: {
          parentAgreementHash: { type: "string" },
          childAgreementHash: { type: "string" },
          delegatorAgentId: { type: "string" },
          delegateeAgentId: { type: "string" },
          budgetCapCents: { type: "integer", minimum: 1 },
          currency: { type: "string", default: "USD" },
          delegationDepth: { type: ["integer", "null"], minimum: 1, default: null },
          maxDelegationDepth: { type: ["integer", "null"], minimum: 1, default: null },
          ancestorChain: { type: ["array", "null"], items: { type: "string" }, default: null },
          delegationId: { type: ["string", "null"], default: null },
          idempotencyKey: { type: ["string", "null"], default: null }
        }
      }
    },
    {
      name: "settld.agreement_delegation_list",
      description: "List agreement delegations touching an agreement hash.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["agreementHash"],
        properties: {
          agreementHash: { type: "string" },
          status: { type: ["string", "null"], default: null },
          limit: { type: ["integer", "null"], minimum: 1, default: null },
          offset: { type: ["integer", "null"], minimum: 0, default: null }
        }
      }
    },
    {
      name: "settld.delegation_grant_issue",
      description: "Issue a DelegationGrant.v1 object (idempotent via idempotencyKey).",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["delegatorAgentId", "delegateeAgentId", "maxPerCallCents", "maxTotalCents"],
        properties: {
          grantId: { type: ["string", "null"], default: null },
          delegatorAgentId: { type: "string" },
          delegateeAgentId: { type: "string" },
          allowedProviderIds: { type: ["array", "null"], items: { type: "string" }, default: null },
          allowedToolIds: { type: ["array", "null"], items: { type: "string" }, default: null },
          allowedRiskClasses: {
            type: ["array", "null"],
            items: { type: "string", enum: ["read", "compute", "action", "financial"] },
            default: null
          },
          sideEffectingAllowed: { type: ["boolean", "null"], default: null },
          currency: { type: "string", default: "USD" },
          maxPerCallCents: { type: "integer", minimum: 0 },
          maxTotalCents: { type: "integer", minimum: 0 },
          rootGrantHash: { type: ["string", "null"], default: null },
          parentGrantHash: { type: ["string", "null"], default: null },
          depth: { type: ["integer", "null"], minimum: 0, default: null },
          maxDelegationDepth: { type: ["integer", "null"], minimum: 0, default: null },
          issuedAt: { type: ["string", "null"], default: null },
          notBefore: { type: ["string", "null"], default: null },
          expiresAt: { type: ["string", "null"], default: null },
          revocable: { type: ["boolean", "null"], default: null },
          metadata: { type: ["object", "null"], additionalProperties: true, default: null },
          idempotencyKey: { type: ["string", "null"], default: null }
        }
      }
    },
    {
      name: "settld.delegation_grant_get",
      description: "Fetch a delegation grant by grantId.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["grantId"],
        properties: {
          grantId: { type: "string" }
        }
      }
    },
    {
      name: "settld.delegation_grant_list",
      description: "List delegation grants with optional filters.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          grantId: { type: ["string", "null"], default: null },
          grantHash: { type: ["string", "null"], default: null },
          delegatorAgentId: { type: ["string", "null"], default: null },
          delegateeAgentId: { type: ["string", "null"], default: null },
          includeRevoked: { type: ["boolean", "null"], default: null },
          limit: { type: ["integer", "null"], minimum: 1, default: null },
          offset: { type: ["integer", "null"], minimum: 0, default: null }
        }
      }
    },
    {
      name: "settld.delegation_grant_revoke",
      description: "Revoke a delegation grant.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["grantId"],
        properties: {
          grantId: { type: "string" },
          revocationReasonCode: { type: ["string", "null"], default: null },
          idempotencyKey: { type: ["string", "null"], default: null }
        }
      }
    },
    {
      name: "settld.agent_card_upsert",
      description: "Create or update an AgentCard.v1 profile for discovery and matching.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["agentId"],
        properties: {
          agentId: { type: "string" },
          displayName: { type: ["string", "null"], default: null },
          description: { type: ["string", "null"], default: null },
          capabilities: { type: ["array", "null"], items: { type: "string" }, default: null },
          visibility: { type: ["string", "null"], enum: ["public", "tenant", "private", null], default: null },
          hostRuntime: { type: ["string", "null"], default: null },
          hostEndpoint: { type: ["string", "null"], default: null },
          hostProtocols: { type: ["array", "null"], items: { type: "string" }, default: null },
          priceHint: {
            type: ["object", "null"],
            additionalProperties: false,
            default: null,
            properties: {
              amountCents: { type: "integer", minimum: 0 },
              currency: { type: ["string", "null"], default: "USD" },
              unit: { type: ["string", "null"], default: "task" }
            }
          },
          attestations: { type: ["array", "null"], items: { type: "object", additionalProperties: true }, default: null },
          tags: { type: ["array", "null"], items: { type: "string" }, default: null },
          metadata: { type: ["object", "null"], additionalProperties: true, default: null },
          idempotencyKey: { type: ["string", "null"], default: null }
        }
      }
    },
    {
      name: "settld.agent_discover",
      description: "Discover AgentCard.v1 records with capability/runtime/reputation filters.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          capability: { type: ["string", "null"], default: null },
          status: { type: ["string", "null"], enum: ["active", "suspended", "revoked", "all", null], default: null },
          visibility: { type: ["string", "null"], enum: ["public", "tenant", "private", "all", null], default: null },
          runtime: { type: ["string", "null"], default: null },
          requireCapabilityAttestation: { type: ["boolean", "null"], default: false },
          attestationMinLevel: { type: ["string", "null"], enum: ["self_claim", "attested", "certified", null], default: null },
          attestationIssuerAgentId: { type: ["string", "null"], default: null },
          includeAttestationMetadata: { type: ["boolean", "null"], default: false },
          minTrustScore: { type: ["integer", "null"], minimum: 0, maximum: 100, default: null },
          riskTier: { type: ["string", "null"], enum: ["low", "guarded", "elevated", "high", null], default: null },
          includeReputation: { type: ["boolean", "null"], default: true },
          reputationVersion: { type: ["string", "null"], enum: ["v1", "v2", null], default: "v2" },
          reputationWindow: { type: ["string", "null"], enum: ["7d", "30d", "allTime", null], default: "30d" },
          scoreStrategy: { type: ["string", "null"], enum: ["balanced", "recent_bias", "trust_weighted", null], default: "balanced" },
          requesterAgentId: { type: ["string", "null"], default: null },
          includeRoutingFactors: { type: ["boolean", "null"], default: false },
          limit: { type: ["integer", "null"], minimum: 1, default: null },
          offset: { type: ["integer", "null"], minimum: 0, default: null }
        }
      }
    },
    {
      name: "settld.capability_attest",
      description: "Issue a signed capability attestation record for agent discovery/routing.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["subjectAgentId", "capability"],
        properties: {
          attestationId: { type: ["string", "null"], default: null },
          subjectAgentId: { type: "string" },
          capability: { type: "string" },
          level: { type: ["string", "null"], enum: ["self_claim", "attested", "certified", null], default: "attested" },
          issuerAgentId: { type: ["string", "null"], default: null },
          issuedAt: { type: ["string", "null"], default: null },
          notBefore: { type: ["string", "null"], default: null },
          expiresAt: { type: ["string", "null"], default: null },
          signatureKeyId: { type: ["string", "null"], default: null },
          signature: { type: ["string", "null"], default: null },
          verificationMethod: { type: ["object", "null"], additionalProperties: true, default: null },
          evidenceRefs: { type: ["array", "null"], items: { type: "string" }, default: null },
          metadata: { type: ["object", "null"], additionalProperties: true, default: null },
          idempotencyKey: { type: ["string", "null"], default: null }
        }
      }
    },
    {
      name: "settld.capability_attestation_list",
      description: "List capability attestations with runtime validity status.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          attestationId: { type: ["string", "null"], default: null },
          subjectAgentId: { type: ["string", "null"], default: null },
          issuerAgentId: { type: ["string", "null"], default: null },
          capability: { type: ["string", "null"], default: null },
          status: { type: ["string", "null"], enum: ["valid", "expired", "not_active", "revoked", "all", null], default: null },
          at: { type: ["string", "null"], default: null },
          includeInvalid: { type: ["boolean", "null"], default: false },
          limit: { type: ["integer", "null"], minimum: 1, default: null },
          offset: { type: ["integer", "null"], minimum: 0, default: null }
        }
      }
    },
    {
      name: "settld.capability_attestation_revoke",
      description: "Revoke an existing capability attestation.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["attestationId"],
        properties: {
          attestationId: { type: "string" },
          revokedAt: { type: ["string", "null"], default: null },
          reasonCode: { type: ["string", "null"], default: null },
          idempotencyKey: { type: ["string", "null"], default: null }
        }
      }
    },
    {
      name: "settld.work_order_create",
      description: "Create a SubAgentWorkOrder.v1 for delegated paid execution.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["principalAgentId", "subAgentId", "requiredCapability", "amountCents"],
        properties: {
          workOrderId: { type: ["string", "null"], default: null },
          parentTaskId: { type: ["string", "null"], default: null },
          principalAgentId: { type: "string" },
          subAgentId: { type: "string" },
          requiredCapability: { type: "string" },
          specification: { type: ["object", "null"], additionalProperties: true, default: null },
          amountCents: { type: "integer", minimum: 1 },
          currency: { type: ["string", "null"], default: "USD" },
          quoteId: { type: ["string", "null"], default: null },
          constraints: { type: ["object", "null"], additionalProperties: true, default: null },
          evidencePolicy: {
            type: ["object", "null"],
            additionalProperties: false,
            default: null,
            properties: {
              schemaVersion: { type: ["string", "null"], default: "WorkOrderSettlementEvidencePolicy.v1" },
              workOrderType: { type: ["string", "null"], default: null },
              release: {
                type: ["object", "null"],
                additionalProperties: false,
                default: null,
                properties: {
                  minEvidenceRefs: { type: ["integer", "null"], minimum: 0, default: null },
                  requiredKinds: {
                    type: ["array", "null"],
                    items: { type: "string", enum: ["artifact", "hash", "verification_report"] },
                    default: null
                  },
                  requireReceiptHashBinding: { type: ["boolean", "null"], default: null }
                }
              },
              refund: {
                type: ["object", "null"],
                additionalProperties: false,
                default: null,
                properties: {
                  minEvidenceRefs: { type: ["integer", "null"], minimum: 0, default: null },
                  requiredKinds: {
                    type: ["array", "null"],
                    items: { type: "string", enum: ["artifact", "hash", "verification_report"] },
                    default: null
                  },
                  requireReceiptHashBinding: { type: ["boolean", "null"], default: null }
                }
              }
            }
          },
          attestationRequirement: {
            type: ["object", "null"],
            additionalProperties: false,
            required: ["required"],
            default: null,
            properties: {
              required: { type: "boolean" },
              minLevel: { type: ["string", "null"], enum: ["self_claim", "attested", "certified", null], default: null },
              issuerAgentId: { type: ["string", "null"], default: null }
            }
          },
          requireCapabilityAttestation: { type: ["boolean", "null"], default: null },
          attestationMinLevel: { type: ["string", "null"], enum: ["self_claim", "attested", "certified", null], default: null },
          attestationIssuerAgentId: { type: ["string", "null"], default: null },
          delegationGrantRef: { type: ["string", "null"], default: null },
          metadata: { type: ["object", "null"], additionalProperties: true, default: null },
          idempotencyKey: { type: ["string", "null"], default: null }
        }
      }
    },
    {
      name: "settld.work_order_accept",
      description: "Accept a SubAgentWorkOrder.v1 by id.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["workOrderId"],
        properties: {
          workOrderId: { type: "string" },
          acceptedByAgentId: { type: ["string", "null"], default: null },
          acceptedAt: { type: ["string", "null"], default: null },
          idempotencyKey: { type: ["string", "null"], default: null }
        }
      }
    },
    {
      name: "settld.work_order_progress",
      description: "Append progress event to a SubAgentWorkOrder.v1.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["workOrderId"],
        properties: {
          workOrderId: { type: "string" },
          progressId: { type: ["string", "null"], default: null },
          eventType: { type: ["string", "null"], default: null },
          message: { type: ["string", "null"], default: null },
          percentComplete: { type: ["integer", "null"], minimum: 0, maximum: 100, default: null },
          evidenceRefs: { type: ["array", "null"], items: { type: "string" }, default: null },
          at: { type: ["string", "null"], default: null },
          idempotencyKey: { type: ["string", "null"], default: null }
        }
      }
    },
    {
      name: "settld.work_order_complete",
      description: "Complete a SubAgentWorkOrder.v1 and attach SubAgentCompletionReceipt.v1.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["workOrderId"],
        properties: {
          workOrderId: { type: "string" },
          receiptId: { type: ["string", "null"], default: null },
          status: { type: ["string", "null"], enum: ["success", "failed", null], default: null },
          outputs: { type: ["object", "array", "null"], default: null },
          metrics: { type: ["object", "null"], additionalProperties: true, default: null },
          evidenceRefs: { type: ["array", "null"], items: { type: "string" }, default: null },
          amountCents: { type: ["integer", "null"], minimum: 0, default: null },
          currency: { type: ["string", "null"], default: null },
          deliveredAt: { type: ["string", "null"], default: null },
          completedAt: { type: ["string", "null"], default: null },
          metadata: { type: ["object", "null"], additionalProperties: true, default: null },
          idempotencyKey: { type: ["string", "null"], default: null }
        }
      }
    },
    {
      name: "settld.work_order_settle",
      description: "Bind x402 settlement evidence to a completed SubAgentWorkOrder.v1.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["workOrderId", "x402GateId", "x402RunId"],
        properties: {
          workOrderId: { type: "string" },
          completionReceiptId: { type: ["string", "null"], default: null },
          status: { type: ["string", "null"], enum: ["released", "refunded", null], default: null },
          x402GateId: { type: "string" },
          x402RunId: { type: "string" },
          x402SettlementStatus: { type: ["string", "null"], default: null },
          x402ReceiptId: { type: ["string", "null"], default: null },
          completionReceiptHash: { type: ["string", "null"], default: null },
          settledAt: { type: ["string", "null"], default: null },
          idempotencyKey: { type: ["string", "null"], default: null }
        }
      }
    },
    {
      name: "settld.x402_gate_create",
      description: "Create an x402 gate (idempotent via idempotencyKey). Generates payer/payee agent ids when omitted.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          gateId: { type: ["string", "null"], default: null },
          payerAgentId: { type: ["string", "null"], default: null },
          payeeAgentId: { type: ["string", "null"], default: null },
          amountCents: { type: "integer", minimum: 1, default: 500 },
          currency: { type: "string", default: "USD" },
          autoFundPayerCents: { type: ["integer", "null"], minimum: 0, default: null },
          toolId: { type: ["string", "null"], default: null },
          delegationGrantRef: { type: ["string", "null"], default: null },
          idempotencyKey: { type: ["string", "null"], default: null }
        }
      }
    },
    {
      name: "settld.x402_gate_verify",
      description:
        "Verify and resolve an x402 gate. By default it first authorizes payment so MCP probe can run create -> verify -> get.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["gateId"],
        properties: {
          gateId: { type: "string" },
          ensureAuthorized: { type: "boolean", default: true },
          authorizeIdempotencyKey: { type: ["string", "null"], default: null },
          idempotencyKey: { type: ["string", "null"], default: null },
          verificationStatus: { type: "string", enum: ["green", "amber", "red"], default: "green" },
          runStatus: { type: "string", enum: ["completed", "failed"], default: "completed" },
          requestSha256: { type: ["string", "null"], default: null },
          responseSha256: { type: ["string", "null"], default: null }
        }
      }
    },
    {
      name: "settld.x402_gate_get",
      description: "Fetch the current x402 gate record and linked settlement state.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["gateId"],
        properties: {
          gateId: { type: "string" }
        }
      }
    },
    {
      name: "settld.about",
      description: "Return MCP server configuration (redacted).",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {}
      }
    }
  ];
}

async function main() {
  const baseUrl = process.env.SETTLD_BASE_URL || "http://127.0.0.1:3000";
  const tenantId = process.env.SETTLD_TENANT_ID || "tenant_default";
  const apiKey = process.env.SETTLD_API_KEY || "";
  const protocol = process.env.SETTLD_PROTOCOL || null;
  const paidToolsBaseUrl = process.env.SETTLD_PAID_TOOLS_BASE_URL || "http://127.0.0.1:8402";
  const paidToolsAgentPassport = parseOptionalJsonObject(
    process.env.SETTLD_PAID_TOOLS_AGENT_PASSPORT ?? null,
    "SETTLD_PAID_TOOLS_AGENT_PASSPORT"
  );

  assertNonEmptyString(baseUrl, "SETTLD_BASE_URL");
  assertNonEmptyString(tenantId, "SETTLD_TENANT_ID");
  assertNonEmptyString(apiKey, "SETTLD_API_KEY");

  // Operational hint: this server speaks JSON-RPC over stdin/stdout (MCP stdio transport).
  // Keep stdout strictly for JSON-RPC messages; print hints to stderr only.
  process.stderr.write("[mcp] ready (stdio). Use `npm run mcp:probe` or an MCP client; do not paste shell prompts.\n");

  const client = makeSettldClient({ baseUrl, tenantId, apiKey, protocol });
  const paidToolsClient = makePaidToolsClient({ baseUrl: paidToolsBaseUrl, tenantId, agentPassport: paidToolsAgentPassport });
  const tools = buildTools();
  const toolByName = new Map(tools.map((t) => [t.name, t]));

  const stream = new StdioJsonRpcStream({ input: process.stdin, output: process.stdout });
  stream.onError((err) => {
    // Never write logs to stdout (reserved for JSON-RPC). stderr only.
    process.stderr.write(`[mcp] stream error: ${err?.message ?? err}\n`);
  });

  let negotiatedProtocolVersion = null;

  stream.onMessage(async (text) => {
    const parsed = safeJsonParse(text);
    if (!parsed.ok) {
      // Invalid JSON from client: ignore (spike) but report on stderr.
      process.stderr.write(`[mcp] invalid json: ${String(parsed.error?.message ?? parsed.error)}\n`);
      return;
    }
    const msg = parsed.value;
    const id = msg?.id;
    const method = msg?.method;
    const isNotification = id === undefined || id === null;

    if (typeof method !== "string" || method.trim() === "") {
      if (!isNotification) {
        stream.send({ jsonrpc: "2.0", id, error: jsonRpcError(-32600, "Invalid Request") });
      }
      return;
    }

    try {
      if (method === "initialize") {
        const pv = msg?.params?.protocolVersion ? String(msg.params.protocolVersion) : null;
        negotiatedProtocolVersion = pv || negotiatedProtocolVersion || "2024-11-05";
        if (!isNotification) {
          stream.send({
            jsonrpc: "2.0",
            id,
            result: {
              protocolVersion: negotiatedProtocolVersion,
              serverInfo: { name: "settld-mcp-spike", version: "s23" },
              capabilities: { tools: {} }
            }
          });
        }
        return;
      }

      if (method === "ping") {
        if (!isNotification) stream.send({ jsonrpc: "2.0", id, result: {} });
        return;
      }

      if (method === "initialized" || method === "notifications/initialized") {
        return;
      }

      if (method === "tools/list") {
        if (!isNotification) stream.send({ jsonrpc: "2.0", id, result: { tools } });
        return;
      }

      if (method === "tools/call") {
        const name = msg?.params?.name ? String(msg.params.name) : "";
        const args = msg?.params?.arguments && typeof msg.params.arguments === "object" ? msg.params.arguments : {};
        if (!toolByName.has(name)) {
          if (!isNotification) stream.send({ jsonrpc: "2.0", id, result: { content: [contentText(`unknown tool: ${name}`)], isError: true } });
          return;
        }
        const started = nowMs();
        let result = null;
        try {
          if (name === "settld.about") {
            const discovered = await client.discoverProtocol();
            result = {
              ok: true,
              server: { name: "settld-mcp-spike", version: "s23" },
              config: redactSecrets({ baseUrl, tenantId, protocol: discovered, paidToolsBaseUrl })
            };
          } else if (name === "settld.exa_search_paid") {
            const query = String(args?.query ?? "").trim();
            assertNonEmptyString(query, "query");
            const numResults = args?.numResults ?? 5;
            result = await paidToolsClient.exaSearch({ query, numResults });
          } else if (name === "settld.weather_current_paid") {
            const city = String(args?.city ?? "").trim();
            assertNonEmptyString(city, "city");
            const unit = args?.unit ?? "c";
            result = await paidToolsClient.weatherCurrent({ city, unit });
          } else if (name === "settld.llm_completion_paid") {
            const prompt = String(args?.prompt ?? "").trim();
            assertNonEmptyString(prompt, "prompt");
            const model = args?.model ?? "gpt-4o-mini";
            const maxTokens = args?.maxTokens ?? 128;
            result = await paidToolsClient.llmCompletion({ prompt, model, maxTokens });
          } else if (name === "settld.create_agreement") {
            const amountCents = Number(args?.amountCents ?? 500);
            if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new TypeError("amountCents must be a positive safe integer");
            const currency = args?.currency ? String(args.currency).trim().toUpperCase() : "USD";
            const title = args?.title ? String(args.title).trim() : "MCP spike agreement";
            const description = args?.description === undefined ? null : args.description === null ? null : String(args.description);
            const capability = args?.capability ? String(args.capability).trim() : "agent-task:demo";
            const disputeWindowDaysRaw = args?.disputeWindowDays ?? 7;
            const disputeWindowDays = Number(disputeWindowDaysRaw);
            if (!Number.isSafeInteger(disputeWindowDays) || disputeWindowDays < 0) {
              throw new TypeError("disputeWindowDays must be a non-negative safe integer");
            }
            const payerDisplayName = args?.payerDisplayName ? String(args.payerDisplayName).trim() : "MCP Payer";
            const payeeDisplayName = args?.payeeDisplayName ? String(args.payeeDisplayName).trim() : "MCP Payee";

            // Register payer + payee agents.
            const payerPublicKeyPem = generateEd25519PublicKeyPem();
            const payeePublicKeyPem = generateEd25519PublicKeyPem();
            const payer = await client.requestJson("/agents/register", {
              method: "POST",
              body: { publicKeyPem: payerPublicKeyPem, displayName: payerDisplayName },
              idem: makeIdempotencyKey("mcp_agents_register_payer")
            });
            const payee = await client.requestJson("/agents/register", {
              method: "POST",
              body: { publicKeyPem: payeePublicKeyPem, displayName: payeeDisplayName },
              idem: makeIdempotencyKey("mcp_agents_register_payee")
            });
            const payerAgentId = payer?.agentIdentity?.agentId;
            const payeeAgentId = payee?.agentIdentity?.agentId;
            assertNonEmptyString(payerAgentId, "payerAgentId");
            assertNonEmptyString(payeeAgentId, "payeeAgentId");

            // Fund payer so escrow can lock later.
            await client.requestJson(`/agents/${encodeURIComponent(payerAgentId)}/wallet/credit`, {
              method: "POST",
              write: true,
              body: { amountCents: amountCents * 2, currency },
              idem: makeIdempotencyKey("mcp_wallet_credit")
            });

            // Create RFQ.
            const rfqOut = await client.requestJson("/marketplace/rfqs", {
              method: "POST",
              body: {
                title,
                description,
                capability,
                posterAgentId: payerAgentId,
                budgetCents: amountCents,
                currency,
                metadata: { source: "mcp_spike" }
              },
              idem: makeIdempotencyKey("mcp_rfq")
            });
            const rfqId = rfqOut?.rfq?.rfqId;
            assertNonEmptyString(rfqId, "rfqId");

            // Submit bid.
            const bidOut = await client.requestJson(`/marketplace/rfqs/${encodeURIComponent(rfqId)}/bids`, {
              method: "POST",
              body: {
                bidderAgentId: payeeAgentId,
                amountCents,
                currency,
                etaSeconds: 60,
                note: "MCP spike bid"
              },
              idem: makeIdempotencyKey("mcp_bid")
            });
            const bidId = bidOut?.bid?.bidId;
            assertNonEmptyString(bidId, "bidId");

            // Accept bid => creates run + settlement + agreement.
            const acceptOut = await client.requestJson(`/marketplace/rfqs/${encodeURIComponent(rfqId)}/accept`, {
              method: "POST",
              body: {
                bidId,
                payerAgentId,
                disputeWindowDays,
                settlement: { payerAgentId }
              },
              idem: makeIdempotencyKey("mcp_accept")
            });
            const runId = acceptOut?.run?.runId ?? acceptOut?.run?.id ?? acceptOut?.run?.runId;
            const settlementId = acceptOut?.settlement?.settlementId ?? null;
            const agreementId = acceptOut?.agreement?.agreementId ?? acceptOut?.agreement?.id ?? null;

            result = {
              ok: true,
              payerAgentId,
              payeeAgentId,
              rfqId,
              bidId,
              runId,
              settlementId,
              agreementId,
              raw: redactSecrets(acceptOut)
            };
          } else if (name === "settld.x402_gate_create") {
            const gateId = args?.gateId ? String(args.gateId).trim() : `x402gate_mcp_${crypto.randomUUID()}`;
            const payerAgentId = args?.payerAgentId ? String(args.payerAgentId).trim() : `agt_x402_payer_${crypto.randomUUID()}`;
            const payeeAgentId = args?.payeeAgentId ? String(args.payeeAgentId).trim() : `agt_x402_payee_${crypto.randomUUID()}`;
            assertNonEmptyString(gateId, "gateId");
            assertNonEmptyString(payerAgentId, "payerAgentId");
            assertNonEmptyString(payeeAgentId, "payeeAgentId");
            if (payerAgentId === payeeAgentId) throw new TypeError("payerAgentId and payeeAgentId must differ");

            const amountCents = Number(args?.amountCents ?? 500);
            if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new TypeError("amountCents must be a positive safe integer");
            const currency = args?.currency ? String(args.currency).trim().toUpperCase() : "USD";
            assertNonEmptyString(currency, "currency");

            const autoFundRaw = args?.autoFundPayerCents ?? amountCents;
            const autoFundPayerCents = Number(autoFundRaw);
            if (!Number.isSafeInteger(autoFundPayerCents) || autoFundPayerCents < 0) {
              throw new TypeError("autoFundPayerCents must be a non-negative safe integer");
            }

            const idempotencyKey =
              typeof args?.idempotencyKey === "string" && args.idempotencyKey.trim() !== ""
                ? args.idempotencyKey.trim()
                : makeIdempotencyKey("mcp_x402_gate_create");

            const body = {
              gateId,
              payerAgentId,
              payeeAgentId,
              amountCents,
              currency,
              autoFundPayerCents
            };
            if (typeof args?.toolId === "string" && args.toolId.trim() !== "") body.toolId = args.toolId.trim();
            if (typeof args?.delegationGrantRef === "string" && args.delegationGrantRef.trim() !== "") {
              body.delegationGrantRef = args.delegationGrantRef.trim();
            }
            const out = await client.requestJson("/x402/gate/create", {
              method: "POST",
              write: true,
              body,
              idem: idempotencyKey
            });
            result = {
              ok: true,
              gateId,
              payerAgentId,
              payeeAgentId,
              idempotencyKey,
              ...redactSecrets(out)
            };
          } else if (name === "settld.agreement_delegation_create") {
            const parentAgreementHash = String(args?.parentAgreementHash ?? "").trim().toLowerCase();
            const childAgreementHash = String(args?.childAgreementHash ?? "").trim().toLowerCase();
            if (!isSha256Hex(parentAgreementHash)) throw new TypeError("parentAgreementHash must be a sha256 hex string");
            if (!isSha256Hex(childAgreementHash)) throw new TypeError("childAgreementHash must be a sha256 hex string");
            const delegatorAgentId = String(args?.delegatorAgentId ?? "").trim();
            const delegateeAgentId = String(args?.delegateeAgentId ?? "").trim();
            assertNonEmptyString(delegatorAgentId, "delegatorAgentId");
            assertNonEmptyString(delegateeAgentId, "delegateeAgentId");
            const budgetCapCents = Number(args?.budgetCapCents);
            if (!Number.isSafeInteger(budgetCapCents) || budgetCapCents <= 0) {
              throw new TypeError("budgetCapCents must be a positive safe integer");
            }
            const currency = args?.currency ? String(args.currency).trim().toUpperCase() : "USD";
            assertNonEmptyString(currency, "currency");

            const idempotencyKey =
              typeof args?.idempotencyKey === "string" && args.idempotencyKey.trim() !== ""
                ? args.idempotencyKey.trim()
                : makeIdempotencyKey("mcp_agreement_delegation_create");

            const body = {
              childAgreementHash,
              delegatorAgentId,
              delegateeAgentId,
              budgetCapCents,
              currency
            };
            if (typeof args?.delegationId === "string" && args.delegationId.trim() !== "") body.delegationId = args.delegationId.trim();
            if (Number.isSafeInteger(Number(args?.delegationDepth)) && Number(args.delegationDepth) > 0) {
              body.delegationDepth = Number(args.delegationDepth);
            }
            if (Number.isSafeInteger(Number(args?.maxDelegationDepth)) && Number(args.maxDelegationDepth) > 0) {
              body.maxDelegationDepth = Number(args.maxDelegationDepth);
            }
            if (Array.isArray(args?.ancestorChain)) {
              body.ancestorChain = args.ancestorChain.map((v) => String(v ?? "").trim()).filter(Boolean);
            }

            const out = await client.requestJson(`/agreements/${encodeURIComponent(parentAgreementHash)}/delegations`, {
              method: "POST",
              write: true,
              body,
              idem: idempotencyKey
            });
            result = {
              ok: true,
              parentAgreementHash,
              idempotencyKey,
              ...redactSecrets(out)
            };
          } else if (name === "settld.agreement_delegation_list") {
            const agreementHash = String(args?.agreementHash ?? "").trim().toLowerCase();
            if (!isSha256Hex(agreementHash)) throw new TypeError("agreementHash must be a sha256 hex string");
            const query = new URLSearchParams();
            if (typeof args?.status === "string" && args.status.trim() !== "") query.set("status", args.status.trim());
            if (Number.isSafeInteger(Number(args?.limit)) && Number(args.limit) > 0) query.set("limit", String(Number(args.limit)));
            if (Number.isSafeInteger(Number(args?.offset)) && Number(args.offset) >= 0) query.set("offset", String(Number(args.offset)));
            const path = `/agreements/${encodeURIComponent(agreementHash)}/delegations${query.toString() ? `?${query.toString()}` : ""}`;
            const out = await client.requestJson(path, { method: "GET" });
            result = { ok: true, agreementHash, ...redactSecrets(out) };
          } else if (name === "settld.delegation_grant_issue") {
            const delegatorAgentId = String(args?.delegatorAgentId ?? "").trim();
            const delegateeAgentId = String(args?.delegateeAgentId ?? "").trim();
            assertNonEmptyString(delegatorAgentId, "delegatorAgentId");
            assertNonEmptyString(delegateeAgentId, "delegateeAgentId");
            const maxPerCallCents = Number(args?.maxPerCallCents);
            if (!Number.isSafeInteger(maxPerCallCents) || maxPerCallCents < 0) {
              throw new TypeError("maxPerCallCents must be a non-negative safe integer");
            }
            const maxTotalCents = Number(args?.maxTotalCents);
            if (!Number.isSafeInteger(maxTotalCents) || maxTotalCents < 0) {
              throw new TypeError("maxTotalCents must be a non-negative safe integer");
            }

            const idempotencyKey =
              typeof args?.idempotencyKey === "string" && args.idempotencyKey.trim() !== ""
                ? args.idempotencyKey.trim()
                : makeIdempotencyKey("mcp_delegation_grant_issue");

            const body = {
              delegatorAgentId,
              delegateeAgentId,
              scope: {
                allowedRiskClasses: Array.isArray(args?.allowedRiskClasses)
                  ? args.allowedRiskClasses.map((v) => String(v ?? "").trim().toLowerCase()).filter(Boolean)
                  : ["financial"],
                sideEffectingAllowed: args?.sideEffectingAllowed !== false
              },
              spendLimit: {
                currency: args?.currency ? String(args.currency).trim().toUpperCase() : "USD",
                maxPerCallCents,
                maxTotalCents
              },
              chainBinding: {
                rootGrantHash: typeof args?.rootGrantHash === "string" && args.rootGrantHash.trim() !== "" ? args.rootGrantHash.trim() : null,
                parentGrantHash:
                  typeof args?.parentGrantHash === "string" && args.parentGrantHash.trim() !== "" ? args.parentGrantHash.trim() : null,
                depth: Number.isSafeInteger(Number(args?.depth)) ? Number(args.depth) : 0,
                maxDelegationDepth:
                  Number.isSafeInteger(Number(args?.maxDelegationDepth)) && Number(args.maxDelegationDepth) >= 0
                    ? Number(args.maxDelegationDepth)
                    : Number.isSafeInteger(Number(args?.depth))
                      ? Number(args.depth)
                      : 0
              },
              validity: {
                ...(typeof args?.issuedAt === "string" && args.issuedAt.trim() !== "" ? { issuedAt: args.issuedAt.trim() } : {}),
                ...(typeof args?.notBefore === "string" && args.notBefore.trim() !== "" ? { notBefore: args.notBefore.trim() } : {}),
                ...(typeof args?.expiresAt === "string" && args.expiresAt.trim() !== "" ? { expiresAt: args.expiresAt.trim() } : {})
              },
              revocation: {
                revocable: args?.revocable !== false
              }
            };
            if (typeof args?.grantId === "string" && args.grantId.trim() !== "") body.grantId = args.grantId.trim();
            if (Array.isArray(args?.allowedProviderIds)) {
              body.scope.allowedProviderIds = args.allowedProviderIds.map((v) => String(v ?? "").trim()).filter(Boolean);
            }
            if (Array.isArray(args?.allowedToolIds)) {
              body.scope.allowedToolIds = args.allowedToolIds.map((v) => String(v ?? "").trim()).filter(Boolean);
            }
            if (args?.metadata && typeof args.metadata === "object" && !Array.isArray(args.metadata)) {
              body.metadata = args.metadata;
            }

            const out = await client.requestJson("/delegation-grants", {
              method: "POST",
              write: true,
              body,
              idem: idempotencyKey
            });
            result = { ok: true, idempotencyKey, ...redactSecrets(out) };
          } else if (name === "settld.delegation_grant_get") {
            const grantId = String(args?.grantId ?? "").trim();
            assertNonEmptyString(grantId, "grantId");
            const out = await client.requestJson(`/delegation-grants/${encodeURIComponent(grantId)}`, { method: "GET" });
            result = { ok: true, grantId, ...redactSecrets(out) };
          } else if (name === "settld.delegation_grant_list") {
            const query = new URLSearchParams();
            if (typeof args?.grantId === "string" && args.grantId.trim() !== "") query.set("grantId", args.grantId.trim());
            if (typeof args?.grantHash === "string" && args.grantHash.trim() !== "") query.set("grantHash", args.grantHash.trim().toLowerCase());
            if (typeof args?.delegatorAgentId === "string" && args.delegatorAgentId.trim() !== "") {
              query.set("delegatorAgentId", args.delegatorAgentId.trim());
            }
            if (typeof args?.delegateeAgentId === "string" && args.delegateeAgentId.trim() !== "") {
              query.set("delegateeAgentId", args.delegateeAgentId.trim());
            }
            if (typeof args?.includeRevoked === "boolean") query.set("includeRevoked", args.includeRevoked ? "true" : "false");
            if (Number.isSafeInteger(Number(args?.limit)) && Number(args.limit) > 0) query.set("limit", String(Number(args.limit)));
            if (Number.isSafeInteger(Number(args?.offset)) && Number(args.offset) >= 0) query.set("offset", String(Number(args.offset)));
            const out = await client.requestJson(`/delegation-grants${query.toString() ? `?${query.toString()}` : ""}`, { method: "GET" });
            result = { ok: true, ...redactSecrets(out) };
          } else if (name === "settld.delegation_grant_revoke") {
            const grantId = String(args?.grantId ?? "").trim();
            assertNonEmptyString(grantId, "grantId");
            const idempotencyKey =
              typeof args?.idempotencyKey === "string" && args.idempotencyKey.trim() !== ""
                ? args.idempotencyKey.trim()
                : makeIdempotencyKey("mcp_delegation_grant_revoke");
            const body = {};
            if (typeof args?.revocationReasonCode === "string" && args.revocationReasonCode.trim() !== "") {
              body.revocationReasonCode = args.revocationReasonCode.trim();
            }
            const out = await client.requestJson(`/delegation-grants/${encodeURIComponent(grantId)}/revoke`, {
              method: "POST",
              write: true,
              body,
              idem: idempotencyKey
            });
            result = { ok: true, grantId, idempotencyKey, ...redactSecrets(out) };
          } else if (name === "settld.agent_card_upsert") {
            const agentId = String(args?.agentId ?? "").trim();
            assertNonEmptyString(agentId, "agentId");
            const idempotencyKey =
              typeof args?.idempotencyKey === "string" && args.idempotencyKey.trim() !== ""
                ? args.idempotencyKey.trim()
                : makeIdempotencyKey("mcp_agent_card_upsert");

            const body = { agentId };
            if (typeof args?.displayName === "string" && args.displayName.trim() !== "") body.displayName = args.displayName.trim();
            if (typeof args?.description === "string" && args.description.trim() !== "") body.description = args.description.trim();
            if (Array.isArray(args?.capabilities)) body.capabilities = args.capabilities.map((v) => String(v ?? "").trim()).filter(Boolean);
            if (typeof args?.visibility === "string" && args.visibility.trim() !== "") body.visibility = args.visibility.trim().toLowerCase();
            if (typeof args?.hostRuntime === "string" && args.hostRuntime.trim() !== "") {
              body.host = body.host && typeof body.host === "object" ? body.host : {};
              body.host.runtime = args.hostRuntime.trim();
            }
            if (typeof args?.hostEndpoint === "string" && args.hostEndpoint.trim() !== "") {
              body.host = body.host && typeof body.host === "object" ? body.host : {};
              body.host.endpoint = args.hostEndpoint.trim();
            }
            if (Array.isArray(args?.hostProtocols)) {
              body.host = body.host && typeof body.host === "object" ? body.host : {};
              body.host.protocols = args.hostProtocols.map((v) => String(v ?? "").trim()).filter(Boolean);
            }
            if (args?.priceHint && typeof args.priceHint === "object" && !Array.isArray(args.priceHint)) {
              const amountCents = Number(args.priceHint.amountCents);
              if (!Number.isSafeInteger(amountCents) || amountCents < 0) {
                throw new TypeError("priceHint.amountCents must be a non-negative safe integer");
              }
              body.priceHint = {
                amountCents,
                currency: typeof args.priceHint.currency === "string" && args.priceHint.currency.trim() !== "" ? args.priceHint.currency.trim() : "USD",
                unit: typeof args.priceHint.unit === "string" && args.priceHint.unit.trim() !== "" ? args.priceHint.unit.trim() : "task"
              };
            }
            if (Array.isArray(args?.attestations)) body.attestations = args.attestations;
            if (Array.isArray(args?.tags)) body.tags = args.tags.map((v) => String(v ?? "").trim()).filter(Boolean);
            if (args?.metadata && typeof args.metadata === "object" && !Array.isArray(args.metadata)) body.metadata = args.metadata;

            const out = await client.requestJson("/agent-cards", {
              method: "POST",
              write: true,
              body,
              idem: idempotencyKey
            });
            result = { ok: true, agentId, idempotencyKey, ...redactSecrets(out) };
          } else if (name === "settld.agent_discover") {
            const query = new URLSearchParams();
            if (typeof args?.capability === "string" && args.capability.trim() !== "") query.set("capability", args.capability.trim());
            if (typeof args?.status === "string" && args.status.trim() !== "") query.set("status", args.status.trim().toLowerCase());
            if (typeof args?.visibility === "string" && args.visibility.trim() !== "") query.set("visibility", args.visibility.trim().toLowerCase());
            if (typeof args?.runtime === "string" && args.runtime.trim() !== "") query.set("runtime", args.runtime.trim().toLowerCase());
            if (typeof args?.requireCapabilityAttestation === "boolean") {
              query.set("requireCapabilityAttestation", args.requireCapabilityAttestation ? "true" : "false");
            }
            if (typeof args?.attestationMinLevel === "string" && args.attestationMinLevel.trim() !== "") {
              query.set("attestationMinLevel", args.attestationMinLevel.trim().toLowerCase());
            }
            if (typeof args?.attestationIssuerAgentId === "string" && args.attestationIssuerAgentId.trim() !== "") {
              query.set("attestationIssuerAgentId", args.attestationIssuerAgentId.trim());
            }
            if (typeof args?.includeAttestationMetadata === "boolean") {
              query.set("includeAttestationMetadata", args.includeAttestationMetadata ? "true" : "false");
            }
            if (Number.isSafeInteger(Number(args?.minTrustScore)) && Number(args.minTrustScore) >= 0 && Number(args.minTrustScore) <= 100) {
              query.set("minTrustScore", String(Number(args.minTrustScore)));
            }
            if (typeof args?.riskTier === "string" && args.riskTier.trim() !== "") query.set("riskTier", args.riskTier.trim().toLowerCase());
            if (typeof args?.includeReputation === "boolean") query.set("includeReputation", args.includeReputation ? "true" : "false");
            if (typeof args?.reputationVersion === "string" && args.reputationVersion.trim() !== "") {
              query.set("reputationVersion", args.reputationVersion.trim().toLowerCase());
            }
            if (typeof args?.reputationWindow === "string" && args.reputationWindow.trim() !== "") {
              query.set("reputationWindow", args.reputationWindow.trim());
            }
            if (typeof args?.scoreStrategy === "string" && args.scoreStrategy.trim() !== "") {
              query.set("scoreStrategy", args.scoreStrategy.trim().toLowerCase());
            }
            if (typeof args?.requesterAgentId === "string" && args.requesterAgentId.trim() !== "") {
              query.set("requesterAgentId", args.requesterAgentId.trim());
            }
            if (typeof args?.includeRoutingFactors === "boolean") {
              query.set("includeRoutingFactors", args.includeRoutingFactors ? "true" : "false");
            }
            if (Number.isSafeInteger(Number(args?.limit)) && Number(args.limit) > 0) query.set("limit", String(Number(args.limit)));
            if (Number.isSafeInteger(Number(args?.offset)) && Number(args.offset) >= 0) query.set("offset", String(Number(args.offset)));
            const out = await client.requestJson(`/agent-cards/discover${query.toString() ? `?${query.toString()}` : ""}`, { method: "GET" });
            result = { ok: true, ...redactSecrets(out) };
          } else if (name === "settld.capability_attest") {
            const subjectAgentId = String(args?.subjectAgentId ?? "").trim();
            const capability = String(args?.capability ?? "").trim();
            assertNonEmptyString(subjectAgentId, "subjectAgentId");
            assertNonEmptyString(capability, "capability");
            const idempotencyKey =
              typeof args?.idempotencyKey === "string" && args.idempotencyKey.trim() !== ""
                ? args.idempotencyKey.trim()
                : makeIdempotencyKey("mcp_capability_attest");
            const body = { subjectAgentId, capability };
            if (typeof args?.attestationId === "string" && args.attestationId.trim() !== "") body.attestationId = args.attestationId.trim();
            if (typeof args?.level === "string" && args.level.trim() !== "") body.level = args.level.trim().toLowerCase();
            if (typeof args?.issuerAgentId === "string" && args.issuerAgentId.trim() !== "") body.issuerAgentId = args.issuerAgentId.trim();
            if (args?.verificationMethod && typeof args.verificationMethod === "object" && !Array.isArray(args.verificationMethod)) {
              body.verificationMethod = args.verificationMethod;
            }
            if (Array.isArray(args?.evidenceRefs)) body.evidenceRefs = args.evidenceRefs.map((v) => String(v ?? "").trim()).filter(Boolean);
            if (args?.metadata && typeof args.metadata === "object" && !Array.isArray(args.metadata)) body.metadata = args.metadata;
            const validity = {};
            if (typeof args?.issuedAt === "string" && args.issuedAt.trim() !== "") validity.issuedAt = args.issuedAt.trim();
            if (typeof args?.notBefore === "string" && args.notBefore.trim() !== "") validity.notBefore = args.notBefore.trim();
            if (typeof args?.expiresAt === "string" && args.expiresAt.trim() !== "") validity.expiresAt = args.expiresAt.trim();
            if (Object.keys(validity).length > 0) body.validity = validity;
            const signature = {};
            if (typeof args?.signatureKeyId === "string" && args.signatureKeyId.trim() !== "") signature.keyId = args.signatureKeyId.trim();
            if (typeof args?.signature === "string" && args.signature.trim() !== "") signature.signature = args.signature.trim();
            if (Object.keys(signature).length > 0) body.signature = signature;
            const out = await client.requestJson("/capability-attestations", {
              method: "POST",
              write: true,
              body,
              idem: idempotencyKey
            });
            result = { ok: true, idempotencyKey, ...redactSecrets(out) };
          } else if (name === "settld.capability_attestation_list") {
            const query = new URLSearchParams();
            if (typeof args?.attestationId === "string" && args.attestationId.trim() !== "") query.set("attestationId", args.attestationId.trim());
            if (typeof args?.subjectAgentId === "string" && args.subjectAgentId.trim() !== "") query.set("subjectAgentId", args.subjectAgentId.trim());
            if (typeof args?.issuerAgentId === "string" && args.issuerAgentId.trim() !== "") query.set("issuerAgentId", args.issuerAgentId.trim());
            if (typeof args?.capability === "string" && args.capability.trim() !== "") query.set("capability", args.capability.trim());
            if (typeof args?.status === "string" && args.status.trim() !== "") query.set("status", args.status.trim().toLowerCase());
            if (typeof args?.at === "string" && args.at.trim() !== "") query.set("at", args.at.trim());
            if (typeof args?.includeInvalid === "boolean") query.set("includeInvalid", args.includeInvalid ? "true" : "false");
            if (Number.isSafeInteger(Number(args?.limit)) && Number(args.limit) > 0) query.set("limit", String(Number(args.limit)));
            if (Number.isSafeInteger(Number(args?.offset)) && Number(args.offset) >= 0) query.set("offset", String(Number(args.offset)));
            const out = await client.requestJson(`/capability-attestations${query.toString() ? `?${query.toString()}` : ""}`, { method: "GET" });
            result = { ok: true, ...redactSecrets(out) };
          } else if (name === "settld.capability_attestation_revoke") {
            const attestationId = String(args?.attestationId ?? "").trim();
            assertNonEmptyString(attestationId, "attestationId");
            const idempotencyKey =
              typeof args?.idempotencyKey === "string" && args.idempotencyKey.trim() !== ""
                ? args.idempotencyKey.trim()
                : makeIdempotencyKey("mcp_capability_attestation_revoke");
            const body = {};
            if (typeof args?.revokedAt === "string" && args.revokedAt.trim() !== "") body.revokedAt = args.revokedAt.trim();
            if (typeof args?.reasonCode === "string" && args.reasonCode.trim() !== "") body.reasonCode = args.reasonCode.trim();
            const out = await client.requestJson(`/capability-attestations/${encodeURIComponent(attestationId)}/revoke`, {
              method: "POST",
              write: true,
              body,
              idem: idempotencyKey
            });
            result = { ok: true, attestationId, idempotencyKey, ...redactSecrets(out) };
          } else if (name === "settld.work_order_create") {
            const principalAgentId = String(args?.principalAgentId ?? "").trim();
            const subAgentId = String(args?.subAgentId ?? "").trim();
            const requiredCapability = String(args?.requiredCapability ?? "").trim();
            assertNonEmptyString(principalAgentId, "principalAgentId");
            assertNonEmptyString(subAgentId, "subAgentId");
            assertNonEmptyString(requiredCapability, "requiredCapability");
            const amountCents = Number(args?.amountCents);
            if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new TypeError("amountCents must be a positive safe integer");
            const idempotencyKey =
              typeof args?.idempotencyKey === "string" && args.idempotencyKey.trim() !== ""
                ? args.idempotencyKey.trim()
                : makeIdempotencyKey("mcp_work_order_create");
            const body = {
              principalAgentId,
              subAgentId,
              requiredCapability,
              pricing: {
                amountCents,
                currency: typeof args?.currency === "string" && args.currency.trim() !== "" ? args.currency.trim() : "USD"
              }
            };
            if (typeof args?.workOrderId === "string" && args.workOrderId.trim() !== "") body.workOrderId = args.workOrderId.trim();
            if (typeof args?.parentTaskId === "string" && args.parentTaskId.trim() !== "") body.parentTaskId = args.parentTaskId.trim();
            if (args?.specification && typeof args.specification === "object" && !Array.isArray(args.specification)) body.specification = args.specification;
            if (typeof args?.quoteId === "string" && args.quoteId.trim() !== "") body.pricing.quoteId = args.quoteId.trim();
            if (args?.constraints && typeof args.constraints === "object" && !Array.isArray(args.constraints)) body.constraints = args.constraints;
            if (args?.evidencePolicy && typeof args.evidencePolicy === "object" && !Array.isArray(args.evidencePolicy)) {
              body.evidencePolicy = args.evidencePolicy;
            }
            if (args?.attestationRequirement && typeof args.attestationRequirement === "object" && !Array.isArray(args.attestationRequirement)) {
              const req = args.attestationRequirement;
              if (typeof req.required !== "boolean") throw new TypeError("attestationRequirement.required must be boolean");
              body.attestationRequirement = { required: req.required };
              if (typeof req.minLevel === "string" && req.minLevel.trim() !== "") {
                body.attestationRequirement.minLevel = req.minLevel.trim().toLowerCase();
              }
              if (typeof req.issuerAgentId === "string" && req.issuerAgentId.trim() !== "") {
                body.attestationRequirement.issuerAgentId = req.issuerAgentId.trim();
              }
            }
            if (typeof args?.requireCapabilityAttestation === "boolean") {
              body.requireCapabilityAttestation = args.requireCapabilityAttestation;
            }
            if (typeof args?.attestationMinLevel === "string" && args.attestationMinLevel.trim() !== "") {
              body.attestationMinLevel = args.attestationMinLevel.trim().toLowerCase();
            }
            if (typeof args?.attestationIssuerAgentId === "string" && args.attestationIssuerAgentId.trim() !== "") {
              body.attestationIssuerAgentId = args.attestationIssuerAgentId.trim();
            }
            if (typeof args?.delegationGrantRef === "string" && args.delegationGrantRef.trim() !== "") {
              body.delegationGrantRef = args.delegationGrantRef.trim();
            }
            if (args?.metadata && typeof args.metadata === "object" && !Array.isArray(args.metadata)) body.metadata = args.metadata;

            const out = await client.requestJson("/work-orders", {
              method: "POST",
              write: true,
              body,
              idem: idempotencyKey
            });
            result = { ok: true, idempotencyKey, ...redactSecrets(out) };
          } else if (name === "settld.work_order_accept") {
            const workOrderId = String(args?.workOrderId ?? "").trim();
            assertNonEmptyString(workOrderId, "workOrderId");
            const idempotencyKey =
              typeof args?.idempotencyKey === "string" && args.idempotencyKey.trim() !== ""
                ? args.idempotencyKey.trim()
                : makeIdempotencyKey("mcp_work_order_accept");
            const body = {};
            if (typeof args?.acceptedByAgentId === "string" && args.acceptedByAgentId.trim() !== "") {
              body.acceptedByAgentId = args.acceptedByAgentId.trim();
            }
            if (typeof args?.acceptedAt === "string" && args.acceptedAt.trim() !== "") body.acceptedAt = args.acceptedAt.trim();
            const out = await client.requestJson(`/work-orders/${encodeURIComponent(workOrderId)}/accept`, {
              method: "POST",
              write: true,
              body,
              idem: idempotencyKey
            });
            result = { ok: true, workOrderId, idempotencyKey, ...redactSecrets(out) };
          } else if (name === "settld.work_order_progress") {
            const workOrderId = String(args?.workOrderId ?? "").trim();
            assertNonEmptyString(workOrderId, "workOrderId");
            const idempotencyKey =
              typeof args?.idempotencyKey === "string" && args.idempotencyKey.trim() !== ""
                ? args.idempotencyKey.trim()
                : makeIdempotencyKey("mcp_work_order_progress");
            const body = {};
            if (typeof args?.progressId === "string" && args.progressId.trim() !== "") body.progressId = args.progressId.trim();
            if (typeof args?.eventType === "string" && args.eventType.trim() !== "") body.eventType = args.eventType.trim();
            if (typeof args?.message === "string" && args.message.trim() !== "") body.message = args.message.trim();
            if (args?.percentComplete !== null && args?.percentComplete !== undefined && args.percentComplete !== "") {
              const percentComplete = Number(args.percentComplete);
              if (!Number.isSafeInteger(percentComplete) || percentComplete < 0 || percentComplete > 100) {
                throw new TypeError("percentComplete must be an integer within 0..100");
              }
              body.percentComplete = percentComplete;
            }
            if (Array.isArray(args?.evidenceRefs)) body.evidenceRefs = args.evidenceRefs.map((v) => String(v ?? "").trim()).filter(Boolean);
            if (typeof args?.at === "string" && args.at.trim() !== "") body.at = args.at.trim();
            const out = await client.requestJson(`/work-orders/${encodeURIComponent(workOrderId)}/progress`, {
              method: "POST",
              write: true,
              body,
              idem: idempotencyKey
            });
            result = { ok: true, workOrderId, idempotencyKey, ...redactSecrets(out) };
          } else if (name === "settld.work_order_complete") {
            const workOrderId = String(args?.workOrderId ?? "").trim();
            assertNonEmptyString(workOrderId, "workOrderId");
            const idempotencyKey =
              typeof args?.idempotencyKey === "string" && args.idempotencyKey.trim() !== ""
                ? args.idempotencyKey.trim()
                : makeIdempotencyKey("mcp_work_order_complete");
            const body = {};
            if (typeof args?.receiptId === "string" && args.receiptId.trim() !== "") body.receiptId = args.receiptId.trim();
            if (typeof args?.status === "string" && args.status.trim() !== "") body.status = args.status.trim().toLowerCase();
            if (Array.isArray(args?.outputs)) body.outputs = args.outputs;
            else if (args?.outputs && typeof args.outputs === "object") body.outputs = args.outputs;
            if (args?.metrics && typeof args.metrics === "object" && !Array.isArray(args.metrics)) body.metrics = args.metrics;
            if (Array.isArray(args?.evidenceRefs)) body.evidenceRefs = args.evidenceRefs.map((v) => String(v ?? "").trim()).filter(Boolean);
            if (args?.amountCents !== null && args?.amountCents !== undefined && args.amountCents !== "") {
              const amountCents = Number(args.amountCents);
              if (!Number.isSafeInteger(amountCents) || amountCents < 0) throw new TypeError("amountCents must be a non-negative safe integer");
              body.amountCents = amountCents;
            }
            if (typeof args?.currency === "string" && args.currency.trim() !== "") body.currency = args.currency.trim();
            if (typeof args?.deliveredAt === "string" && args.deliveredAt.trim() !== "") body.deliveredAt = args.deliveredAt.trim();
            if (typeof args?.completedAt === "string" && args.completedAt.trim() !== "") body.completedAt = args.completedAt.trim();
            if (args?.metadata && typeof args.metadata === "object" && !Array.isArray(args.metadata)) body.metadata = args.metadata;
            const out = await client.requestJson(`/work-orders/${encodeURIComponent(workOrderId)}/complete`, {
              method: "POST",
              write: true,
              body,
              idem: idempotencyKey
            });
            result = { ok: true, workOrderId, idempotencyKey, ...redactSecrets(out) };
          } else if (name === "settld.work_order_settle") {
            const workOrderId = String(args?.workOrderId ?? "").trim();
            const x402GateId = String(args?.x402GateId ?? "").trim();
            const x402RunId = String(args?.x402RunId ?? "").trim();
            assertNonEmptyString(workOrderId, "workOrderId");
            assertNonEmptyString(x402GateId, "x402GateId");
            assertNonEmptyString(x402RunId, "x402RunId");
            const idempotencyKey =
              typeof args?.idempotencyKey === "string" && args.idempotencyKey.trim() !== ""
                ? args.idempotencyKey.trim()
                : makeIdempotencyKey("mcp_work_order_settle");
            const body = { x402GateId, x402RunId };
            if (typeof args?.completionReceiptId === "string" && args.completionReceiptId.trim() !== "") {
              body.completionReceiptId = args.completionReceiptId.trim();
            }
            if (typeof args?.status === "string" && args.status.trim() !== "") body.status = args.status.trim().toLowerCase();
            if (typeof args?.x402SettlementStatus === "string" && args.x402SettlementStatus.trim() !== "") {
              body.x402SettlementStatus = args.x402SettlementStatus.trim().toLowerCase();
            }
            if (typeof args?.x402ReceiptId === "string" && args.x402ReceiptId.trim() !== "") body.x402ReceiptId = args.x402ReceiptId.trim();
            if (typeof args?.completionReceiptHash === "string" && args.completionReceiptHash.trim() !== "") {
              body.completionReceiptHash = args.completionReceiptHash.trim().toLowerCase();
            }
            if (typeof args?.settledAt === "string" && args.settledAt.trim() !== "") body.settledAt = args.settledAt.trim();
            const out = await client.requestJson(`/work-orders/${encodeURIComponent(workOrderId)}/settle`, {
              method: "POST",
              write: true,
              body,
              idem: idempotencyKey
            });
            result = { ok: true, workOrderId, idempotencyKey, ...redactSecrets(out) };
          } else if (name === "settld.x402_gate_verify") {
            const gateId = String(args?.gateId ?? "").trim();
            assertNonEmptyString(gateId, "gateId");
            const ensureAuthorized = args?.ensureAuthorized !== false;

            const verificationStatusRaw = args?.verificationStatus ? String(args.verificationStatus).trim().toLowerCase() : "green";
            if (!["green", "amber", "red"].includes(verificationStatusRaw)) {
              throw new TypeError("verificationStatus must be green|amber|red");
            }
            const verificationStatus = verificationStatusRaw;

            const runStatusRaw = args?.runStatus ? String(args.runStatus).trim().toLowerCase() : "completed";
            if (!["completed", "failed"].includes(runStatusRaw)) {
              throw new TypeError("runStatus must be completed|failed");
            }
            const runStatus = runStatusRaw;

            const requestSha256 = (() => {
              if (typeof args?.requestSha256 === "string" && args.requestSha256.trim() !== "") return args.requestSha256.trim().toLowerCase();
              return sha256HexText(`mcp:x402:request:${gateId}`).toLowerCase();
            })();
            if (!isSha256Hex(requestSha256)) throw new TypeError("requestSha256 must be a sha256 hex string");
            const responseSha256 = (() => {
              if (typeof args?.responseSha256 === "string" && args.responseSha256.trim() !== "") return args.responseSha256.trim().toLowerCase();
              return sha256HexText(`mcp:x402:response:${gateId}`).toLowerCase();
            })();
            if (!isSha256Hex(responseSha256)) throw new TypeError("responseSha256 must be a sha256 hex string");

            const verifyIdempotencyKey =
              typeof args?.idempotencyKey === "string" && args.idempotencyKey.trim() !== ""
                ? args.idempotencyKey.trim()
                : makeIdempotencyKey("mcp_x402_gate_verify");
            const authorizeIdempotencyKey =
              typeof args?.authorizeIdempotencyKey === "string" && args.authorizeIdempotencyKey.trim() !== ""
                ? args.authorizeIdempotencyKey.trim()
                : makeIdempotencyKey("mcp_x402_gate_authorize");

            let authorizeOut = null;
            if (ensureAuthorized) {
              authorizeOut = await client.requestJson("/x402/gate/authorize-payment", {
                method: "POST",
                write: true,
                body: { gateId },
                idem: authorizeIdempotencyKey
              });
            }

            const verifyOut = await client.requestJson("/x402/gate/verify", {
              method: "POST",
              write: true,
              body: {
                gateId,
                verificationStatus,
                runStatus,
                policy: {
                  mode: "automatic",
                  rules: {
                    autoReleaseOnGreen: true,
                    greenReleaseRatePct: 100,
                    autoReleaseOnAmber: false,
                    amberReleaseRatePct: 0,
                    autoReleaseOnRed: true,
                    redReleaseRatePct: 0
                  }
                },
                verificationMethod: { mode: "deterministic", source: "mcp_x402_gate_verify_v1" },
                evidenceRefs: [`http:request_sha256:${requestSha256}`, `http:response_sha256:${responseSha256}`]
              },
              idem: verifyIdempotencyKey
            });

            result = {
              ok: true,
              gateId,
              ensureAuthorized,
              authorizeIdempotencyKey: ensureAuthorized ? authorizeIdempotencyKey : null,
              idempotencyKey: verifyIdempotencyKey,
              requestSha256,
              responseSha256,
              authorize: authorizeOut ? redactSecrets(authorizeOut) : null,
              verify: redactSecrets(verifyOut)
            };
          } else if (name === "settld.x402_gate_get") {
            const gateId = String(args?.gateId ?? "").trim();
            assertNonEmptyString(gateId, "gateId");
            const out = await client.requestJson(`/x402/gate/${encodeURIComponent(gateId)}`, { method: "GET" });
            result = { ok: true, gateId, ...redactSecrets(out) };
          } else if (name === "settld.submit_evidence") {
            const agentId = String(args?.agentId ?? "").trim();
            const runId = String(args?.runId ?? "").trim();
            const evidenceRef = String(args?.evidenceRef ?? "").trim();
            assertNonEmptyString(agentId, "agentId");
            assertNonEmptyString(runId, "runId");
            assertNonEmptyString(evidenceRef, "evidenceRef");

            const head = await client.getRunPrevChainHash({ agentId, runId });
            const out = await client.requestJson(`/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}/events`, {
              method: "POST",
              write: true,
              headers: { "x-proxy-expected-prev-chain-hash": head.prevChainHash === null ? "null" : String(head.prevChainHash) },
              // Note: event schemaVersion is an integer (default=1). Omit to use the default.
              body: { type: "EVIDENCE_ADDED", payload: { evidenceRef } },
              idem: makeIdempotencyKey("mcp_run_event_evidence")
            });
            result = { ok: true, ...redactSecrets(out) };
          } else if (name === "settld.settle_run") {
            const agentId = String(args?.agentId ?? "").trim();
            const runId = String(args?.runId ?? "").trim();
            assertNonEmptyString(agentId, "agentId");
            assertNonEmptyString(runId, "runId");

            const outcome = args?.outcome ? String(args.outcome).trim().toLowerCase() : "completed";
            if (outcome !== "completed" && outcome !== "failed") throw new TypeError("outcome must be completed|failed");

            const head = await client.getRunPrevChainHash({ agentId, runId });
            const body =
              outcome === "completed"
                ? { type: "RUN_COMPLETED", payload: { outputRef: args?.outputRef ?? null, metrics: null } }
                : { type: "RUN_FAILED", payload: { code: args?.errorCode ?? null, message: args?.errorMessage ?? null } };

            const out = await client.requestJson(`/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}/events`, {
              method: "POST",
              write: true,
              headers: { "x-proxy-expected-prev-chain-hash": head.prevChainHash === null ? "null" : String(head.prevChainHash) },
              body,
              idem: makeIdempotencyKey("mcp_run_event_terminal")
            });
            let settlement = null;
            try {
              settlement = await client.requestJson(`/runs/${encodeURIComponent(runId)}/settlement`, { method: "GET" });
            } catch {
              settlement = null;
            }
            result = { ok: true, ...redactSecrets(out), settlement };
          } else if (name === "settld.open_dispute") {
            const runId = String(args?.runId ?? "").trim();
            assertNonEmptyString(runId, "runId");
            const evidenceRefs = Array.isArray(args?.evidenceRefs) ? args.evidenceRefs.map((v) => String(v ?? "").trim()).filter(Boolean) : [];

            const waitMsRaw = args?.waitMs ?? 0;
            const waitMs = Number(waitMsRaw);
            if (!Number.isSafeInteger(waitMs) || waitMs < 0) throw new TypeError("waitMs must be a non-negative safe integer");
            const deadline = nowMs() + Math.min(waitMs, 60_000);

            if (waitMs > 0) {
              // Wait for settlement resolution so `open` doesn't immediately 409 on interactive demos.
              // (The API requires settlement.status != locked to open a dispute.)
              // eslint-disable-next-line no-constant-condition
              while (true) {
                let settlement = null;
                try {
                  settlement = await client.requestJson(`/runs/${encodeURIComponent(runId)}/settlement`, { method: "GET" });
                } catch {
                  settlement = null;
                }
                const status = String(settlement?.status ?? "").toLowerCase();
                if (status && status !== "locked") break;
                if (nowMs() >= deadline) break;
                await sleep(500);
              }
            }
            const out = await client.requestJson(`/runs/${encodeURIComponent(runId)}/dispute/open`, {
              method: "POST",
              write: true,
              body: {
                reason: args?.reason ?? null,
                evidenceRefs,
                disputeType: args?.disputeType ?? null,
                disputePriority: args?.priority ?? null,
                disputeChannel: args?.channel ?? null
              },
              idem: makeIdempotencyKey("mcp_dispute_open")
            });
            result = { ok: true, ...redactSecrets(out) };
          } else if (name === "settld.dispute_add_evidence") {
            const runId = String(args?.runId ?? "").trim();
            const evidenceRef = String(args?.evidenceRef ?? "").trim();
            assertNonEmptyString(runId, "runId");
            assertNonEmptyString(evidenceRef, "evidenceRef");
            const idempotencyKey =
              typeof args?.idempotencyKey === "string" && args.idempotencyKey.trim() !== ""
                ? args.idempotencyKey.trim()
                : makeIdempotencyKey("mcp_dispute_evidence");
            const out = await client.requestJson(`/runs/${encodeURIComponent(runId)}/dispute/evidence`, {
              method: "POST",
              write: true,
              body: {
                disputeId: args?.disputeId ?? null,
                evidenceRef,
                submittedByAgentId: args?.submittedByAgentId ?? null,
                reason: args?.reason ?? null
              },
              idem: idempotencyKey
            });
            result = { ok: true, runId, idempotencyKey, ...redactSecrets(out) };
          } else if (name === "settld.dispute_escalate") {
            const runId = String(args?.runId ?? "").trim();
            assertNonEmptyString(runId, "runId");
            const escalationLevel = String(args?.escalationLevel ?? "").trim().toLowerCase();
            if (!["l1_counterparty", "l2_arbiter", "l3_external"].includes(escalationLevel)) {
              throw new TypeError("escalationLevel must be l1_counterparty|l2_arbiter|l3_external");
            }
            const idempotencyKey =
              typeof args?.idempotencyKey === "string" && args.idempotencyKey.trim() !== ""
                ? args.idempotencyKey.trim()
                : makeIdempotencyKey("mcp_dispute_escalate");
            const out = await client.requestJson(`/runs/${encodeURIComponent(runId)}/dispute/escalate`, {
              method: "POST",
              write: true,
              body: {
                disputeId: args?.disputeId ?? null,
                escalationLevel,
                channel: args?.channel ?? null,
                escalatedByAgentId: args?.escalatedByAgentId ?? null,
                reason: args?.reason ?? null
              },
              idem: idempotencyKey
            });
            result = { ok: true, runId, idempotencyKey, ...redactSecrets(out) };
          } else if (name === "settld.dispute_close") {
            const runId = String(args?.runId ?? "").trim();
            assertNonEmptyString(runId, "runId");
            const idempotencyKey =
              typeof args?.idempotencyKey === "string" && args.idempotencyKey.trim() !== ""
                ? args.idempotencyKey.trim()
                : makeIdempotencyKey("mcp_dispute_close");
            const out = await client.requestJson(`/runs/${encodeURIComponent(runId)}/dispute/close`, {
              method: "POST",
              write: true,
              body: {
                disputeId: args?.disputeId ?? null,
                resolution: args?.resolution ?? null,
                verdict: args?.verdict ?? null,
                arbitrationVerdict: args?.arbitrationVerdict ?? null
              },
              idem: idempotencyKey
            });
            result = { ok: true, runId, idempotencyKey, ...redactSecrets(out) };
          } else if (name === "settld.arbitration_open") {
            const runId = String(args?.runId ?? "").trim();
            assertNonEmptyString(runId, "runId");
            const idempotencyKey =
              typeof args?.idempotencyKey === "string" && args.idempotencyKey.trim() !== ""
                ? args.idempotencyKey.trim()
                : makeIdempotencyKey("mcp_arbitration_open");
            const panelCandidateAgentIds = Array.isArray(args?.panelCandidateAgentIds)
              ? args.panelCandidateAgentIds.map((v) => String(v ?? "").trim()).filter(Boolean)
              : null;
            const evidenceRefs = Array.isArray(args?.evidenceRefs) ? args.evidenceRefs.map((v) => String(v ?? "").trim()).filter(Boolean) : null;
            const out = await client.requestJson(`/runs/${encodeURIComponent(runId)}/arbitration/open`, {
              method: "POST",
              write: true,
              body: {
                caseId: args?.caseId ?? null,
                disputeId: args?.disputeId ?? null,
                arbiterAgentId: args?.arbiterAgentId ?? null,
                panelCandidateAgentIds,
                evidenceRefs,
                summary: args?.summary ?? null
              },
              idem: idempotencyKey
            });
            result = { ok: true, runId, idempotencyKey, ...redactSecrets(out) };
          } else if (name === "settld.arbitration_issue_verdict") {
            const runId = String(args?.runId ?? "").trim();
            const caseId = String(args?.caseId ?? "").trim();
            assertNonEmptyString(runId, "runId");
            assertNonEmptyString(caseId, "caseId");
            if (!args?.arbitrationVerdict || typeof args.arbitrationVerdict !== "object" || Array.isArray(args.arbitrationVerdict)) {
              throw new TypeError("arbitrationVerdict must be an object");
            }
            const idempotencyKey =
              typeof args?.idempotencyKey === "string" && args.idempotencyKey.trim() !== ""
                ? args.idempotencyKey.trim()
                : makeIdempotencyKey("mcp_arbitration_verdict");
            const out = await client.requestJson(`/runs/${encodeURIComponent(runId)}/arbitration/verdict`, {
              method: "POST",
              write: true,
              body: {
                caseId,
                arbitrationVerdict: args.arbitrationVerdict
              },
              idem: idempotencyKey
            });
            result = { ok: true, runId, caseId, idempotencyKey, ...redactSecrets(out) };
          } else if (name === "settld.resolve_settlement") {
            const runId = String(args?.runId ?? "").trim();
            assertNonEmptyString(runId, "runId");
            const status = args?.status ? String(args.status).trim().toLowerCase() : "released";
            if (status !== "released" && status !== "refunded") throw new TypeError("status must be released|refunded");

            const out = await client.requestJson(`/runs/${encodeURIComponent(runId)}/settlement/resolve`, {
              method: "POST",
              write: true,
              body: {
                status,
                releaseRatePct: args?.releaseRatePct ?? null,
                releasedAmountCents: args?.releasedAmountCents ?? null,
                refundedAmountCents: args?.refundedAmountCents ?? null,
                reason: args?.reason ?? null,
                resolvedByAgentId: args?.resolvedByAgentId ?? null
              },
              idem: makeIdempotencyKey("mcp_settlement_resolve")
            });
            result = { ok: true, ...redactSecrets(out) };
          } else {
            throw new Error(`tool not implemented: ${name}`);
          }

          const durationMs = nowMs() - started;
          const toolResult = { ...asTextResult({ tool: name, durationMs, result }), isError: false };
          if (!isNotification) stream.send({ jsonrpc: "2.0", id, result: toolResult });
        } catch (err) {
          const durationMs = nowMs() - started;
          const toolResult = { ...asErrorResult(err), content: [contentText(JSON.stringify({ tool: name, durationMs, error: err?.message ?? String(err) }, null, 2))] };
          if (!isNotification) stream.send({ jsonrpc: "2.0", id, result: toolResult });
        }
        return;
      }

      // Unknown method.
      if (!isNotification) {
        stream.send({ jsonrpc: "2.0", id, error: jsonRpcError(-32601, `Method not found: ${method}`) });
      }
    } catch (err) {
      if (!isNotification) {
        stream.send({ jsonrpc: "2.0", id, error: jsonRpcError(-32603, "Internal error", { message: err?.message ?? String(err) }) });
      }
    }
  });
}

main().catch((err) => {
  process.stderr.write(`[mcp] fatal: ${err?.stack || err?.message || String(err)}\n`);
  process.exitCode = 1;
});
