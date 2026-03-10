import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  issueBuyerPasskeyChallenge,
  listBuyerPasskeys,
  registerBuyerPasskey,
  touchBuyerPasskey,
  verifyAndConsumeBuyerPasskeyChallenge
} from "../services/magic-link/src/buyer-passkeys.js";

function signChallenge(privateKeyPem, challenge) {
  return crypto.sign(null, Buffer.from(String(challenge), "utf8"), privateKeyPem).toString("base64url");
}

test("buyer passkeys: signup challenge verifies, registers, and login challenge fails closed on replay", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-buyer-passkeys-"));
  try {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

    const signup = await issueBuyerPasskeyChallenge({
      dataDir,
      tenantId: "tenant_wallet",
      email: "founder@example.com",
      purpose: "signup",
      ttlSeconds: 60,
      metadata: { companyName: "Nooterra", fullName: "Founder" }
    });
    assert.equal(signup.ok, true);

    const signupVerified = await verifyAndConsumeBuyerPasskeyChallenge({
      dataDir,
      tenantId: "tenant_wallet",
      challengeId: signup.challengeId,
      challenge: signup.challenge,
      purpose: "signup",
      credentialId: "cred_founder_main",
      signature: signChallenge(privateKeyPem, signup.challenge),
      publicKeyPem
    });
    assert.equal(signupVerified.ok, true);
    assert.equal(signupVerified.email, "founder@example.com");

    const registered = await registerBuyerPasskey({
      dataDir,
      tenantId: "tenant_wallet",
      email: "founder@example.com",
      credentialId: "cred_founder_main",
      publicKeyPem,
      label: "Founder laptop"
    });
    assert.equal(registered.ok, true);
    assert.equal(registered.passkey?.algorithm, "ed25519");

    const listed = await listBuyerPasskeys({
      dataDir,
      tenantId: "tenant_wallet",
      email: "founder@example.com"
    });
    assert.equal(listed.length, 1);
    assert.equal(listed[0].credentialId, "cred_founder_main");

    const login = await issueBuyerPasskeyChallenge({
      dataDir,
      tenantId: "tenant_wallet",
      email: "founder@example.com",
      purpose: "login",
      ttlSeconds: 60
    });
    assert.equal(login.ok, true);

    const loginVerified = await verifyAndConsumeBuyerPasskeyChallenge({
      dataDir,
      tenantId: "tenant_wallet",
      challengeId: login.challengeId,
      challenge: login.challenge,
      purpose: "login",
      credentialId: "cred_founder_main",
      signature: signChallenge(privateKeyPem, login.challenge)
    });
    assert.equal(loginVerified.ok, true);
    assert.equal(loginVerified.passkey?.credentialId, "cred_founder_main");

    const replay = await verifyAndConsumeBuyerPasskeyChallenge({
      dataDir,
      tenantId: "tenant_wallet",
      challengeId: login.challengeId,
      challenge: login.challenge,
      purpose: "login",
      credentialId: "cred_founder_main",
      signature: signChallenge(privateKeyPem, login.challenge)
    });
    assert.equal(replay.ok, false);
    assert.equal(replay.error, "PASSKEY_CHALLENGE_CONSUMED");

    const touched = await touchBuyerPasskey({
      dataDir,
      tenantId: "tenant_wallet",
      email: "founder@example.com",
      credentialId: "cred_founder_main",
      at: "2026-03-09T00:00:00.000Z"
    });
    assert.equal(touched.ok, true);
    const listedAfterTouch = await listBuyerPasskeys({
      dataDir,
      tenantId: "tenant_wallet",
      email: "founder@example.com"
    });
    assert.equal(listedAfterTouch[0].lastUsedAt, "2026-03-09T00:00:00.000Z");
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
