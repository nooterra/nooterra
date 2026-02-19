#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

import { createEd25519Keypair, keyIdFromPublicKeyPem } from "../../src/core/crypto.js";
import { buildSettldPayKeysetV1 } from "../../src/core/settld-keys.js";
import { computeProviderRefFromPublishProofJwk } from "../../src/core/provider-publish-proof.js";

function usage() {
  return [
    "Usage:",
    "  node scripts/provider/keys-generate.mjs --out-dir <dir> [options]",
    "",
    "Options:",
    "  --out-dir <dir>        Output directory (required)",
    "  --prefix <name>        File prefix (default: identity)",
    "  --overwrite            Allow overwriting existing files",
    "  --help                 Show this help"
  ].join("\n");
}

function parseArgs(argv) {
  const out = {
    outDir: null,
    prefix: "identity",
    overwrite: false,
    help: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] ?? "");
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--out-dir") out.outDir = String(argv[++i] ?? "").trim();
    else if (arg === "--prefix") out.prefix = String(argv[++i] ?? "").trim();
    else if (arg === "--overwrite") out.overwrite = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!out.help) {
    if (!out.outDir) throw new Error("--out-dir is required");
    if (!out.prefix) throw new Error("--prefix must be non-empty");
  }
  return out;
}

function assertWritablePath(filePath, { overwrite }) {
  if (!fs.existsSync(filePath)) return;
  if (overwrite) return;
  throw new Error(`file exists (use --overwrite): ${filePath}`);
}

function writeFileSafely(filePath, value, { overwrite, mode = null } = {}) {
  assertWritablePath(filePath, { overwrite });
  fs.writeFileSync(filePath, value, { encoding: "utf8", ...(mode ? { mode } : {}) });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const outDir = path.resolve(process.cwd(), args.outDir);
  fs.mkdirSync(outDir, { recursive: true });

  const { publicKeyPem, privateKeyPem } = createEd25519Keypair();
  const keyId = keyIdFromPublicKeyPem(publicKeyPem);
  const jwks = buildSettldPayKeysetV1({
    activeKey: {
      keyId,
      publicKeyPem
    },
    refreshedAt: new Date().toISOString()
  });
  const providerRef = computeProviderRefFromPublishProofJwk(jwks.keys[0]);

  const privateKeyPath = path.join(outDir, `${args.prefix}.ed25519.private.pem`);
  const publicKeyPath = path.join(outDir, `${args.prefix}.ed25519.public.pem`);
  const jwksPath = path.join(outDir, `${args.prefix}.jwks.json`);
  const metadataPath = path.join(outDir, `${args.prefix}.meta.json`);

  writeFileSafely(privateKeyPath, privateKeyPem, { overwrite: args.overwrite, mode: 0o600 });
  writeFileSafely(publicKeyPath, publicKeyPem, { overwrite: args.overwrite });
  writeFileSafely(jwksPath, `${JSON.stringify(jwks, null, 2)}\n`, { overwrite: args.overwrite });
  writeFileSafely(
    metadataPath,
    `${JSON.stringify(
      {
        schemaVersion: "ProviderIdentityMaterial.v1",
        generatedAt: new Date().toISOString(),
        keyId,
        providerRef,
        files: {
          privateKeyPath,
          publicKeyPath,
          jwksPath
        }
      },
      null,
      2
    )}\n`,
    { overwrite: args.overwrite }
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        keyId,
        providerRef,
        privateKeyPath,
        publicKeyPath,
        jwksPath,
        metadataPath
      },
      null,
      2
    )}\n`
  );
}

try {
  main();
} catch (err) {
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: false,
        message: err?.message ?? String(err ?? "")
      },
      null,
      2
    )}\n`
  );
  process.exit(1);
}
