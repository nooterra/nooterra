import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createRemoteSignerClient } from "../packages/artifact-produce/src/signer/remote-client.js";

test("remote signer auth: bearer token from env is applied to fetch headers", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return {
      ok: true,
      status: 200,
      body: null,
      async text() {
        return JSON.stringify({
          schemaVersion: "RemoteSignerPublicKeyResponse.v1",
          keyId: "key_test",
          algorithm: "ed25519",
          publicKeyPem: "-----BEGIN PUBLIC KEY-----\nAAA=\n-----END PUBLIC KEY-----\n"
        });
      }
    };
  };

  try {
    const client = createRemoteSignerClient({
      url: "https://signer.example",
      auth: "bearer",
      tokenEnv: "SETTLD_SIGNER_TOKEN",
      headers: ["X-Test: 1"],
      env: { ...process.env, SETTLD_SIGNER_TOKEN: "sekret" }
    });
    await client.getPublicKeyPem({ keyId: "key_test" });
    assert.equal(calls.length, 1);
    const hdrs = calls[0].opts?.headers ?? {};
    assert.equal(hdrs.authorization, "Bearer sekret");
    assert.equal(hdrs["X-Test"], "1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("remote signer auth: missing token fails before fetch", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called");
  };
  try {
    const client = createRemoteSignerClient({
      url: "https://signer.example",
      auth: "bearer",
      tokenEnv: "SETTLD_SIGNER_TOKEN",
      env: { ...process.env }
    });
    await assert.rejects(() => client.getPublicKeyPem({ keyId: "key_test" }), (e) => e?.code === "REMOTE_SIGNER_AUTH_MISSING");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("remote signer auth: bearer token from file is applied", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "settld-signer-token-"));
  await test.after(async () => fs.rm(tmp, { recursive: true, force: true }));
  const tokenPath = path.join(tmp, "token.txt");
  await fs.writeFile(tokenPath, "sekret-file\n", "utf8");

  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return {
      ok: true,
      status: 200,
      body: null,
      async text() {
        return JSON.stringify({
          schemaVersion: "RemoteSignerPublicKeyResponse.v1",
          keyId: "key_test",
          algorithm: "ed25519",
          publicKeyPem: "-----BEGIN PUBLIC KEY-----\nAAA=\n-----END PUBLIC KEY-----\n"
        });
      }
    };
  };

  try {
    const client = createRemoteSignerClient({
      url: "https://signer.example",
      auth: "bearer",
      tokenFile: tokenPath
    });
    await client.getPublicKeyPem({ keyId: "key_test" });
    assert.equal(calls.length, 1);
    const hdrs = calls[0].opts?.headers ?? {};
    assert.equal(hdrs.authorization, "Bearer sekret-file");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("remote signer client enforces message size cap", async () => {
  const client = createRemoteSignerClient({
    command: process.execPath,
    args: ["packages/artifact-produce/bin/settld-signer-dev.js", "--stdio", "--keys", "test/fixtures/keys/fixture_keypairs.json"]
  });
  const msg = new Uint8Array(1024 * 1024 + 1);
  await assert.rejects(
    () => client.sign({ keyId: "key_any", algorithm: "ed25519", messageBytes: msg, purpose: "event_payload", context: null }),
    (e) => e?.code === "REMOTE_SIGNER_MESSAGE_TOO_LARGE"
  );
});

