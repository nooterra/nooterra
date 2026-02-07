import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { spawnCapture } from "../conformance/v1/lib/harness.mjs";

function b64Json(obj) {
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64");
}

test("signer-stdio-stub emits deterministic UTF-8 bytes (argv/base64 path)", async () => {
  const stub = path.resolve(process.cwd(), "conformance", "v1", "producer", "signer-stdio-stub.mjs");
  const keys = path.resolve(process.cwd(), "conformance", "v1", "producer", "fixture_keypairs.json");

  const keyId = "key_4bd1ee0813b265cb6670a1cc";
  const res = await spawnCapture({
    cmd: process.execPath,
    args: [stub, "--stdio", "--keys", keys, "--request-json-base64", b64Json({ op: "publicKey", keyId })],
    timeoutMs: 5_000,
    maxStdoutBytes: 256 * 1024,
    maxStderrBytes: 64 * 1024
  });

  assert.equal(res.exitCode, 0);
  assert.equal(res.stderr, "");
  assert.equal(res.stdout.endsWith("\n"), true);
  const parsed = JSON.parse(res.stdout);
  assert.equal(parsed.schemaVersion, "RemoteSignerPublicKeyResponse.v1");
  assert.equal(parsed.keyId, keyId);
  assert.equal(parsed.algorithm, "ed25519");
  assert.equal(typeof parsed.publicKeyPem, "string");
});

test("signer-stdio-stub failure writes stderr only", async () => {
  const stub = path.resolve(process.cwd(), "conformance", "v1", "producer", "signer-stdio-stub.mjs");
  const keys = path.resolve(process.cwd(), "conformance", "v1", "producer", "fixture_keypairs.json");

  const res = await spawnCapture({
    cmd: process.execPath,
    args: [stub, "--stdio", "--keys", keys, "--request-json-base64", b64Json({ op: "publicKey" })],
    timeoutMs: 5_000,
    maxStdoutBytes: 64 * 1024,
    maxStderrBytes: 64 * 1024
  });

  assert.equal(res.exitCode, 1);
  assert.equal(res.stdout, "");
  assert.equal(res.stderr, "missing keyId\n");
});

