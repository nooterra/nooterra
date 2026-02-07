import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { canonicalJsonStringify } from "../packages/artifact-verify/src/canonical-json.js";
import { sha256FileHex, signIndex, wrapSignaturesV1 } from "../packages/artifact-verify/src/release/release-index-lib.js";
import { verifyReleaseDir } from "../packages/artifact-verify/src/release/verify-release.js";

async function writeCanonicalJson(fp, json) {
  await fs.writeFile(fp, `${canonicalJsonStringify(json)}\n`, "utf8");
}

test("release signing compromise drill: revoke old key, accept new key", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "settld-release-compromise-"));
  await test.after(async () => fs.rm(tmp, { recursive: true, force: true }));

  // Fixture keypairs (test-only).
  const oldKeypair = JSON.parse(await fs.readFile(path.resolve(process.cwd(), "test/fixtures/keys/ed25519_test_keypair.json"), "utf8"));
  const kp = JSON.parse(await fs.readFile(path.resolve(process.cwd(), "conformance/v1/producer/fixture_keypairs.json"), "utf8"));
  const newKeypair = kp.serverA;

  // Fake “release assets dir”.
  await fs.writeFile(path.join(tmp, "a.tgz"), "hello\n", "utf8");
  await fs.writeFile(path.join(tmp, "b.tar.gz"), "world\n", "utf8");

  const aSha = await sha256FileHex(path.join(tmp, "a.tgz"));
  const bSha = await sha256FileHex(path.join(tmp, "b.tar.gz"));

  const buildEpochSeconds = 1700000000;
  const index = {
    schemaVersion: "ReleaseIndex.v1",
    release: { tag: "v0.0.0-drill", version: "0.0.0-drill" },
    toolchain: {
      commit: "0123456789abcdef0123456789abcdef01234567",
      buildEpochSeconds,
      canonicalJson: "RFC8785",
      includedSchemas: ["ReleaseIndex.v1", "VerifyReleaseOutput.v1"]
    },
    artifacts: [
      { path: "a.tgz", sha256: aSha, sizeBytes: 6, kind: "npm-tgz" },
      { path: "b.tar.gz", sha256: bSha, sizeBytes: 6, kind: "tar.gz" }
    ]
  };

  await writeCanonicalJson(path.join(tmp, "release_index_v1.json"), index);

  // Sign with the old key and trust it.
  const sigOld = signIndex({ indexJson: index, privateKeyPem: oldKeypair.privateKeyPem });
  await writeCanonicalJson(path.join(tmp, "release_index_v1.sig"), wrapSignaturesV1([sigOld]));

  const trustPath = path.join(tmp, "release-trust.json");
  const trustOk = {
    schemaVersion: "ReleaseTrust.v2",
    policy: { minSignatures: 1 },
    keys: [
      {
        keyId: sigOld.keyId,
        publicKeyPem: oldKeypair.publicKeyPem,
        notBeforeEpochSeconds: 0,
        comment: "old key (pre-compromise)"
      },
      {
        keyId: newKeypair.keyId,
        publicKeyPem: newKeypair.publicKeyPem,
        notBeforeEpochSeconds: 0,
        comment: "new key"
      }
    ]
  };
  await fs.writeFile(trustPath, JSON.stringify(trustOk, null, 2) + "\n", "utf8");

  const ok1 = await verifyReleaseDir({ dir: tmp, trustPath });
  assert.equal(ok1.ok, true);

  // Simulate compromise: revoke old key, and (attempt to) sign a new release using the revoked key.
  const trustRevoked = {
    ...trustOk,
    keys: trustOk.keys.map((k) => (k.keyId === sigOld.keyId ? { ...k, revokedAtEpochSeconds: 1600000000, comment: "old key revoked" } : k))
  };
  await fs.writeFile(trustPath, JSON.stringify(trustRevoked, null, 2) + "\n", "utf8");

  const sigOldAfterRevoke = signIndex({ indexJson: index, privateKeyPem: oldKeypair.privateKeyPem });
  await writeCanonicalJson(path.join(tmp, "release_index_v1.sig"), wrapSignaturesV1([sigOldAfterRevoke]));

  const revokedRes = await verifyReleaseDir({ dir: tmp, trustPath });
  assert.equal(revokedRes.ok, false);
  const revokedCodes = new Set((revokedRes.errors ?? []).map((e) => e.code));
  assert.equal(revokedCodes.has("RELEASE_SIGNER_REVOKED"), true);

  // Sign with the new key: should pass again.
  const sigNew = signIndex({ indexJson: index, privateKeyPem: newKeypair.privateKeyPem });
  await writeCanonicalJson(path.join(tmp, "release_index_v1.sig"), wrapSignaturesV1([sigNew]));

  const ok2 = await verifyReleaseDir({ dir: tmp, trustPath });
  assert.equal(ok2.ok, true);
});

