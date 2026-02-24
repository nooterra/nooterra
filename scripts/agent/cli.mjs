#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";

const FORMAT_OPTIONS = new Set(["json", "text"]);
const VISIBILITY_OPTIONS = new Set(["public", "tenant", "private"]);

const SCHEMAS = Object.freeze({
  PUBLISH_OUTPUT: "AgentPublishOutput.v1",
  DISCOVER_OUTPUT: "AgentDiscoverOutput.v1",
  LISTING_BOND_MINT_OUTPUT: "AgentListingBondMintOutput.v1"
});

function usage() {
  return [
    "usage:",
    "  settld agent publish --agent-id <id> --display-name <name> [options]",
    "  settld agent discover --capability <name> [options]",
    "  settld agent listing-bond mint --agent-id <id> [options]",
    "",
    "common options:",
    "  --base-url <url>            Settld API base URL (or SETTLD_BASE_URL/SETTLD_API_URL)",
    "  --tenant-id <id>            Tenant ID (or SETTLD_TENANT_ID)",
    "  --api-key <key>             API key / bearer token (or SETTLD_API_KEY/SETTLD_TOKEN)",
    "  --protocol <v>              x-settld-protocol version (default: 1.0)",
    "  --format <json|text>        Output format (default: json)",
    "  --json-out <path>           Write JSON output to file",
    "  --help                      Show this help",
    "",
    "publish options:",
    "  --description <text>",
    "  --capabilities <csv>         Comma-separated capability names",
    "  --visibility <public|tenant|private> (default: public)",
    "  --runtime <name>             Host runtime name (ex: openclaw, codex)",
    "  --endpoint <url>             Host endpoint URL",
    "  --protocols <csv>            Host protocols list (ex: mcp,http)",
    "  --price-cents <int>          priceHint amount (cents)",
    "  --price-currency <code>      priceHint currency (default: USD)",
    "  --price-unit <unit>          priceHint unit (default: task)",
    "  --tags <csv>                 Comma-separated tags",
    "  --listing-bond-file <path>   Attach ListingBond.v1 JSON to satisfy bond enforcement",
    "  --listing-bond-json <json>   Attach ListingBond.v1 JSON inline",
    "  --idempotency-key <key>      Override idempotency key (default: deterministic by payload)",
    "",
    "discover options:",
    "  --visibility <public|tenant|private|all> (default: public)",
    "  --runtime <name>",
    "  --status <active|suspended|revoked|all> (default: active)",
    "  --min-trust-score <n>",
    "  --limit <n> (default: 10)",
    "  --offset <n> (default: 0)",
    "  --include-routing-factors    Include routingFactors in results (debug)",
    "  --require-capability-attestation",
    "  --attestation-min-level <level>",
    "  --attestation-issuer-agent-id <id>"
  ].join("\n");
}

function fail(message) {
  throw new Error(String(message ?? "agent command failed"));
}

function readArgValue(argv, index, rawArg) {
  const arg = String(rawArg ?? "");
  const eq = arg.indexOf("=");
  if (eq >= 0) return { value: arg.slice(eq + 1), nextIndex: index };
  return { value: String(argv[index + 1] ?? ""), nextIndex: index + 1 };
}

function normalizeHttpUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return parsed.toString().replace(/\/+$/, "");
}

function parseCsvList(rawValue) {
  const parts = String(rawValue ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const part of parts) {
    if (seen.has(part)) continue;
    seen.add(part);
    out.push(part);
  }
  return out;
}

function normalizeInteger(value, { field, min = 0 } = {}) {
  const num = Number(value);
  if (!Number.isSafeInteger(num) || num < min) fail(`${field} must be an integer >= ${min}`);
  return num;
}

function sha256Hex(text) {
  return createHash("sha256").update(String(text ?? ""), "utf8").digest("hex");
}

function requiredEnvOrNull(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}

