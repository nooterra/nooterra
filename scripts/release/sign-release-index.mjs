import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

import { signIndex, unwrapSignaturesV1, wrapSignaturesV1, cmpString, writeCanonicalJsonFile } from "./release-index-lib.mjs";

function usage() {
  // eslint-disable-next-line no-console
  console.error(
    "usage: node scripts/release/sign-release-index.mjs --index <release_index_v1.json> [--out <release_index_v1.sig>] [--append] (--private-key-env <ENV>|--private-key-file <path>)"
  );
  process.exit(2);
}

function parseArgs(argv) {
  const out = { indexPath: null, outPath: null, privateKeyEnv: null, privateKeyFile: null, append: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--index") {
      out.indexPath = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--out") {
      out.outPath = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--private-key-env") {
      out.privateKeyEnv = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--private-key-file") {
      out.privateKeyFile = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--append") {
      out.append = true;
      continue;
    }
    if (a === "--help" || a === "-h") usage();
    usage();
  }
  if (!out.indexPath) usage();
  if (!out.privateKeyEnv && !out.privateKeyFile) usage();
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const indexPath = path.resolve(process.cwd(), args.indexPath);
  const outPath = args.outPath
    ? path.resolve(process.cwd(), args.outPath)
    : path.join(path.dirname(indexPath), "release_index_v1.sig");

  const privateKeyPem = args.privateKeyFile
    ? await fs.readFile(path.resolve(process.cwd(), args.privateKeyFile), "utf8")
    : process.env[String(args.privateKeyEnv)] ?? "";
  if (!String(privateKeyPem ?? "").trim()) throw new Error("missing release signing private key (env/file)");

  const indexJson = JSON.parse(await fs.readFile(indexPath, "utf8"));
  const sig = signIndex({ indexJson, privateKeyPem: String(privateKeyPem) });

  let signatures = [sig];
  if (args.append && fsSync.existsSync(outPath)) {
    const existing = JSON.parse(await fs.readFile(outPath, "utf8"));
    signatures = [...unwrapSignaturesV1(existing), sig];
  }

  const byKeyId = new Map();
  for (const s of signatures) {
    const keyId = typeof s?.keyId === "string" && s.keyId.trim() ? s.keyId.trim() : null;
    if (!keyId) continue;
    byKeyId.set(keyId, s);
  }
  const merged = Array.from(byKeyId.values());
  merged.sort((a, b) => cmpString(a?.keyId ?? "", b?.keyId ?? ""));
  const out = wrapSignaturesV1(merged);

  await writeCanonicalJsonFile(outPath, out);
}

await main();
