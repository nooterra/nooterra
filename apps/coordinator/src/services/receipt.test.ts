import { describe, it, expect } from "vitest";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { signReceipt, verifyReceipt } from "./receipt.js";
import { ReceiptClaims } from "@nooterra/types";

describe("receipt signing and verification", () => {
  it("signs and verifies a receipt envelope", () => {
    const keypair = nacl.sign.keyPair();
    const pub58 = bs58.encode(Buffer.from(keypair.publicKey));

    const claims: ReceiptClaims = {
      rid: "test-receipt-1",
      rtype: "task",
      iat: 1_733_440_000,
      iss: "did:noot:test-agent",
      sub: "task-123",
      rh: "hash-result",
      ih: "hash-input",
      wid: "wf-abc",
      node: "main",
      cap: "cap.test.v1",
      credits: 10,
      dur: 500,
      profile: 3,
    };

    const envelope = signReceipt(claims, keypair.secretKey);
    const verification = verifyReceipt(envelope, pub58);

    expect(verification.valid).toBe(true);
    expect(verification.claims?.rid).toBe(claims.rid);
    expect(verification.claims?.cap).toBe(claims.cap);
  });
});