function parseArgs(argv, cwd = process.cwd()) {
  const out = {
    command: String(argv[0] ?? "").trim() || null,
    subcommand: String(argv[1] ?? "").trim() || null,
    baseUrl: null,
    tenantId: null,
    apiKey: null,
    protocol: "1.0",
    format: "json",
    jsonOut: null,
    help: false,
    idempotencyKey: null,
    agentId: null,
    displayName: null,
    description: null,
    capabilities: [],
    visibility: "public",
    runtime: null,
    endpoint: null,
    protocols: [],
    priceCents: null,
    priceCurrency: "USD",
    priceUnit: "task",
    tags: [],
    listingBondFile: null,
    listingBondJson: null,
    discover: {
      capability: null,
      visibility: "public",
      runtime: null,
      status: "active",
      minTrustScore: null,
      limit: 10,
      offset: 0,
      includeRoutingFactors: false,
      requireCapabilityAttestation: false,
      attestationMinLevel: null,
      attestationIssuerAgentId: null
    }
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] ?? "");
    if (!arg) continue;

    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg === "--include-routing-factors") {
      out.discover.includeRoutingFactors = true;
      continue;
    }
    if (arg === "--require-capability-attestation") {
      out.discover.requireCapabilityAttestation = true;
      continue;
    }

    if (arg === "--base-url" || arg.startsWith("--base-url=")) {
      const parsed = readArgValue(argv, i, arg);
      out.baseUrl = parsed.value;
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--tenant-id" || arg.startsWith("--tenant-id=")) {
      const parsed = readArgValue(argv, i, arg);
      out.tenantId = parsed.value;
      i = parsed.nextIndex;
      continue;
    }
    if (
      arg === "--api-key" ||
      arg === "--token" ||
      arg === "--bearer-token" ||
      arg.startsWith("--api-key=") ||
      arg.startsWith("--token=") ||
      arg.startsWith("--bearer-token=")
    ) {
      const parsed = readArgValue(argv, i, arg);
      out.apiKey = parsed.value;
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--protocol" || arg.startsWith("--protocol=")) {
      const parsed = readArgValue(argv, i, arg);
      out.protocol = String(parsed.value ?? "").trim();
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--format" || arg.startsWith("--format=")) {
      const parsed = readArgValue(argv, i, arg);
      out.format = String(parsed.value ?? "").trim().toLowerCase();
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--json-out" || arg.startsWith("--json-out=")) {
      const parsed = readArgValue(argv, i, arg);
      out.jsonOut = path.resolve(cwd, String(parsed.value ?? "").trim());
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--idempotency-key" || arg.startsWith("--idempotency-key=")) {
      const parsed = readArgValue(argv, i, arg);
      out.idempotencyKey = String(parsed.value ?? "").trim();
      i = parsed.nextIndex;
      continue;
    }

    if (arg === "--agent-id" || arg.startsWith("--agent-id=")) {
      const parsed = readArgValue(argv, i, arg);
      out.agentId = String(parsed.value ?? "").trim();
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--display-name" || arg.startsWith("--display-name=")) {
      const parsed = readArgValue(argv, i, arg);
      out.displayName = String(parsed.value ?? "").trim();
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--description" || arg.startsWith("--description=")) {
      const parsed = readArgValue(argv, i, arg);
      out.description = String(parsed.value ?? "");
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--capabilities" || arg.startsWith("--capabilities=")) {
      const parsed = readArgValue(argv, i, arg);
      out.capabilities = parseCsvList(parsed.value);
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--visibility" || arg.startsWith("--visibility=")) {
      const parsed = readArgValue(argv, i, arg);
      out.visibility = String(parsed.value ?? "").trim().toLowerCase();
      out.discover.visibility = out.visibility;
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--runtime" || arg.startsWith("--runtime=")) {
      const parsed = readArgValue(argv, i, arg);
      out.runtime = String(parsed.value ?? "").trim();
      out.discover.runtime = out.runtime;
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--endpoint" || arg.startsWith("--endpoint=")) {
      const parsed = readArgValue(argv, i, arg);
      out.endpoint = String(parsed.value ?? "").trim();
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--protocols" || arg.startsWith("--protocols=")) {
      const parsed = readArgValue(argv, i, arg);
      out.protocols = parseCsvList(parsed.value);
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--price-cents" || arg.startsWith("--price-cents=")) {
      const parsed = readArgValue(argv, i, arg);
      out.priceCents = parsed.value;
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--price-currency" || arg.startsWith("--price-currency=")) {
      const parsed = readArgValue(argv, i, arg);
      out.priceCurrency = String(parsed.value ?? "").trim();
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--price-unit" || arg.startsWith("--price-unit=")) {
      const parsed = readArgValue(argv, i, arg);
      out.priceUnit = String(parsed.value ?? "").trim();
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--tags" || arg.startsWith("--tags=")) {
      const parsed = readArgValue(argv, i, arg);
      out.tags = parseCsvList(parsed.value);
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--listing-bond-file" || arg.startsWith("--listing-bond-file=")) {
      const parsed = readArgValue(argv, i, arg);
      out.listingBondFile = String(parsed.value ?? "").trim();
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--listing-bond-json" || arg.startsWith("--listing-bond-json=")) {
      const parsed = readArgValue(argv, i, arg);
      out.listingBondJson = String(parsed.value ?? "");
      i = parsed.nextIndex;
      continue;
    }

    if (arg === "--capability" || arg.startsWith("--capability=")) {
      const parsed = readArgValue(argv, i, arg);
      out.discover.capability = String(parsed.value ?? "").trim();
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--status" || arg.startsWith("--status=")) {
      const parsed = readArgValue(argv, i, arg);
      out.discover.status = String(parsed.value ?? "").trim().toLowerCase();
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--min-trust-score" || arg.startsWith("--min-trust-score=")) {
      const parsed = readArgValue(argv, i, arg);
      out.discover.minTrustScore = parsed.value;
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--limit" || arg.startsWith("--limit=")) {
      const parsed = readArgValue(argv, i, arg);
      out.discover.limit = parsed.value;
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--offset" || arg.startsWith("--offset=")) {
      const parsed = readArgValue(argv, i, arg);
      out.discover.offset = parsed.value;
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--attestation-min-level" || arg.startsWith("--attestation-min-level=")) {
      const parsed = readArgValue(argv, i, arg);
      out.discover.attestationMinLevel = String(parsed.value ?? "").trim();
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--attestation-issuer-agent-id" || arg.startsWith("--attestation-issuer-agent-id=")) {
      const parsed = readArgValue(argv, i, arg);
      out.discover.attestationIssuerAgentId = String(parsed.value ?? "").trim();
      i = parsed.nextIndex;
      continue;
    }

    // Ignore positional command/subcommand tokens.
    if (i === 0 || i === 1) continue;

    fail(`unknown argument: ${arg}`);
  }

  return out;
}

