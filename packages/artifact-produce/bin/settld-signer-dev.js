#!/usr/bin/env node
import http from "node:http";
import { URL } from "node:url";
import fsSync from "node:fs";
import path from "node:path";

import { sign as nodeSign } from "node:crypto";

import { writeStdout, writeStderr } from "../src/cli/io.js";
import { SIGNING_PURPOSE } from "../src/signer/purposes.js";

function usage() {
  writeStderr(
    [
      "usage:",
      "  server mode:",
      "    settld-signer-dev --keys <keypairs.json> [--host 127.0.0.1] [--port 0]",
      "  stdio (one-shot) mode:",
      "    settld-signer-dev --stdio --keys <keypairs.json>   # reads JSON request from stdin, writes JSON response to stdout",
      "    settld-signer-dev --stdio --keys <keypairs.json> --request-json-base64 <b64>   # avoids stdin piping (some CI sandboxes)",
      "",
      "This is a reference/dev remote signer. Do not use in production."
    ].join("\n") + "\n"
  );
  process.exit(2);
}

function parse(argv) {
  let keysPath = null;
  let host = "127.0.0.1";
  let port = 0;
  let stdioMode = false;
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
      stdioMode = true;
      continue;
    }
    if (a === "--request-json-base64") {
      requestJsonBase64 = argv[i + 1] ?? null;
      if (!requestJsonBase64) usage();
      i += 1;
      continue;
    }
    if (a === "--host") {
      host = argv[i + 1] ?? null;
      if (!host) usage();
      i += 1;
      continue;
    }
    if (a === "--port") {
      const raw = argv[i + 1] ?? null;
      if (!raw) usage();
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) usage();
      port = Math.floor(n);
      i += 1;
      continue;
    }
    if (a === "--help" || a === "-h") usage();
    usage();
  }
  if (!keysPath) usage();
  return { keysPath, host, port, stdioMode, requestJsonBase64 };
}

function loadKeypairs(keysPath) {
  const abs = path.resolve(process.cwd(), keysPath);
  const json = JSON.parse(fsSync.readFileSync(abs, "utf8"));
  const byKeyId = new Map();
  for (const v of Object.values(json ?? {})) {
    const keyId = typeof v?.keyId === "string" ? v.keyId : null;
    const publicKeyPem = typeof v?.publicKeyPem === "string" ? v.publicKeyPem : null;
    const privateKeyPem = typeof v?.privateKeyPem === "string" ? v.privateKeyPem : null;
    if (!keyId || !publicKeyPem || !privateKeyPem) continue;
    byKeyId.set(keyId, { keyId, publicKeyPem, privateKeyPem });
  }
  return byKeyId;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res, status, body) {
  const out = JSON.stringify(body, null, 2) + "\n";
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(out);
}

function bad(res, status, message, detail = null) {
  json(res, status, { ok: false, error: message, detail });
}

const ALLOWED_PURPOSES = new Set(Object.values(SIGNING_PURPOSE));

