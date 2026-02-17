#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function usage() {
  return [
    "Usage:",
    "  node scripts/provider/conformance-run.mjs --manifest <file> --base-url <providerBaseUrl> [options]",
    "",
    "Options:",
    "  --api-url <url>              Settld API base URL (default: SETTLD_API_URL or http://127.0.0.1:3000)",
    "  --api-key <token>            Settld API key (default: SETTLD_API_KEY)",
    "  --tenant-id <id>             Tenant id header (default: SETTLD_TENANT_ID or tenant_default)",
    "  --tool-id <toolId>           Run conformance against a specific tool id",
    "  --provider-id <providerId>   Override provider id (must match manifest.providerId)",
    "  --provider-key-file <path>   Provider signing public key PEM file",
    "  --provider-key-pem <pem>     Provider signing public key PEM inline",
    "  --json-out <file>            Write report JSON to file",
    "  --allow-fail                 Exit 0 even when conformance fails",
    "  --help                       Show this help"
  ].join("\n");
}

function parseArgs(argv) {
  const out = {
    apiUrl: process.env.SETTLD_API_URL || "http://127.0.0.1:3000",
    apiKey: process.env.SETTLD_API_KEY || null,
    tenantId: process.env.SETTLD_TENANT_ID || "tenant_default",
    manifestPath: null,
    baseUrl: null,
    toolId: null,
    providerId: null,
    providerKeyFile: null,
    providerKeyPem: null,
    jsonOut: null,
    allowFail: false,
    help: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] ?? "");
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--allow-fail") out.allowFail = true;
    else if (arg === "--manifest") out.manifestPath = String(argv[++i] ?? "").trim();
    else if (arg === "--base-url") out.baseUrl = String(argv[++i] ?? "").trim();
    else if (arg === "--api-url") out.apiUrl = String(argv[++i] ?? "").trim();
    else if (arg === "--api-key") out.apiKey = String(argv[++i] ?? "").trim();
    else if (arg === "--tenant-id") out.tenantId = String(argv[++i] ?? "").trim();
    else if (arg === "--tool-id") out.toolId = String(argv[++i] ?? "").trim();
    else if (arg === "--provider-id") out.providerId = String(argv[++i] ?? "").trim();
    else if (arg === "--provider-key-file") out.providerKeyFile = String(argv[++i] ?? "").trim();
    else if (arg === "--provider-key-pem") out.providerKeyPem = String(argv[++i] ?? "").trim();
    else if (arg === "--json-out") out.jsonOut = String(argv[++i] ?? "").trim();
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!out.help) {
    if (!out.manifestPath) throw new Error("--manifest is required");
    if (!out.baseUrl) throw new Error("--base-url is required");
  }
  return out;
}

function readJson(filePath) {
  const resolved = path.resolve(process.cwd(), filePath);
  const raw = fs.readFileSync(resolved, "utf8");
  return JSON.parse(raw);
}

function resolveProviderKeyPem({ inlinePem, filePath }) {
  if (typeof inlinePem === "string" && inlinePem.trim() !== "") return inlinePem;
  if (typeof filePath === "string" && filePath.trim() !== "") {
    const resolved = path.resolve(process.cwd(), filePath);
    return fs.readFileSync(resolved, "utf8");
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!args.apiKey) throw new Error("SETTLD_API_KEY or --api-key is required");

  const manifest = readJson(args.manifestPath);
  const providerSigningPublicKeyPem = resolveProviderKeyPem({ inlinePem: args.providerKeyPem, filePath: args.providerKeyFile });
  const response = await fetch(new URL("/marketplace/providers/conformance/run", args.apiUrl), {
    method: "POST",
    headers: {
      authorization: `Bearer ${args.apiKey}`,
      "x-proxy-tenant-id": args.tenantId,
      "content-type": "application/json; charset=utf-8"
    },
    body: JSON.stringify({
      providerId: args.providerId || null,
      baseUrl: args.baseUrl,
      toolId: args.toolId || null,
      providerSigningPublicKeyPem,
      manifest
    })
  });

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!response.ok) {
    throw new Error(`conformance run failed (${response.status}): ${text || "unknown"}`);
  }
  const report = json?.report ?? null;
  if (!report || typeof report !== "object") throw new Error("conformance response missing report");

  if (args.jsonOut) {
    const outPath = path.resolve(process.cwd(), args.jsonOut);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  process.stdout.write(`${JSON.stringify({ ok: true, verdict: report.verdict ?? null }, null, 2)}\n`);
  if (report?.verdict?.ok !== true && !args.allowFail) process.exitCode = 1;
}

main().catch((err) => {
  process.stderr.write(`${err?.stack || err?.message || String(err)}\n`);
  process.exit(1);
});