function resolveRuntimeFromEnv(args) {
  const baseUrl =
    normalizeHttpUrl(args.baseUrl) ??
    normalizeHttpUrl(requiredEnvOrNull("SETTLD_BASE_URL", "SETTLD_API_URL", "SETTLD_RUNTIME_BASE_URL", "SETTLD_RUNTIME_URL"));
  const tenantId = (args.tenantId ?? requiredEnvOrNull("SETTLD_TENANT_ID", "SETTLD_RUNTIME_TENANT_ID")) ?? null;
  const apiKey = (args.apiKey ?? requiredEnvOrNull("SETTLD_API_KEY", "SETTLD_TOKEN", "SETTLD_API_KEY_BEARER")) ?? null;
  if (!baseUrl) fail("baseUrl is required (use --base-url or SETTLD_BASE_URL)");
  if (!tenantId || String(tenantId).trim() === "") fail("tenantId is required (use --tenant-id or SETTLD_TENANT_ID)");
  if (!apiKey || String(apiKey).trim() === "") fail("apiKey is required (use --api-key or SETTLD_API_KEY)");
  return { baseUrl, tenantId: String(tenantId).trim(), apiKey: String(apiKey).trim() };
}

async function readListingBond({ filePath, jsonText } = {}) {
  if (jsonText && String(jsonText).trim() !== "") {
    try {
      return JSON.parse(String(jsonText));
    } catch (err) {
      fail(`--listing-bond-json is not valid JSON: ${err?.message ?? String(err)}`);
    }
  }
  if (filePath && String(filePath).trim() !== "") {
    const fullPath = path.resolve(process.cwd(), String(filePath).trim());
    const text = await fs.readFile(fullPath, "utf8");
    try {
      return JSON.parse(text);
    } catch (err) {
      fail(`--listing-bond-file is not valid JSON: ${err?.message ?? String(err)}`);
    }
  }
  return null;
}