async function main() {
  const { keysPath, host, port, stdioMode, requestJsonBase64 } = parse(process.argv.slice(2));
  const byKeyId = loadKeypairs(keysPath);

  if (stdioMode) {
    let raw;
    if (requestJsonBase64) {
      try {
        raw = Buffer.from(String(requestJsonBase64), "base64").toString("utf8");
      } catch {
        process.exitCode = 1;
        writeStderr("invalid request-json-base64\n");
        return;
      }
    } else {
      raw = await new Promise((resolve, reject) => {
        const chunks = [];
        process.stdin.on("data", (c) => chunks.push(c));
        process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        process.stdin.on("error", reject);
      });
    }
    const req = JSON.parse(raw || "null");
    const op = typeof req?.op === "string" ? req.op : null;
    if (op === "publicKey") {
      const keyId = typeof req?.keyId === "string" ? req.keyId : null;
      if (!keyId) throw new Error("missing keyId");
      const kp = byKeyId.get(keyId) ?? null;
      if (!kp) {
        process.exitCode = 1;
        writeStderr("unknown keyId\n");
        return;
      }
      writeStdout(`${JSON.stringify({ schemaVersion: "RemoteSignerPublicKeyResponse.v1", keyId, algorithm: "ed25519", publicKeyPem: kp.publicKeyPem })}\n`);
      return;
    }
    if (op === "sign") {
      const body = req?.body ?? null;
      const keyId = typeof body?.keyId === "string" ? body.keyId : null;
      const algorithm = typeof body?.algorithm === "string" ? body.algorithm : null;
      const messageBase64 = typeof body?.messageBase64 === "string" ? body.messageBase64 : null;
      const purpose = typeof body?.purpose === "string" ? body.purpose : null;
      const requestId = typeof body?.requestId === "string" ? body.requestId : null;
      if (!keyId || !algorithm || !messageBase64 || !purpose) {
        process.exitCode = 1;
        writeStderr("missing required fields\n");
        return;
      }
      if (!ALLOWED_PURPOSES.has(purpose)) {
        process.exitCode = 1;
        writeStderr("unknown purpose\n");
        return;
      }
      if (algorithm !== "ed25519") {
        process.exitCode = 1;
        writeStderr("unsupported algorithm\n");
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
      const signerReceipt = `dev:${purpose}:${keyId}:${String(requestId ?? "")}`.replace(/\s+/g, "");
      writeStdout(`${JSON.stringify({ schemaVersion: "RemoteSignerSignResponse.v1", requestId, keyId, algorithm, signatureBase64: sig, signerReceipt })}\n`);
      return;
    }
    process.exitCode = 1;
    writeStderr("unknown op\n");
    return;
  }

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (req.method === "GET" && u.pathname === "/v1/public-key") {
      const keyId = u.searchParams.get("keyId");
      if (!keyId) return bad(res, 400, "missing keyId");
      const kp = byKeyId.get(keyId) ?? null;
      if (!kp) return bad(res, 404, "unknown keyId");
      return json(res, 200, { schemaVersion: "RemoteSignerPublicKeyResponse.v1", keyId, algorithm: "ed25519", publicKeyPem: kp.publicKeyPem });
    }

    if (req.method === "POST" && u.pathname === "/v1/sign") {
      const raw = await readBody(req);
      let body;
      try {
        body = JSON.parse(raw || "null");
      } catch (e) {
        return bad(res, 400, "invalid JSON", e?.message ?? String(e));
      }
      const keyId = typeof body?.keyId === "string" ? body.keyId : null;
      const algorithm = typeof body?.algorithm === "string" ? body.algorithm : null;
      const messageBase64 = typeof body?.messageBase64 === "string" ? body.messageBase64 : null;
      const purpose = typeof body?.purpose === "string" ? body.purpose : null;
      const requestId = typeof body?.requestId === "string" ? body.requestId : null;
      if (!keyId || !algorithm || !messageBase64 || !purpose) return bad(res, 400, "missing required fields");
      if (!ALLOWED_PURPOSES.has(purpose)) return bad(res, 400, "unknown purpose");
      if (algorithm !== "ed25519") return bad(res, 400, "unsupported algorithm");
      const kp = byKeyId.get(keyId) ?? null;
      if (!kp) return bad(res, 404, "unknown keyId");
      let msg;
      try {
        msg = Buffer.from(messageBase64, "base64");
      } catch {
        return bad(res, 400, "invalid messageBase64");
      }
      const sig = nodeSign(null, msg, kp.privateKeyPem).toString("base64");
      const signerReceipt = `dev:${purpose}:${keyId}:${String(requestId ?? "")}`.replace(/\s+/g, "");
      return json(res, 200, { schemaVersion: "RemoteSignerSignResponse.v1", requestId, keyId, algorithm, signatureBase64: sig, signerReceipt });
    }

    return bad(res, 404, "not found");
  });

  server.listen({ host, port }, () => {
    const addr = server.address();
    if (addr && typeof addr === "object") {
      writeStdout(`listening http://${addr.address}:${addr.port}\n`);
    } else {
      writeStdout("listening\n");
    }
  });
}

await main();
