const SUPPORTED_X402_ZK_PROTOCOLS = new Set(["groth16", "plonk", "stark"]);
const CRYPTOGRAPHIC_ZK_PROTOCOLS = new Set(["groth16", "plonk"]);

let snarkJsPromise = null;

function normalizeOptionalSha256(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(normalized) ? normalized : null;
}

function normalizeOptionalRef(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

async function loadSnarkJs() {
  if (!snarkJsPromise) {
    snarkJsPromise = import("snarkjs");
  }
  return await snarkJsPromise;
}

async function terminateSnarkCurves() {
  const candidates = [globalThis?.curve_bn128, globalThis?.curve_bls12381];
  for (const curve of candidates) {
    if (curve && typeof curve.terminate === "function") {
      try {
        await curve.terminate();
      } catch {
        // Best-effort cleanup to prevent lingering worker MessagePorts.
      }
    }
  }
}

export function listSupportedX402ZkProofProtocols() {
  return Array.from(SUPPORTED_X402_ZK_PROTOCOLS.values());
}

export async function verifyX402ExecutionProofV1({
  proof = null,
  verificationKey = null,
  expectedVerificationKeyRef = null,
  requiredProtocol = null,
  expectedBindings = null,
  requireBindings = false,
  protocolAdapters = null
} = {}) {
  if (!proof || typeof proof !== "object" || Array.isArray(proof)) {
    return {
      present: false,
      status: "not_provided",
      verified: null,
      code: null,
      message: null
    };
  }

  const protocol = typeof proof.protocol === "string" ? proof.protocol.trim().toLowerCase() : "";
  if (!protocol || !SUPPORTED_X402_ZK_PROTOCOLS.has(protocol)) {
    return {
      present: true,
      protocol: protocol || null,
      status: "unsupported_protocol",
      verified: false,
      code: "X402_ZK_PROOF_PROTOCOL_UNSUPPORTED",
      message: "proof.protocol is not supported"
    };
  }

  const requiredProtocolNormalized = typeof requiredProtocol === "string" ? requiredProtocol.trim().toLowerCase() : null;
  if (requiredProtocolNormalized && protocol !== requiredProtocolNormalized) {
    return {
      present: true,
      protocol,
      status: "protocol_mismatch",
      verified: false,
      code: "X402_ZK_PROOF_PROTOCOL_MISMATCH",
      message: "proof protocol does not match required policy protocol",
      details: {
        requiredProtocol: requiredProtocolNormalized
      }
    };
  }

  if (!CRYPTOGRAPHIC_ZK_PROTOCOLS.has(protocol)) {
    return {
      present: true,
      protocol,
      status: "unsupported_protocol",
      verified: false,
      code: "X402_ZK_PROOF_PROTOCOL_UNSUPPORTED",
      message: "proof protocol is not supported by verifier"
    };
  }

  const proofVerificationKey =
    proof.verificationKey && typeof proof.verificationKey === "object" && !Array.isArray(proof.verificationKey)
      ? proof.verificationKey
      : null;
  const policyVerificationKey =
    verificationKey && typeof verificationKey === "object" && !Array.isArray(verificationKey) ? verificationKey : null;
  const effectiveVerificationKey = policyVerificationKey ?? proofVerificationKey;
  if (!effectiveVerificationKey) {
    return {
      present: true,
      protocol,
      status: "verification_key_missing",
      verified: false,
      code: "X402_ZK_PROOF_VERIFICATION_KEY_MISSING",
      message: "proof verification key is required"
    };
  }

  const proofVerificationKeyRef = normalizeOptionalRef(proof.verificationKeyRef ?? null);
  const expectedVerificationKeyRefNormalized = normalizeOptionalRef(expectedVerificationKeyRef);
  if (
    expectedVerificationKeyRefNormalized &&
    proofVerificationKeyRef &&
    proofVerificationKeyRef !== expectedVerificationKeyRefNormalized
  ) {
    return {
      present: true,
      protocol,
      status: "verification_key_ref_mismatch",
      verified: false,
      code: "X402_ZK_PROOF_VERIFICATION_KEY_REF_MISMATCH",
      message: "proof verification key ref does not match policy",
      details: {
        expectedVerificationKeyRef: expectedVerificationKeyRefNormalized,
        verificationKeyRef: proofVerificationKeyRef
      }
    };
  }
  if (expectedVerificationKeyRefNormalized && !proofVerificationKeyRef && !proofVerificationKey) {
    return {
      present: true,
      protocol,
      status: "verification_key_ref_missing",
      verified: false,
      code: "X402_ZK_PROOF_VERIFICATION_KEY_REF_REQUIRED",
      message: "proof verification key ref is required by policy",
      details: {
        expectedVerificationKeyRef: expectedVerificationKeyRefNormalized
      }
    };
  }

  const expected = expectedBindings && typeof expectedBindings === "object" && !Array.isArray(expectedBindings) ? expectedBindings : null;
  if (expected) {
    const checks = [
      {
        proofField: "statementHashSha256",
        expectedField: "statementHashSha256",
        mismatchCode: "X402_ZK_PROOF_STATEMENT_HASH_MISMATCH",
        missingCode: "X402_ZK_PROOF_STATEMENT_HASH_REQUIRED"
      },
      {
        proofField: "inputDigestSha256",
        expectedField: "inputDigestSha256",
        mismatchCode: "X402_ZK_PROOF_INPUT_DIGEST_MISMATCH",
        missingCode: "X402_ZK_PROOF_INPUT_DIGEST_REQUIRED"
      },
      {
        proofField: "outputDigestSha256",
        expectedField: "outputDigestSha256",
        mismatchCode: "X402_ZK_PROOF_OUTPUT_DIGEST_MISMATCH",
        missingCode: "X402_ZK_PROOF_OUTPUT_DIGEST_REQUIRED"
      }
    ];
    for (const check of checks) {
      const expectedValue = normalizeOptionalSha256(expected[check.expectedField]);
      if (!expectedValue) continue;
      const proofValue = normalizeOptionalSha256(proof[check.proofField]);
      if (!proofValue) {
        if (requireBindings) {
          return {
            present: true,
            protocol,
            status: "binding_missing",
            verified: false,
            code: check.missingCode,
            message: `${check.proofField} is required for binding`
          };
        }
        continue;
      }
      if (proofValue !== expectedValue) {
        return {
          present: true,
          protocol,
          status: "binding_mismatch",
          verified: false,
          code: check.mismatchCode,
          message: `${check.proofField} does not match expected binding`,
          details: {
            expectedField: check.expectedField
          }
        };
      }
    }
  }

  if (!Array.isArray(proof.publicSignals)) {
    return {
      present: true,
      protocol,
      status: "malformed",
      verified: false,
      code: "X402_ZK_PROOF_PUBLIC_SIGNALS_INVALID",
      message: "proof.publicSignals must be an array"
    };
  }
  if (!proof.proofData || typeof proof.proofData !== "object" || Array.isArray(proof.proofData)) {
    return {
      present: true,
      protocol,
      status: "malformed",
      verified: false,
      code: "X402_ZK_PROOF_DATA_INVALID",
      message: "proof.proofData must be an object"
    };
  }

  const adapterMap =
    protocolAdapters && typeof protocolAdapters === "object" && !Array.isArray(protocolAdapters) ? protocolAdapters : null;
  let verifierFn = adapterMap && typeof adapterMap[protocol] === "function" ? adapterMap[protocol] : null;
  if (!verifierFn) {
    let snarkjs;
    try {
      snarkjs = await loadSnarkJs();
    } catch (err) {
      return {
        present: true,
        protocol,
        status: "verifier_unavailable",
        verified: false,
        code: "X402_ZK_VERIFIER_UNAVAILABLE",
        message: "snarkjs verifier is unavailable",
        details: {
          error: err?.message ?? String(err ?? "")
        }
      };
    }
    if (protocol === "groth16") verifierFn = snarkjs?.groth16?.verify;
    if (protocol === "plonk") verifierFn = snarkjs?.plonk?.verify;
  }
  if (typeof verifierFn !== "function") {
    return {
      present: true,
      protocol,
      status: "verifier_unavailable",
      verified: false,
      code: "X402_ZK_VERIFIER_UNAVAILABLE",
      message: `no verifier is configured for protocol ${protocol}`
    };
  }

  try {
    const ok = await verifierFn(effectiveVerificationKey, proof.publicSignals, proof.proofData);
    if (ok === true) {
      return {
        present: true,
        protocol,
        status: "verified",
        verified: true,
        code: null,
        message: null
      };
    }
    return {
      present: true,
      protocol,
      status: "invalid",
      verified: false,
      code: "X402_ZK_PROOF_INVALID",
      message: "proof verification failed"
    };
  } catch (err) {
    return {
      present: true,
      protocol,
      status: "invalid",
      verified: false,
      code: "X402_ZK_PROOF_INVALID",
      message: "proof verification failed",
      details: {
        error: err?.message ?? String(err ?? "")
      }
    };
  } finally {
    if (!adapterMap) {
      await terminateSnarkCurves();
    }
  }
}
