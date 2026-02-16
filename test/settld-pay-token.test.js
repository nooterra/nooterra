import test from "node:test";
import assert from "node:assert/strict";

import { createEd25519Keypair } from "../src/core/crypto.js";
import {
  buildSettldPayPayloadV1,
  mintSettldPayTokenV1,
  parseSettldPayTokenV1,
  verifySettldPayTokenV1
} from "../src/core/settld-pay-token.js";
import { buildSettldPayKeysetV1 } from "../src/core/settld-keys.js";

test("SettldPay token: valid token verifies offline with keyset", () => {
  const kp = createEd25519Keypair();
  const keyset = buildSettldPayKeysetV1({
    activeKey: { publicKeyPem: kp.publicKeyPem }
  });
  const nowUnix = 1_739_704_800;
  const payload = buildSettldPayPayloadV1({
    iss: "settld",
    aud: "prov_exa",
    gateId: "gate_tok_1",
    authorizationRef: "auth_gate_tok_1",
    amountCents: 500,
    currency: "USD",
    payeeProviderId: "prov_exa",
    iat: nowUnix,
    exp: nowUnix + 300
  });
  const minted = mintSettldPayTokenV1({
    payload,
    publicKeyPem: kp.publicKeyPem,
    privateKeyPem: kp.privateKeyPem
  });
  const verified = verifySettldPayTokenV1({
    token: minted.token,
    keyset,
    nowUnixSeconds: nowUnix + 10,
    expectedAudience: "prov_exa",
    expectedPayeeProviderId: "prov_exa"
  });
  assert.equal(verified.ok, true);
  assert.equal(verified.payload.gateId, "gate_tok_1");
});

test("SettldPay token: tampered payload fails signature verification", () => {
  const kp = createEd25519Keypair();
  const keyset = buildSettldPayKeysetV1({
    activeKey: { publicKeyPem: kp.publicKeyPem }
  });
  const nowUnix = 1_739_704_800;
  const payload = buildSettldPayPayloadV1({
    iss: "settld",
    aud: "prov_exa",
    gateId: "gate_tok_2",
    authorizationRef: "auth_gate_tok_2",
    amountCents: 500,
    currency: "USD",
    payeeProviderId: "prov_exa",
    iat: nowUnix,
    exp: nowUnix + 300
  });
  const minted = mintSettldPayTokenV1({
    payload,
    publicKeyPem: kp.publicKeyPem,
    privateKeyPem: kp.privateKeyPem
  });
  const parsed = parseSettldPayTokenV1(minted.token);
  const tamperedEnvelope = {
    ...parsed.envelope,
    payload: {
      ...parsed.payload,
      amountCents: 999
    }
  };
  const tamperedToken = Buffer.from(JSON.stringify(tamperedEnvelope), "utf8").toString("base64url");
  const verified = verifySettldPayTokenV1({ token: tamperedToken, keyset, nowUnixSeconds: nowUnix + 10 });
  assert.equal(verified.ok, false);
  assert.equal(verified.code, "SETTLD_PAY_SIGNATURE_INVALID");
});

test("SettldPay token: unknown key and expiry are enforced", () => {
  const kpA = createEd25519Keypair();
  const kpB = createEd25519Keypair();
  const nowUnix = 1_739_704_800;
  const payload = buildSettldPayPayloadV1({
    iss: "settld",
    aud: "prov_exa",
    gateId: "gate_tok_3",
    authorizationRef: "auth_gate_tok_3",
    amountCents: 500,
    currency: "USD",
    payeeProviderId: "prov_exa",
    iat: nowUnix,
    exp: nowUnix + 10
  });
  const minted = mintSettldPayTokenV1({
    payload,
    publicKeyPem: kpA.publicKeyPem,
    privateKeyPem: kpA.privateKeyPem
  });

  const wrongKeyset = buildSettldPayKeysetV1({
    activeKey: { publicKeyPem: kpB.publicKeyPem }
  });
  const unknownKeyResult = verifySettldPayTokenV1({
    token: minted.token,
    keyset: wrongKeyset,
    nowUnixSeconds: nowUnix + 1
  });
  assert.equal(unknownKeyResult.ok, false);
  assert.equal(unknownKeyResult.code, "SETTLD_PAY_UNKNOWN_KID");

  const validKeyset = buildSettldPayKeysetV1({
    activeKey: { publicKeyPem: kpA.publicKeyPem }
  });
  const expiredResult = verifySettldPayTokenV1({
    token: minted.token,
    keyset: validKeyset,
    nowUnixSeconds: nowUnix + 11
  });
  assert.equal(expiredResult.ok, false);
  assert.equal(expiredResult.code, "SETTLD_PAY_EXPIRED");
});
