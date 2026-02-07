import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";

function sh(cmd, args, { cwd, env } = {}) {
  const res = spawnSync(cmd, args, { cwd, env, encoding: "utf8" });
  if (res.status !== 0) {
    const err = (res.stderr || res.stdout || "").trim();
    throw new Error(`${cmd} ${args.join(" ")} failed (exit ${res.status})${err ? `: ${err}` : ""}`);
  }
  return String(res.stdout ?? "");
}

async function writeFile(fp, text) {
  await fs.mkdir(path.dirname(fp), { recursive: true });
  await fs.writeFile(fp, text, "utf8");
}

function keyIdFromPublicKeyPem(publicKeyPem) {
  const hex = crypto.createHash("sha256").update(String(publicKeyPem), "utf8").digest("hex");
  return `key_${hex.slice(0, 24)}`;
}

test("ReleaseIndex.v1 generation is deterministic and signature+hash verification detects tamper", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "settld-release-index-test-"));
  await test.after(async () => fs.rm(tmp, { recursive: true, force: true }));

  // Create a tiny fake “release assets dir”.
  await writeFile(path.join(tmp, "a.tgz"), "hello\n");
  await writeFile(path.join(tmp, "b.tar.gz"), "world\n");

  const gen = (outPath) =>
    sh(process.execPath, [
      "scripts/release/generate-release-index.mjs",
      "--dir",
      tmp,
      "--tag",
      "v0.0.0-test",
      "--version",
      "0.0.0-test",
      "--commit",
      "0123456789abcdef0123456789abcdef01234567",
      "--out",
      outPath
    ]);

  const idx1 = path.join(tmp, "release_index_v1.1.json");
  const idx2 = path.join(tmp, "release_index_v1.2.json");
  gen(idx1);
  gen(idx2);

  const raw1 = await fs.readFile(idx1, "utf8");
  const raw2 = await fs.readFile(idx2, "utf8");
  assert.equal(raw1, raw2);

  // Sign using a test keypair.
  const keypair = JSON.parse(await fs.readFile(path.resolve(process.cwd(), "test/fixtures/keys/ed25519_test_keypair.json"), "utf8"));
  assert.equal(typeof keypair.privateKeyPem, "string");

  process.env.SETTLD_RELEASE_SIGNING_PRIVATE_KEY_PEM = keypair.privateKeyPem;
  sh(process.execPath, ["scripts/release/sign-release-index.mjs", "--index", idx1, "--out", path.join(tmp, "release_index_v1.sig"), "--private-key-env", "SETTLD_RELEASE_SIGNING_PRIVATE_KEY_PEM"]);

  // Trust file for the test keypair.
  const trustPath = path.join(tmp, "release-trust.json");
  await fs.writeFile(
    trustPath,
    JSON.stringify(
      {
        schemaVersion: "ReleaseTrust.v1",
        releaseRoots: {
          [keyIdFromPublicKeyPem(keypair.publicKeyPem)]: String(keypair.publicKeyPem)
        }
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  // Copy index to the expected filename so verify-release defaults work.
  await fs.copyFile(idx1, path.join(tmp, "release_index_v1.json"));

  // Verify ok.
  const okRes = spawnSync(process.execPath, ["scripts/release/verify-release.mjs", "--dir", tmp, "--trust", trustPath, "--format", "json"], { encoding: "utf8" });
  assert.equal(okRes.status, 0, okRes.stdout || okRes.stderr);
  const okJson = JSON.parse(okRes.stdout);
  assert.equal(okJson.schemaVersion, "VerifyReleaseOutput.v1");
  assert.equal(okJson.ok, true);

  // Tamper one artifact (bit flip).
  const aPath = path.join(tmp, "a.tgz");
  const a = await fs.readFile(aPath);
  a[0] = a[0] ^ 0xff;
  await fs.writeFile(aPath, a);

  const badRes = spawnSync(process.execPath, ["scripts/release/verify-release.mjs", "--dir", tmp, "--trust", trustPath, "--format", "json"], { encoding: "utf8" });
  assert.equal(badRes.status, 1);
  const badJson = JSON.parse(badRes.stdout);
  assert.equal(badJson.ok, false);
  const codes = new Set((badJson.errors ?? []).map((e) => e.code));
  assert.equal(codes.has("RELEASE_ASSET_HASH_MISMATCH"), true);
});
