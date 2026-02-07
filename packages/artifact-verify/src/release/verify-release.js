import fs from "node:fs/promises";
import path from "node:path";

import {
  sha256FileHex,
  unwrapSignaturesV1,
  verifyIndexSignature,
  loadReleaseTrust,
  cmpString
} from "./release-index-lib.js";

function addError(list, code, message, p = null) {
  list.push({ code, message, path: p });
}

function signatureTimeFromIndex(indexJson) {
  const n = indexJson?.toolchain?.buildEpochSeconds;
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function keyIsUsableAtTime(key, signatureTime) {
  if (signatureTime === null) return true;
  const nb = key.notBeforeEpochSeconds;
  const na = key.notAfterEpochSeconds;
  const rv = key.revokedAtEpochSeconds;
  if (Number.isInteger(nb) && signatureTime < nb) return false;
  if (Number.isInteger(na) && signatureTime > na) return false;
  if (Number.isInteger(rv) && signatureTime >= rv) return false;
  return true;
}

export async function verifyReleaseDir({ dir, trustPath }) {
  const errors = [];
  const warnings = [];

  const indexPath = path.join(dir, "release_index_v1.json");
  const sigPath = path.join(dir, "release_index_v1.sig");

  let indexJson = null;
  let sigJsonRaw = null;
  try {
    indexJson = JSON.parse(await fs.readFile(indexPath, "utf8"));
  } catch (e) {
    addError(errors, "RELEASE_INDEX_INVALID", e?.message ?? String(e), "release_index_v1.json");
  }
  try {
    sigJsonRaw = JSON.parse(await fs.readFile(sigPath, "utf8"));
  } catch (e) {
    addError(errors, "RELEASE_SIGNATURE_INVALID", e?.message ?? String(e), "release_index_v1.sig");
  }

  const tag = String(indexJson?.release?.tag ?? "");
  const version = String(indexJson?.release?.version ?? "");
  const commit = indexJson?.toolchain?.commit ?? null;

  if (!trustPath) addError(errors, "RELEASE_TRUST_MISSING", "missing release trust file (pass --trust-file)", null);

  let trust = null;
  if (trustPath) {
    try {
      trust = await loadReleaseTrust({ trustPath });
    } catch (e) {
      addError(errors, "RELEASE_TRUST_INVALID", e?.message ?? String(e), null);
    }
  }

  const signatureTime = signatureTimeFromIndex(indexJson);
  const trustRequiresTime = trust?.schemaVersion === "ReleaseTrust.v2" && trust.keys.some((k) => k.notBeforeEpochSeconds !== null || k.notAfterEpochSeconds !== null || k.revokedAtEpochSeconds !== null);
  if (trustRequiresTime && signatureTime === null) {
    addError(errors, "RELEASE_INDEX_INVALID", "ReleaseIndex.v1.toolchain.buildEpochSeconds required for time-based release trust", null);
  }

  const sigList = unwrapSignaturesV1(sigJsonRaw);
  const validSigners = new Set();
  let signatureOk = false;

  if (trust && !sigList.length && sigJsonRaw && indexJson) {
    addError(errors, "RELEASE_SIGNATURE_INVALID", "signature file missing/invalid", "release_index_v1.sig");
  }

  if (trust && sigList.length && indexJson) {
    for (const sigJson of sigList) {
      const keyId = typeof sigJson?.keyId === "string" && sigJson.keyId.trim() ? sigJson.keyId.trim() : null;
      if (!keyId) {
        addError(errors, "RELEASE_SIGNATURE_INVALID", "signature missing keyId", null);
        continue;
      }

      const trustKey = trust.keys.find((k) => k.keyId === keyId) ?? null;
      if (!trustKey) {
        addError(errors, "RELEASE_SIGNER_UNAUTHORIZED", "signer keyId not in release trust", null);
        continue;
      }

      if (trust?.schemaVersion === "ReleaseTrust.v2" && signatureTime !== null) {
        const rv = trustKey.revokedAtEpochSeconds;
        if (Number.isInteger(rv) && signatureTime >= rv) {
          addError(errors, "RELEASE_SIGNER_REVOKED", "signer keyId revoked for this release time", null);
          continue;
        }
        if (!keyIsUsableAtTime(trustKey, signatureTime)) {
          addError(errors, "RELEASE_SIGNER_UNAUTHORIZED", "signer keyId not valid for this release time", null);
          continue;
        }
      }

      const sigCheck = verifyIndexSignature({ indexJson, signatureJson: sigJson, trustedPublicKeyPem: trustKey.publicKeyPem });
      for (const e of sigCheck.errors) {
        const mapped =
          e.code === "SIGNATURE_UNSUPPORTED_ALGORITHM"
            ? "RELEASE_SIGNATURE_UNSUPPORTED_ALGORITHM"
            : "RELEASE_SIGNATURE_INVALID";
        addError(errors, mapped, e.message, e.path ?? null);
      }
      if (sigCheck.ok) validSigners.add(keyId);
    }

    const minSignatures = trust.policy?.minSignatures ?? 1;
    const requiredKeyIds = Array.isArray(trust.policy?.requiredKeyIds) ? trust.policy.requiredKeyIds : null;
    const countOk = validSigners.size >= minSignatures;
    const requiredOk = !requiredKeyIds || requiredKeyIds.every((kid) => validSigners.has(kid));
    signatureOk = countOk && requiredOk;
    if (!signatureOk) {
      addError(errors, "RELEASE_SIGNATURE_QUORUM_NOT_SATISFIED", "release signature quorum not satisfied", null);
    }
  }

  const artifacts = Array.isArray(indexJson?.artifacts) ? indexJson.artifacts : [];

  // Duplicate paths
  try {
    const seen = new Set();
    for (const a of artifacts) {
      const rel = String(a?.path ?? "");
      if (!rel) continue;
      if (seen.has(rel)) throw new Error(`duplicate artifact path: ${rel}`);
      seen.add(rel);
    }
  } catch (e) {
    addError(errors, "RELEASE_ARTIFACTS_DUPLICATE_PATH", e?.message ?? String(e), null);
  }

  let artifactsOk = true;
  for (const a of artifacts) {
    const rel = typeof a?.path === "string" ? a.path : "";
    const expected = typeof a?.sha256 === "string" ? a.sha256 : "";
    const expectedSize = typeof a?.sizeBytes === "number" ? a.sizeBytes : null;
    if (!rel || !expected) {
      artifactsOk = false;
      addError(errors, "RELEASE_ASSET_ENTRY_INVALID", "artifact entry missing required fields", rel || null);
      continue;
    }
    const fp = path.join(dir, rel);
    try {
      // eslint-disable-next-line no-await-in-loop
      const st = await fs.stat(fp);
      if (!st.isFile()) throw new Error("not a file");
      if (expectedSize !== null && st.size !== expectedSize) {
        artifactsOk = false;
        addError(errors, "RELEASE_ASSET_SIZE_MISMATCH", `size mismatch expected=${expectedSize} actual=${st.size}`, rel);
      }
      // eslint-disable-next-line no-await-in-loop
      const actual = await sha256FileHex(fp);
      if (String(actual) !== String(expected).toLowerCase()) {
        artifactsOk = false;
        addError(errors, "RELEASE_ASSET_HASH_MISMATCH", `sha256 mismatch expected=${expected} actual=${actual}`, rel);
      }
    } catch (e) {
      artifactsOk = false;
      addError(errors, "RELEASE_ASSET_MISSING", e?.message ?? String(e), rel);
    }
  }

  const ok = signatureOk && artifactsOk && errors.length === 0;

  errors.sort((a, b) => cmpString(a.path ?? "", b.path ?? "") || cmpString(a.code ?? "", b.code ?? ""));

  return {
    schemaVersion: "VerifyReleaseOutput.v1",
    ok,
    release: { tag, version, commit },
    signatureOk,
    artifactsOk,
    errors,
    warnings
  };
}
