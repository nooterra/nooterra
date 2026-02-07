import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { sign as nodeSign } from "node:crypto";

function writeStdout(text) {
  fsSync.writeFileSync(1, Buffer.from(String(text ?? ""), "utf8"));
}

function writeStderr(text) {
  fsSync.writeFileSync(2, Buffer.from(String(text ?? ""), "utf8"));
}

function usage() {
  writeStderr("usage: signer-stdio-stub.mjs --stdio --keys <keypairs.json> [--request-json-base64 <b64>]\n");
  process.exit(2);
}

function parse(argv) {
  let keysPath = null;
  let stdio = false;
  let requestJsonBase64 = null;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--keys") {
      keysPath = argv[i + 1] ?? null;
      if (!keysPath) usage();
      i += 1;
      continue;
    }
    if (a === "--stdio") {
      stdio = true;
      continue;
    }
    if (a === "--request-json-base64") {
      requestJsonBase64 = argv[i + 1] ?? null;
      if (!requestJsonBase64) usage();
      i += 1;
      continue;
    }
    if (a === "--help" || a === "-h") usage();
    usage();
  }
  if (!keysPath || !stdio) usage();
  return { keysPath, requestJsonBase64 };
}

async function readAllStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

async function loadKeypairs(keysPath) {
  const abs = path.resolve(process.cwd(), keysPath);
  const json = JSON.parse(await fs.readFile(abs, "utf8"));
  const byKeyId = new Map();
  for (const v of Object.values(json ?? {})) {
    if (!v?.keyId || !v?.publicKeyPem || !v?.privateKeyPem) continue;
    byKeyId.set(v.keyId, v);
  }
  return byKeyId;
}

function isBase64(s) {
  return typeof s === "string" && /^[A-Za-z0-9+/=]+$/.test(s);
}

async function main() {
  const { keysPath, requestJsonBase64 } = parse(process.argv.slice(2));
  const byKeyId = await loadKeypairs(keysPath);

  const raw = requestJsonBase64 ? Buffer.from(String(requestJsonBase64), "base64").toString("utf8") : await readAllStdin();
  const req = JSON.parse(raw || "null");
  const op = typeof req?.op === "string" ? req.op : null;

  if (op === "publicKey") {
    const keyId = typeof req?.keyId === "string" ? req.keyId : null;
    if (!keyId) {
      process.exitCode = 1;
      writeStderr("missing keyId\n");
      return;
    }
    const kp = byKeyId.get(keyId) ?? null;
    if (!kp) {
      process.exitCode = 1;
      writeStderr("unknown keyId\n");
      return;
    }
    writeStdout(JSON.stringify({ schemaVersion: "RemoteSignerPublicKeyResponse.v1", keyId, algorithm: "ed25519", publicKeyPem: kp.publicKeyPem }) + "\n");
    return;
  }

  if (op === "sign") {
    const body = req?.body ?? null;
    const keyId = typeof body?.keyId === "string" ? body.keyId : null;
    const algorithm = typeof body?.algorithm === "string" ? body.algorithm : null;
    const messageBase64 = typeof body?.messageBase64 === "string" ? body.messageBase64 : null;
    const requestId = typeof body?.requestId === "string" ? body.requestId : null;
    if (!keyId || !algorithm || !messageBase64) {
      process.exitCode = 1;
      writeStderr("missing required fields\n");
      return;
    }
    if (algorithm !== "ed25519") {
      process.exitCode = 1;
      writeStderr("unsupported algorithm\n");
      return;
    }
    if (!isBase64(messageBase64)) {
      process.exitCode = 1;
      writeStderr("invalid messageBase64\n");
      return;
    }
    const kp = byKeyId.get(keyId) ?? null;
    if (!kp) {
      process.exitCode = 1;
      writeStderr("unknown keyId\n");
      return;
    }
    const msg = Buffer.from(messageBase64, "base64");
    const sig = nodeSign(null, msg, kp.privateKeyPem).toString("base64");
    writeStdout(JSON.stringify({ schemaVersion: "RemoteSignerSignResponse.v1", requestId, keyId, algorithm, signatureBase64: sig }) + "\n");
    return;
  }

  process.exitCode = 1;
  writeStderr("unknown op\n");
}

await main();
