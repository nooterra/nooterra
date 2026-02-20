import test from "node:test";
import assert from "node:assert/strict";

import { listSupportedX402ZkProofProtocols, verifyX402ExecutionProofV1 } from "../src/core/zk-verifier.js";

test("zk verifier: exposes supported protocol list", () => {
  const protocols = listSupportedX402ZkProofProtocols();
  assert.deepEqual(protocols, ["groth16", "plonk", "stark"]);
});

test("zk verifier: absent proof returns not_provided", async () => {
  const result = await verifyX402ExecutionProofV1({});
  assert.equal(result.present, false);
  assert.equal(result.status, "not_provided");
  assert.equal(result.verified, null);
});

test("zk verifier: groth16 adapter verifies successfully", async () => {
  const result = await verifyX402ExecutionProofV1({
    proof: {
      protocol: "groth16",
      publicSignals: [],
      proofData: {},
      verificationKey: { kty: "test" }
    },
    protocolAdapters: {
      groth16: async () => true
    }
  });
  assert.equal(result.present, true);
  assert.equal(result.protocol, "groth16");
  assert.equal(result.status, "verified");
  assert.equal(result.verified, true);
  assert.equal(result.code, null);
});

test("zk verifier: unsupported protocol is deterministic false", async () => {
  const result = await verifyX402ExecutionProofV1({
    proof: {
      protocol: "unknown",
      publicSignals: [],
      proofData: {},
      verificationKey: { kty: "test" }
    }
  });
  assert.equal(result.present, true);
  assert.equal(result.status, "unsupported_protocol");
  assert.equal(result.verified, false);
  assert.equal(result.code, "X402_ZK_PROOF_PROTOCOL_UNSUPPORTED");
});
