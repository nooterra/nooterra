import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { canonicalJsonStringify } from "../../src/core/canonical-json.js";
import { keyIdFromPublicKeyPem } from "../../src/core/crypto.js";

export function sha256Hex(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export async function sha256FileHex(fp) {
  const h = crypto.createHash("sha256");
  const f = await fs.open(fp, "r");
  try {
    const buf = Buffer.alloc(1024 * 1024);
    while (true) {
      // eslint-disable-next-line no-await-in-loop
      const { bytesRead } = await f.read(buf, 0, buf.length, null);
      if (bytesRead === 0) break;
      h.update(buf.subarray(0, bytesRead));
    }
  } finally {
    await f.close();
  }
  return h.digest("hex");
}

export async function listFilesFlat(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    out.push(e.name);
  }
  return out.sort();
}

export function canonicalIndexBytes(indexJson) {
  const canonical = canonicalJsonStringify(indexJson);
  return Buffer.from(canonical, "utf8");
}

export function indexMessageSha256Hex(indexJson) {
  return sha256Hex(canonicalIndexBytes(indexJson));
}

export function signIndex({ indexJson, privateKeyPem }) {
  const messageSha256 = indexMessageSha256Hex(indexJson);
  const messageBytes = Buffer.from(messageSha256, "hex");
  const sig = crypto.sign(null, messageBytes, privateKeyPem).toString("base64");

  const pub = crypto.createPublicKey(crypto.createPrivateKey(privateKeyPem)).export({ type: "spki", format: "pem" });
  const publicKeyPem = String(pub);
  const keyId = keyIdFromPublicKeyPem(publicKeyPem);

  return {
    schemaVersion: "ReleaseIndexSignature.v1",
    algorithm: "ed25519-sha256",
    keyId,
    messageSha256,
    publicKeyPem,
    signatureBase64: sig
  };
}

export function wrapSignaturesV1(signatures) {
  const list = Array.isArray(signatures) ? signatures.filter(Boolean) : [];
  return {
    schemaVersion: "ReleaseIndexSignatures.v1",
    signatures: list
  };
}

export function unwrapSignaturesV1(sigJson) {
  if (sigJson && typeof sigJson === "object" && !Array.isArray(sigJson)) {
    if (sigJson.schemaVersion === "ReleaseIndexSignature.v1") return [sigJson];
    if (sigJson.schemaVersion === "ReleaseIndexSignatures.v1") {
      const arr = Array.isArray(sigJson.signatures) ? sigJson.signatures : [];
      return arr.filter(Boolean);
    }
  }
  return [];
}

export function verifyIndexSignature({ indexJson, signatureJson, trustedPublicKeyPem = null }) {
  const errors = [];
  const messageSha256 = indexMessageSha256Hex(indexJson);

  if (!signatureJson || typeof signatureJson !== "object") {
    errors.push({ code: "SIGNATURE_INVALID", message: "signature JSON missing/invalid", path: null });
    return { ok: false, messageSha256, errors };
  }
  if (signatureJson.schemaVersion !== "ReleaseIndexSignature.v1") {
    errors.push({ code: "SIGNATURE_INVALID", message: "unexpected signature schemaVersion", path: null });
    return { ok: false, messageSha256, errors };
  }
  if (signatureJson.algorithm !== "ed25519-sha256") {
    errors.push({ code: "SIGNATURE_UNSUPPORTED_ALGORITHM", message: "unsupported signature algorithm", path: null });
    return { ok: false, messageSha256, errors };
  }
  if (typeof signatureJson.signatureBase64 !== "string" || !signatureJson.signatureBase64.trim()) {
    errors.push({ code: "SIGNATURE_INVALID", message: "signatureBase64 missing", path: null });
    return { ok: false, messageSha256, errors };
  }

  const publicKeyPem = trustedPublicKeyPem ? String(trustedPublicKeyPem) : String(signatureJson.publicKeyPem ?? "");
  if (!publicKeyPem.trim()) {
    errors.push({ code: "SIGNATURE_INVALID", message: "publicKeyPem missing", path: null });
    return { ok: false, messageSha256, errors };
  }

  if (typeof signatureJson.messageSha256 === "string" && signatureJson.messageSha256.toLowerCase() !== messageSha256) {
    errors.push({ code: "SIGNATURE_MISMATCH", message: "messageSha256 mismatch", path: null });
    return { ok: false, messageSha256, errors };
  }

  try {
    const ok = crypto.verify(
      null,
      Buffer.from(messageSha256, "hex"),
      publicKeyPem,
      Buffer.from(String(signatureJson.signatureBase64), "base64")
    );
    if (!ok) errors.push({ code: "SIGNATURE_INVALID", message: "signature verification failed", path: null });
  } catch (e) {
    errors.push({ code: "SIGNATURE_INVALID", message: `signature verification error: ${e?.message ?? String(e)}`, path: null });
  }

  return { ok: errors.length === 0, messageSha256, errors };
}

