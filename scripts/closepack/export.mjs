#!/usr/bin/env node
import { exportToolCallClosepack } from "./lib.mjs";

function usage() {
  // eslint-disable-next-line no-console
  console.error("usage:");
  console.error(
    "  node scripts/closepack/export.mjs --agreement-hash <sha256> --out <path.zip> [--base-url http://127.0.0.1:3000] [--tenant-id tenant_default] [--protocol 1.0] [--api-key <token>] [--ops-token <tok_ops>]"
  );
}

function parseArgs(argv) {
  const out = {
    baseUrl: "http://127.0.0.1:3000",
    tenantId: "tenant_default",
    protocol: "1.0",
    apiKey: null,
    opsToken: null,
    agreementHash: null,
    outPath: null,
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] ?? "");
    if (arg === "--base-url") {
      out.baseUrl = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--tenant-id") {
      out.tenantId = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--protocol") {
      out.protocol = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--api-key") {
      out.apiKey = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--ops-token") {
      out.opsToken = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--agreement-hash") {
      out.agreementHash = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--out") {
      out.outPath = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return out;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    usage();
    process.exit(0);
  }
  if (!opts.agreementHash || !opts.outPath) {
    usage();
    throw new Error("--agreement-hash and --out are required");
  }

  const result = await exportToolCallClosepack({
    baseUrl: opts.baseUrl,
    tenantId: opts.tenantId,
    protocol: opts.protocol,
    apiKey: opts.apiKey,
    opsToken: opts.opsToken,
    agreementHash: opts.agreementHash,
    outPath: opts.outPath
  });

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    ok: result.ok,
    outPath: result.outPath,
    zipSha256: result.zipSha256,
    stats: result.stats
  }, null, 2));
}

await main();