async function fetchJson({ url, method, headers, body }) {
  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === null || body === undefined ? undefined : JSON.stringify(body)
    });
  } catch (err) {
    return { ok: false, statusCode: 0, body: null, error: { message: err?.message ?? "network error", code: "NETWORK_ERROR" } };
  }
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text || null;
  }
  return {
    ok: response.ok,
    statusCode: response.status,
    body: parsed,
    error: response.ok ? null : { message: parsed?.message ?? parsed?.error ?? text ?? `HTTP ${response.status}`, code: parsed?.code ?? null }
  };
}

function renderJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function renderTextPublish(out) {
  const lines = [
    `ok: ${out.ok ? "true" : "false"}`,
    `agentId: ${out.request.agentId}`,
    `visibility: ${out.request.visibility}`
  ];
  if (out.ok && out.agentCard) {
    lines.push(`status: ${out.agentCard.status}`);
    lines.push(`capabilities: ${(out.agentCard.capabilities ?? []).join(",")}`);
  } else if (out.error) {
    lines.push(`errorCode: ${out.error.code ?? "unknown"}`);
    lines.push(`message: ${out.error.message ?? "unknown error"}`);
  }
  return `${lines.join("\n")}\n`;
}

function renderTextDiscover(out) {
  const lines = [
    `ok: ${out.ok ? "true" : "false"}`,
    `capability: ${out.query.capability ?? ""}`,
    `count: ${Array.isArray(out.results?.results) ? out.results.results.length : 0}`
  ];
  if (!out.ok && out.error) {
    lines.push(`errorCode: ${out.error.code ?? "unknown"}`);
    lines.push(`message: ${out.error.message ?? "unknown error"}`);
  }
  return `${lines.join("\n")}\n`;
}

function renderTextListingBondMint(out) {
  const lines = [
    `ok: ${out.ok ? "true" : "false"}`,
    `agentId: ${out.request.agentId}`
  ];
  if (out.ok && out.bond) {
    lines.push(`bondId: ${out.bond.bondId ?? ""}`);
    lines.push(`requiredBondCents: ${out.requirement?.requiredBondCents ?? ""}`);
  } else if (out.error) {
    lines.push(`errorCode: ${out.error.code ?? "unknown"}`);
    lines.push(`message: ${out.error.message ?? "unknown error"}`);
  }
  return `${lines.join("\n")}\n`;
}

