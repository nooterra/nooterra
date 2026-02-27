#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const out = {
    baseUrl: process.env.NOOTERRA_BASE_URL ?? "http://127.0.0.1:7777",
    tenantId: process.env.NOOTERRA_TENANT_ID ?? "tenant_default",
    principalId: process.env.NOOTERRA_PRINCIPAL_ID ?? null,
    apiKey: process.env.NOOTERRA_API_KEY ?? null,
    opsToken: process.env.NOOTERRA_OPS_TOKEN ?? null,
    sessionId: null,
    sign: false,
    signerKeyId: null,
    includeTranscript: true,
    outPath: null
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] ?? "");
    const next = argv[i + 1];
    if (token === "--base-url" && next) {
      out.baseUrl = String(next);
      i += 1;
    } else if (token === "--tenant-id" && next) {
      out.tenantId = String(next);
      i += 1;
    } else if (token === "--principal-id" && next) {
      out.principalId = String(next);
      i += 1;
    } else if (token === "--api-key" && next) {
      out.apiKey = String(next);
      i += 1;
    } else if (token === "--ops-token" && next) {
      out.opsToken = String(next);
      i += 1;
    } else if (token === "--session-id" && next) {
      out.sessionId = String(next);
      i += 1;
    } else if (token === "--sign") {
      out.sign = true;
    } else if (token === "--no-sign") {
      out.sign = false;
    } else if (token === "--signer-key-id" && next) {
      out.signerKeyId = String(next);
      i += 1;
    } else if (token === "--include-transcript") {
      out.includeTranscript = true;
    } else if (token === "--no-include-transcript") {
      out.includeTranscript = false;
    } else if (token === "--out" && next) {
      out.outPath = String(next);
      i += 1;
    } else if (token === "--help" || token === "-h") {
      out.help = true;
    } else {
      throw new TypeError(`unknown argument: ${token}`);
    }
  }
  return out;
}

function usage() {
  return [
    "Usage:",
    "  node scripts/session/replay-export.mjs --session-id <sessionId> [options]",
    "",
    "Options:",
    "  --base-url <url>             API base URL (default: http://127.0.0.1:7777)",
    "  --tenant-id <tenantId>       Tenant header value",
    "  --principal-id <agentId>     Optional principal header",
    "  --api-key <token>            Optional Bearer token",
    "  --ops-token <token>          Optional ops token header",
    "  --sign | --no-sign           Sign replay/transcript export (default: false)",
    "  --signer-key-id <keyId>      Signer key id (requires --sign)",
    "  --include-transcript | --no-include-transcript (default: include)",
    "  --out <path>                 Write JSON output to file instead of stdout"
  ].join("\n");
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${err?.message ?? String(err)}\n`);
    process.stderr.write(`${usage()}\n`);
    process.exit(2);
  }
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!args.sessionId || args.sessionId.trim() === "") {
    process.stderr.write("sessionId is required (--session-id)\n");
    process.stderr.write(`${usage()}\n`);
    process.exit(2);
  }
  if (!args.sign && args.signerKeyId) {
    process.stderr.write("signerKeyId requires --sign\n");
    process.exit(2);
  }

  const query = new URLSearchParams();
  query.set("sign", String(Boolean(args.sign)));
  query.set("includeTranscript", String(Boolean(args.includeTranscript)));
  if (args.signerKeyId) query.set("signerKeyId", args.signerKeyId);
  const url = new URL(`/sessions/${encodeURIComponent(args.sessionId)}/replay-export?${query.toString()}`, args.baseUrl);
  const headers = {
    accept: "application/json",
    "x-proxy-tenant-id": args.tenantId,
    "x-nooterra-protocol": "1.0",
    "x-request-id": `req_session_replay_export_${Date.now()}`
  };
  if (args.principalId) headers["x-proxy-principal-id"] = args.principalId;
  if (args.apiKey) headers.authorization = `Bearer ${args.apiKey}`;
  if (args.opsToken) headers["x-proxy-ops-token"] = args.opsToken;

  const response = await fetch(url, { method: "GET", headers });
  const payloadText = await response.text();
  let payload = null;
  try {
    payload = payloadText ? JSON.parse(payloadText) : null;
  } catch {
    payload = { raw: payloadText };
  }
  const output = JSON.stringify(payload, null, 2);
  if (!response.ok) {
    process.stderr.write(`${output}\n`);
    process.exit(1);
  }

  if (args.outPath) {
    const absoluteOutPath = path.resolve(process.cwd(), args.outPath);
    fs.mkdirSync(path.dirname(absoluteOutPath), { recursive: true });
    fs.writeFileSync(absoluteOutPath, `${output}\n`, "utf8");
    process.stdout.write(`${absoluteOutPath}\n`);
    return;
  }
  process.stdout.write(`${output}\n`);
}

main().catch((err) => {
  process.stderr.write(`${err?.stack ?? err?.message ?? String(err)}\n`);
  process.exit(1);
});
