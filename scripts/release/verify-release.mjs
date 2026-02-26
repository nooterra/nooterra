import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

import {
  sha256FileHex,
  verifyIndexSignature,
  unwrapSignaturesV1,
  loadReleaseTrust,
  assertNoDuplicatePaths,
  cmpString,
  writeCanonicalJsonFile
} from "./release-index-lib.mjs";

function usage() {
  // eslint-disable-next-line no-console
  console.error(
    "usage: node scripts/release/verify-release.mjs --dir <release-assets-dir> [--index <release_index_v1.json>] [--sig <release_index_v1.sig>] [--trust <ReleaseTrust.v1|v2.json>] [--format json|text] [--out <path>]"
  );
  process.exit(2);
}

function writeStdout(text) {
  fsSync.writeFileSync(1, Buffer.from(String(text ?? ""), "utf8"));
}

function parseArgs(argv) {
  const out = { dir: null, indexPath: null, sigPath: null, trustPath: null, format: "text", outPath: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--dir") {
      out.dir = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--index") {
      out.indexPath = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--sig") {
      out.sigPath = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--trust") {
      out.trustPath = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--format") {
      out.format = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--out") {
      out.outPath = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--help" || a === "-h") usage();
    usage();
  }
  if (!out.dir) usage();
  if (out.format !== "text" && out.format !== "json") usage();
  return out;
}

function addError(list, code, message, p = null) {
  list.push({ code, message, path: p });
}

function normalizeDirDefaultTrustPath() {
  const candidate = path.resolve(process.cwd(), "trust/release-trust.json");
  try {
    if (fsSync.existsSync(candidate)) return candidate;
  } catch {
    // ignore
  }
  return null;
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = path.resolve(process.cwd(), args.dir);
  const indexPath = path.resolve(process.cwd(), args.indexPath ?? path.join(dir, "release_index_v1.json"));
  const sigPath = path.resolve(process.cwd(), args.sigPath ?? path.join(dir, "release_index_v1.sig"));

  const errors = [];
  const warnings = [];

  const indexJson = JSON.parse(await fs.readFile(indexPath, "utf8"));
  const sigJsonRaw = JSON.parse(await fs.readFile(sigPath, "utf8"));
  const sigList = unwrapSignaturesV1(sigJsonRaw);

  const tag = String(indexJson?.release?.tag ?? "");
  const version = String(indexJson?.release?.version ?? "");
  const commit = indexJson?.toolchain?.commit ?? null;

  const trustPath = args.trustPath ? path.resolve(process.cwd(), args.trustPath) : normalizeDirDefaultTrustPath();
  if (!trustPath) addError(errors, "RELEASE_TRUST_MISSING", "missing release trust file (pass --trust or place trust/release-trust.json)", null);

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

  const validSigners = new Set();
  let signatureOk = false;

  if (trust && sigList.length) {
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
    if (!countOk || !requiredOk) {
      addError(errors, "RELEASE_SIGNATURE_QUORUM_NOT_SATISFIED", "release signature quorum not satisfied", null);
    }
  } else if (trust && !sigList.length) {
    addError(errors, "RELEASE_SIGNATURE_INVALID", "signature file missing/invalid", null);
  }

  const artifacts = Array.isArray(indexJson?.artifacts) ? indexJson.artifacts : [];
  try {
    assertNoDuplicatePaths(artifacts);
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

  errors.sort((a, b) => cmpString(a.path ?? "", b.path ?? "") || cmpString(a.code ?? "", b.code ?? ""));
  const ok = signatureOk && artifactsOk && errors.length === 0;

  const out = {
    schemaVersion: "VerifyReleaseOutput.v1",
    ok,
    release: { tag, version, commit },
    signatureOk,
    artifactsOk,
    errors,
    warnings
  };

  const textLines = [];
  textLines.push("nooterra-verify-release");
  textLines.push(`ok=${ok ? "true" : "false"}`);
  textLines.push(`release.tag=${tag}`);
  textLines.push(`release.version=${version}`);
  textLines.push(`release.commit=${commit ?? ""}`);
  textLines.push(`signature.ok=${signatureOk ? "true" : "false"}`);
  textLines.push(`artifacts.ok=${artifactsOk ? "true" : "false"}`);
  for (const e of errors) textLines.push(`error=${e.code} path=${e.path ?? ""} msg=${e.message}`);

  if (args.outPath) {
    await writeCanonicalJsonFile(path.resolve(process.cwd(), args.outPath), out);
  }

  if (args.format === "json") {
    writeStdout(JSON.stringify(out, null, 2) + "\n");
  } else {
    writeStdout(textLines.join("\n") + "\n");
  }

  process.exit(ok ? 0 : 1);
}

await main();