async function maybeWriteJsonOut(outPath, value) {
  if (!outPath) return;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(value, null, 2), "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.command) {
    process.stdout.write(`${usage()}\n`);
    process.exit(args.help ? 0 : 1);
  }

  if (!FORMAT_OPTIONS.has(args.format)) fail(`--format must be one of: ${Array.from(FORMAT_OPTIONS).join(", ")}`);

  const { baseUrl, tenantId, apiKey } = resolveRuntimeFromEnv(args);
  const protocol = String(args.protocol ?? "").trim() || "1.0";

  const cmd = args.command;
  const sub = args.subcommand;

  if (cmd === "publish") {
    const agentId = String(args.agentId ?? "").trim();
    if (!agentId) fail("--agent-id is required");
    const displayName = String(args.displayName ?? "").trim();
    if (!displayName) fail("--display-name is required");
    const visibility = String(args.visibility ?? "").trim().toLowerCase();
    if (!VISIBILITY_OPTIONS.has(visibility)) fail("--visibility must be public|tenant|private");

    const capabilities = Array.isArray(args.capabilities) ? args.capabilities : [];
    const tags = Array.isArray(args.tags) ? args.tags : [];
    const hostRuntime = typeof args.runtime === "string" && args.runtime.trim() !== "" ? args.runtime.trim().toLowerCase() : null;
    const endpoint = typeof args.endpoint === "string" && args.endpoint.trim() !== "" ? args.endpoint.trim() : null;
    const hostProtocols = Array.isArray(args.protocols) ? args.protocols : [];

    const listingBond = await readListingBond({ filePath: args.listingBondFile, jsonText: args.listingBondJson });

    const body = {
      agentId,
      displayName,
      ...(args.description ? { description: String(args.description) } : {}),
      ...(capabilities.length > 0 ? { capabilities } : {}),
      visibility,
      ...(hostRuntime || endpoint || hostProtocols.length > 0
        ? {
            host: {
              ...(hostRuntime ? { runtime: hostRuntime } : {}),
              ...(endpoint ? { endpoint } : {}),
              ...(hostProtocols.length > 0 ? { protocols: hostProtocols } : {})
            }
          }
        : {}),
      ...(args.priceCents !== null && args.priceCents !== undefined
        ? {
            priceHint: {
              amountCents: normalizeInteger(args.priceCents, { field: "--price-cents", min: 0 }),
              currency: String(args.priceCurrency ?? "USD").trim().toUpperCase() || "USD",
              unit: String(args.priceUnit ?? "task").trim() || "task"
            }
          }
        : {}),
      ...(tags.length > 0 ? { tags } : {}),
      ...(listingBond ? { listingBond } : {})
    };

    const bodyHash = sha256Hex(JSON.stringify(body));
    const idempotencyKey = args.idempotencyKey || `cli_agent_publish_${agentId}_${bodyHash.slice(0, 16)}`;

    const url = new URL("/agent-cards", baseUrl);
    const response = await fetchJson({
      url,
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "x-proxy-tenant-id": tenantId,
        "x-settld-protocol": protocol,
        "x-idempotency-key": idempotencyKey,
        "content-type": "application/json"
      },
      body
    });

    const out = {
      schemaVersion: SCHEMAS.PUBLISH_OUTPUT,
      ok: response.ok,
      request: {
        baseUrl,
        tenantId,
        agentId,
        visibility
      },
      response: {
        statusCode: response.statusCode,
        code: response.body?.code ?? null
      },
      agentCard: response.ok ? response.body?.agentCard ?? null : null,
      error: response.ok ? null : response.error ?? { code: response.body?.code ?? null, message: response.error?.message ?? null },
      details: response.ok ? null : response.body?.details ?? response.body?.data ?? null
    };

    await maybeWriteJsonOut(args.jsonOut, out);
    process.stdout.write(args.format === "text" ? renderTextPublish(out) : renderJson(out));
    process.exit(response.ok ? 0 : 1);
  }

  if (cmd === "discover") {
    const capability = String(args.discover.capability ?? "").trim();
    if (!capability) fail("--capability is required");

    const limit = normalizeInteger(args.discover.limit, { field: "--limit", min: 1 });
    const offset = normalizeInteger(args.discover.offset, { field: "--offset", min: 0 });
    const status = String(args.discover.status ?? "active").trim().toLowerCase();
    const visibility = String(args.discover.visibility ?? "public").trim().toLowerCase();
    const runtime = typeof args.discover.runtime === "string" && args.discover.runtime.trim() !== "" ? args.discover.runtime.trim().toLowerCase() : null;
    const minTrustScore = args.discover.minTrustScore !== null && args.discover.minTrustScore !== undefined ? Number(args.discover.minTrustScore) : null;
    if (minTrustScore !== null && (!Number.isFinite(minTrustScore) || minTrustScore < 0)) {
      fail("--min-trust-score must be a non-negative number");
    }

    const url = new URL("/agent-cards/discover", baseUrl);
    url.searchParams.set("capability", capability);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));
    if (status) url.searchParams.set("status", status);
    if (visibility) url.searchParams.set("visibility", visibility);
    if (runtime) url.searchParams.set("runtime", runtime);
    if (minTrustScore !== null) url.searchParams.set("minTrustScore", String(minTrustScore));
    if (args.discover.includeRoutingFactors) url.searchParams.set("includeRoutingFactors", "1");
    if (args.discover.requireCapabilityAttestation) url.searchParams.set("requireCapabilityAttestation", "1");
    if (args.discover.attestationMinLevel) url.searchParams.set("attestationMinLevel", args.discover.attestationMinLevel);
    if (args.discover.attestationIssuerAgentId) url.searchParams.set("attestationIssuerAgentId", args.discover.attestationIssuerAgentId);

    const response = await fetchJson({
      url,
      method: "GET",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "x-proxy-tenant-id": tenantId,
        "x-settld-protocol": protocol
      },
      body: null
    });

    const out = {
      schemaVersion: SCHEMAS.DISCOVER_OUTPUT,
      ok: response.ok,
      query: {
        baseUrl,
        tenantId,
        capability,
        status,
        visibility,
        runtime,
        minTrustScore,
        limit,
        offset
      },
      results: response.ok ? response.body : null,
      error: response.ok ? null : response.error
    };

    await maybeWriteJsonOut(args.jsonOut, out);
    process.stdout.write(args.format === "text" ? renderTextDiscover(out) : renderJson(out));
    process.exit(response.ok ? 0 : 1);
  }

  if (cmd === "listing-bond" && sub === "mint") {
    const agentId = String(args.agentId ?? "").trim();
    if (!agentId) fail("--agent-id is required");

    const body = { agentId };
    const bodyHash = sha256Hex(JSON.stringify(body));
    const idempotencyKey = args.idempotencyKey || `cli_agent_listing_bond_${agentId}_${bodyHash.slice(0, 16)}`;

    const url = new URL("/agent-cards/listing-bonds", baseUrl);
    const response = await fetchJson({
      url,
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "x-proxy-tenant-id": tenantId,
        "x-settld-protocol": protocol,
        "x-idempotency-key": idempotencyKey,
        "content-type": "application/json"
      },
      body
    });

    const out = {
      schemaVersion: SCHEMAS.LISTING_BOND_MINT_OUTPUT,
      ok: response.ok,
      request: { baseUrl, tenantId, agentId },
      bond: response.ok ? response.body?.bond ?? null : null,
      requirement: response.ok ? response.body?.requirement ?? null : null,
      error: response.ok ? null : response.error,
      details: response.ok ? null : response.body?.details ?? null
    };

    await maybeWriteJsonOut(args.jsonOut, out);
    process.stdout.write(args.format === "text" ? renderTextListingBondMint(out) : renderJson(out));
    process.exit(response.ok ? 0 : 1);
  }

  process.stderr.write(`${usage()}\n`);
  fail(`unknown agent subcommand: ${cmd}${sub ? ` ${sub}` : ""}`);
}

main().catch((err) => {
  process.stderr.write(`Error: ${err?.message ?? String(err)}\n`);
  process.exit(1);
});
