/**
 * Generate and verify a sample NIP-0002 receipt envelope (COSE-like).
 *
 * Usage:
 *   pnpm run generate:receipt
 */
import { randomBytes, createHash } from "crypto";
import { encode as cborEncode } from "cbor";
import { encode as base64url } from "base64url";
import nacl from "tweetnacl";
import bs58 from "bs58";

function sha256Base64url(buf) {
  return createHash("sha256").update(buf).digest("base64url");
}

function kidFromPublicKey(pub58) {
  const raw = bs58.decode(pub58);
  return sha256Base64url(raw).slice(0, 16);
}

function buildSigStructure(protectedBytes, payloadBytes) {
  // COSE Sig_structure = ["Signature1", protected, external_aad, payload]
  return cborEncode(["Signature1", protectedBytes, Buffer.alloc(0), payloadBytes]);
}

function signReceipt(claims, secretKey) {
  const payloadBytes = cborEncode(claims);
  const protectedHeaders = {
    1: -8, // alg = EdDSA
    3: "application/nooterra-receipt+cbor",
  };
  const protectedBytes = cborEncode(protectedHeaders);
  const toSign = buildSigStructure(protectedBytes, payloadBytes);
  const sig = nacl.sign.detached(new Uint8Array(toSign), secretKey);
  return {
    protected: base64url(Buffer.from(protectedBytes)),
    payload: base64url(Buffer.from(payloadBytes)),
    signature: base64url(Buffer.from(sig)),
  };
}

function verifyReceipt(envelope, publicKey) {
  const protectedBytes = Buffer.from(envelope.protected, "base64url");
  const payloadBytes = Buffer.from(envelope.payload, "base64url");
  const sigBytes = Buffer.from(envelope.signature, "base64url");
  const toVerify = buildSigStructure(protectedBytes, payloadBytes);
  return nacl.sign.detached.verify(new Uint8Array(toVerify), new Uint8Array(sigBytes), publicKey);
}

async function main() {
  const keypair = nacl.sign.keyPair();
  const publicKeyB58 = bs58.encode(Buffer.from(keypair.publicKey));

  const claims = {
    rid: crypto.randomUUID ? crypto.randomUUID() : `rid-${Date.now()}`,
    rtype: "task",
    iat: Math.floor(Date.now() / 1000),
    iss: "did:noot:demo-agent-1",
    sub: "task-123",
    rh: sha256Base64url(Buffer.from("result-payload")),
    wid: "workflow-abc",
    node: "main",
    cap: "cap.text.summarize.v1",
    credits: 15,
    dur: 1200,
    profile: 3,
  };

  const envelope = signReceipt(claims, keypair.secretKey);
  const ok = verifyReceipt(envelope, keypair.publicKey);

  console.log(JSON.stringify({
    publicKey: publicKeyB58,
    kid: kidFromPublicKey(publicKeyB58),
    claims,
    envelope,
    verified: ok,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
