import test from "node:test";
import assert from "node:assert/strict";

import { createEd25519Keypair, sha256Hex } from "../src/core/crypto.js";
import {
  buildNooterraPayPayloadV1,
  computeNooterraPayRequestBindingSha256V1,
  mintNooterraPayTokenV1,
  parseNooterraPayTokenV1,
  verifyNooterraPayTokenV1
} from "../src/core/nooterra-pay-token.js";
import { buildNooterraPayKeysetV1 } from "../src/core/nooterra-keys.js";

test("NooterraPay token: valid token verifies offline with keyset", () => {
  const kp = createEd25519Keypair();
  const keyset = buildNooterraPayKeysetV1({
    activeKey: { publicKeyPem: kp.publicKeyPem }
  });
  const nowUnix = 1_739_704_800;
  const payload = buildNooterraPayPayloadV1({
    iss: "nooterra",
    aud: "prov_exa",
    gateId: "gate_tok_1",
    authorizationRef: "auth_gate_tok_1",
    amountCents: 500,
    currency: "USD",
    payeeProviderId: "prov_exa",
    iat: nowUnix,
    exp: nowUnix + 300
  });
  const minted = mintNooterraPayTokenV1({
    payload,
    publicKeyPem: kp.publicKeyPem,
    privateKeyPem: kp.privateKeyPem
  });
  const verified = verifyNooterraPayTokenV1({
    token: minted.token,
    keyset,
    nowUnixSeconds: nowUnix + 10,
    expectedAudience: "prov_exa",
    expectedPayeeProviderId: "prov_exa"
  });
  assert.equal(verified.ok, true);
  assert.equal(verified.payload.gateId, "gate_tok_1");
});

test("NooterraPay token: tampered payload fails signature verification", () => {
  const kp = createEd25519Keypair();
  const keyset = buildNooterraPayKeysetV1({
    activeKey: { publicKeyPem: kp.publicKeyPem }
  });
  const nowUnix = 1_739_704_800;
  const payload = buildNooterraPayPayloadV1({
    iss: "nooterra",
    aud: "prov_exa",
    gateId: "gate_tok_2",
    authorizationRef: "auth_gate_tok_2",
    amountCents: 500,
    currency: "USD",
    payeeProviderId: "prov_exa",
    iat: nowUnix,
    exp: nowUnix + 300
  });
  const minted = mintNooterraPayTokenV1({
    payload,
    publicKeyPem: kp.publicKeyPem,
    privateKeyPem: kp.privateKeyPem
  });
  const parsed = parseNooterraPayTokenV1(minted.token);
  const tamperedEnvelope = {
    ...parsed.envelope,
    payload: {
      ...parsed.payload,
      amountCents: 999
    }
  };
  const tamperedToken = Buffer.from(JSON.stringify(tamperedEnvelope), "utf8").toString("base64url");
  const verified = verifyNooterraPayTokenV1({ token: tamperedToken, keyset, nowUnixSeconds: nowUnix + 10 });
  assert.equal(verified.ok, false);
  assert.equal(verified.code, "NOOTERRA_PAY_SIGNATURE_INVALID");
});

test("NooterraPay token: unknown key and expiry are enforced", () => {
  const kpA = createEd25519Keypair();
  const kpB = createEd25519Keypair();
  const nowUnix = 1_739_704_800;
  const payload = buildNooterraPayPayloadV1({
    iss: "nooterra",
    aud: "prov_exa",
    gateId: "gate_tok_3",
    authorizationRef: "auth_gate_tok_3",
    amountCents: 500,
    currency: "USD",
    payeeProviderId: "prov_exa",
    iat: nowUnix,
    exp: nowUnix + 10
  });
  const minted = mintNooterraPayTokenV1({
    payload,
    publicKeyPem: kpA.publicKeyPem,
    privateKeyPem: kpA.privateKeyPem
  });

  const wrongKeyset = buildNooterraPayKeysetV1({
    activeKey: { publicKeyPem: kpB.publicKeyPem }
  });
  const unknownKeyResult = verifyNooterraPayTokenV1({
    token: minted.token,
    keyset: wrongKeyset,
    nowUnixSeconds: nowUnix + 1
  });
  assert.equal(unknownKeyResult.ok, false);
  assert.equal(unknownKeyResult.code, "NOOTERRA_PAY_UNKNOWN_KID");

  const validKeyset = buildNooterraPayKeysetV1({
    activeKey: { publicKeyPem: kpA.publicKeyPem }
  });
  const expiredResult = verifyNooterraPayTokenV1({
    token: minted.token,
    keyset: validKeyset,
    nowUnixSeconds: nowUnix + 11
  });
  assert.equal(expiredResult.ok, false);
  assert.equal(expiredResult.code, "NOOTERRA_PAY_EXPIRED");
});

test("NooterraPay token: strict request binding rejects mismatched request hash", () => {
  const kp = createEd25519Keypair();
  const keyset = buildNooterraPayKeysetV1({
    activeKey: { publicKeyPem: kp.publicKeyPem }
  });
  const nowUnix = 1_739_704_800;
  const bodySha256 = sha256Hex(Buffer.from("{\"action\":\"send\"}", "utf8"));
  const requestBindingSha256 = computeNooterraPayRequestBindingSha256V1({
    method: "POST",
    host: "provider.local",
    pathWithQuery: "/tools/send?dryRun=0",
    bodySha256
  });
  const payload = buildNooterraPayPayloadV1({
    iss: "nooterra",
    aud: "prov_actions",
    gateId: "gate_tok_4",
    authorizationRef: "auth_gate_tok_4",
    amountCents: 700,
    currency: "USD",
    payeeProviderId: "prov_actions",
    requestBindingMode: "strict",
    requestBindingSha256,
    iat: nowUnix,
    exp: nowUnix + 300
  });
  const minted = mintNooterraPayTokenV1({
    payload,
    publicKeyPem: kp.publicKeyPem,
    privateKeyPem: kp.privateKeyPem
  });

  const okResult = verifyNooterraPayTokenV1({
    token: minted.token,
    keyset,
    nowUnixSeconds: nowUnix + 10,
    expectedRequestBindingSha256: requestBindingSha256
  });
  assert.equal(okResult.ok, true);

  const mismatchedRequestBindingSha256 = computeNooterraPayRequestBindingSha256V1({
    method: "POST",
    host: "provider.local",
    pathWithQuery: "/tools/send?dryRun=1",
    bodySha256
  });
  const mismatchResult = verifyNooterraPayTokenV1({
    token: minted.token,
    keyset,
    nowUnixSeconds: nowUnix + 10,
    expectedRequestBindingSha256: mismatchedRequestBindingSha256
  });
  assert.equal(mismatchResult.ok, false);
  assert.equal(mismatchResult.code, "NOOTERRA_PAY_REQUEST_BINDING_MISMATCH");
});