export function normalizeReleaseTrust(trustJson) {
  if (!trustJson || typeof trustJson !== "object" || Array.isArray(trustJson)) {
    throw new Error("release trust JSON missing/invalid");
  }

  if (trustJson.schemaVersion === "ReleaseTrust.v1") {
    const roots = trustJson.releaseRoots ?? null;
    if (!roots || typeof roots !== "object" || Array.isArray(roots)) throw new Error("ReleaseTrust.v1.releaseRoots missing/invalid");
    const keys = [];
    for (const [keyId, publicKeyPem] of Object.entries(roots)) {
      if (typeof keyId !== "string" || !keyId.trim()) continue;
      if (typeof publicKeyPem !== "string" || !publicKeyPem.trim()) continue;
      keys.push({ keyId, publicKeyPem });
    }
    keys.sort((a, b) => (a.keyId < b.keyId ? -1 : a.keyId > b.keyId ? 1 : 0));
    return { schemaVersion: "ReleaseTrust.v1", policy: { minSignatures: 1, requiredKeyIds: null }, keys };
  }

  if (trustJson.schemaVersion === "ReleaseTrust.v2") {
    const policy = trustJson.policy ?? null;
    if (!policy || typeof policy !== "object" || Array.isArray(policy)) throw new Error("ReleaseTrust.v2.policy missing/invalid");
    const minSignatures = policy.minSignatures;
    if (!Number.isInteger(minSignatures) || minSignatures < 1) throw new Error("ReleaseTrust.v2.policy.minSignatures missing/invalid");
    const requiredKeyIds = Array.isArray(policy.requiredKeyIds)
      ? policy.requiredKeyIds.filter((v) => typeof v === "string" && v.trim())
      : null;

    const arr = Array.isArray(trustJson.keys) ? trustJson.keys : null;
    if (!arr) throw new Error("ReleaseTrust.v2.keys missing/invalid");
    const keys = [];
    for (const item of arr) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const keyId = typeof item.keyId === "string" && item.keyId.trim() ? item.keyId.trim() : null;
      const publicKeyPem = typeof item.publicKeyPem === "string" && item.publicKeyPem.trim() ? item.publicKeyPem : null;
      if (!keyId || !publicKeyPem) continue;

      const derived = keyIdFromPublicKeyPem(publicKeyPem);
      if (derived !== keyId) throw new Error(`ReleaseTrust.v2 keyId mismatch: declared=${keyId} derived=${derived}`);

      const notBeforeEpochSeconds = Number.isInteger(item.notBeforeEpochSeconds) && item.notBeforeEpochSeconds >= 0 ? item.notBeforeEpochSeconds : null;
      const notAfterEpochSeconds = Number.isInteger(item.notAfterEpochSeconds) && item.notAfterEpochSeconds >= 0 ? item.notAfterEpochSeconds : null;
      const revokedAtEpochSeconds = Number.isInteger(item.revokedAtEpochSeconds) && item.revokedAtEpochSeconds >= 0 ? item.revokedAtEpochSeconds : null;
      const comment = typeof item.comment === "string" && item.comment.trim() ? item.comment : null;

      keys.push({ keyId, publicKeyPem, notBeforeEpochSeconds, notAfterEpochSeconds, revokedAtEpochSeconds, comment });
    }
    keys.sort((a, b) => (a.keyId < b.keyId ? -1 : a.keyId > b.keyId ? 1 : 0));
    return { schemaVersion: "ReleaseTrust.v2", policy: { minSignatures, requiredKeyIds }, keys };
  }

  throw new Error("release trust schemaVersion must be ReleaseTrust.v1 or ReleaseTrust.v2");
}

export async function loadReleaseTrustPublicKeyPem({ trustPath, keyId }) {
  const raw = await fs.readFile(trustPath, "utf8");
  const trust = normalizeReleaseTrust(JSON.parse(raw));
  const pem = trust.keys.find((k) => k.keyId === keyId)?.publicKeyPem ?? null;
  if (typeof pem !== "string" || !pem.trim()) throw new Error(`release trust missing keyId: ${keyId}`);
  return String(pem);
}

export async function loadReleaseTrust({ trustPath }) {
  const raw = await fs.readFile(trustPath, "utf8");
  return normalizeReleaseTrust(JSON.parse(raw));
}

export function classifyArtifactKind(name) {
  if (/^settld-[a-z0-9-]+-\d+\.\d+\.\d+.*\.tgz$/i.test(name)) return "npm-tgz";
  if (/^settld-\d+\.\d+\.\d+.*\.tgz$/i.test(name)) return "helm-chart-tgz";
  if (name.endsWith(".whl")) return "python-wheel";
  if (/^settld_api_sdk_python-.*\.tar\.gz$/i.test(name)) return "python-sdist";
  if (name.endsWith(".tgz")) return "tgz";
  if (name.endsWith(".tar.gz")) return "tar.gz";
  if (name.endsWith(".zip")) return "zip";
  if (name.endsWith("SHA256SUMS") || name.endsWith(".sha256")) return "checksum";
  if (name.endsWith(".spdx.json")) return "sbom";
  return null;
}

export function assertNoDuplicatePaths(artifacts) {
  const seen = new Set();
  for (const a of artifacts) {
    const p = String(a?.path ?? "");
    if (!p) continue;
    if (seen.has(p)) throw new Error(`duplicate artifact path: ${p}`);
    seen.add(p);
  }
}

export async function writeCanonicalJsonFile(fp, json) {
  await fs.writeFile(fp, canonicalJsonStringify(json) + "\n", "utf8");
}

export function cmpString(a, b) {
  const aa = String(a ?? "");
  const bb = String(b ?? "");
  if (aa < bb) return -1;
  if (aa > bb) return 1;
  return 0;
}
