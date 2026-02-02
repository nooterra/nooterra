import { canonicalJsonStringify } from "./canonical-json.js";
import { sha256HexUtf8, verifyHashHexEd25519 } from "./crypto.js";

export const REVOCATION_LIST_SCHEMA_V1 = "RevocationList.v1";

function stripRevocationListSig(list) {
  const { listHash: _h, signature: _sig, ...rest } = list ?? {};
  return rest;
}

function normalizeIsoOrNull(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const s = value.trim();
  const t = Date.parse(s);
  return Number.isFinite(t) ? s : null;
}

export function parseRevocationListV1(listJson) {
  if (!listJson || typeof listJson !== "object" || Array.isArray(listJson)) return { ok: false, error: "revocation list must be an object" };
  if (String(listJson.schemaVersion ?? "") !== REVOCATION_LIST_SCHEMA_V1) {
    return { ok: false, error: "unsupported revocation list schemaVersion", schemaVersion: listJson.schemaVersion ?? null };
  }
  const listId = typeof listJson.listId === "string" && listJson.listId.trim() ? listJson.listId.trim() : null;
  const generatedAt = normalizeIsoOrNull(listJson.generatedAt ?? null) ?? (typeof listJson.generatedAt === "string" ? listJson.generatedAt : null);
  if (!listId) return { ok: false, error: "revocation list listId missing" };
  if (!generatedAt) return { ok: false, error: "revocation list generatedAt missing" };

  const rotations = Array.isArray(listJson.rotations) ? listJson.rotations : null;
  const revocations = Array.isArray(listJson.revocations) ? listJson.revocations : null;
  if (!rotations) return { ok: false, error: "revocation list rotations must be an array" };
  if (!revocations) return { ok: false, error: "revocation list revocations must be an array" };

  const parsedRotations = [];
  for (const r of rotations) {
    const oldKeyId = typeof r?.oldKeyId === "string" && r.oldKeyId.trim() ? r.oldKeyId.trim() : null;
    const newKeyId = typeof r?.newKeyId === "string" && r.newKeyId.trim() ? r.newKeyId.trim() : null;
    const rotatedAt = normalizeIsoOrNull(r?.rotatedAt ?? null) ?? (typeof r?.rotatedAt === "string" ? r.rotatedAt : null);
    if (!oldKeyId || !newKeyId || !rotatedAt) continue;
    parsedRotations.push({ oldKeyId, newKeyId, rotatedAt, reason: r?.reason ?? null, scope: r?.scope ?? null });
  }

  const parsedRevocations = [];
  for (const r of revocations) {
    const keyId = typeof r?.keyId === "string" && r.keyId.trim() ? r.keyId.trim() : null;
    const revokedAt = normalizeIsoOrNull(r?.revokedAt ?? null) ?? (typeof r?.revokedAt === "string" ? r.revokedAt : null);
    if (!keyId || !revokedAt) continue;
    parsedRevocations.push({ keyId, revokedAt, reason: r?.reason ?? null, scope: r?.scope ?? null });
  }

  const signerKeyId = typeof listJson.signerKeyId === "string" && listJson.signerKeyId.trim() ? listJson.signerKeyId.trim() : null;
  const signedAt = typeof listJson.signedAt === "string" && listJson.signedAt.trim() ? listJson.signedAt.trim() : null;
  const listHash = typeof listJson.listHash === "string" && listJson.listHash.trim() ? listJson.listHash.trim() : null;
  const signature = typeof listJson.signature === "string" && listJson.signature.trim() ? listJson.signature.trim() : null;

  return {
    ok: true,
    list: {
      schemaVersion: REVOCATION_LIST_SCHEMA_V1,
      listId,
      generatedAt,
      rotations: parsedRotations,
      revocations: parsedRevocations,
      signerKeyId,
      signedAt,
      listHash,
      signature
    }
  };
}

export function verifyRevocationListV1Signature({ list, trustedGovernanceRootPublicKeyByKeyId } = {}) {
  if (!list || typeof list !== "object" || Array.isArray(list)) return { ok: false, error: "list must be an object" };
  if (String(list.schemaVersion ?? "") !== REVOCATION_LIST_SCHEMA_V1) return { ok: false, error: "unsupported revocation list schemaVersion" };
  if (!(trustedGovernanceRootPublicKeyByKeyId instanceof Map)) return { ok: false, error: "trustedGovernanceRootPublicKeyByKeyId must be a Map" };
  const signerKeyId = typeof list.signerKeyId === "string" && list.signerKeyId.trim() ? list.signerKeyId.trim() : null;
  const signature = typeof list.signature === "string" && list.signature.trim() ? list.signature.trim() : null;
  const declaredHash = typeof list.listHash === "string" && list.listHash.trim() ? list.listHash.trim() : null;
  if (!signerKeyId || !signature || !declaredHash) return { ok: false, error: "revocation list missing signature fields" };
  const publicKeyPem = trustedGovernanceRootPublicKeyByKeyId.get(signerKeyId) ?? null;
  if (!publicKeyPem) return { ok: false, error: "revocation list signerKeyId not trusted", signerKeyId };

  const core = stripRevocationListSig(list);
  const expectedHash = sha256HexUtf8(canonicalJsonStringify(core));
  if (expectedHash !== declaredHash) return { ok: false, error: "revocation listHash mismatch", expected: expectedHash, actual: declaredHash };

  const okSig = verifyHashHexEd25519({ hashHex: expectedHash, signatureBase64: signature, publicKeyPem });
  if (!okSig) return { ok: false, error: "revocation list signature invalid", signerKeyId };
  return { ok: true, listHash: expectedHash, signerKeyId };
}

export function deriveKeyTimelineFromRevocationList(list) {
  const timeline = new Map(); // keyId -> { rotatedAt, revokedAt, validFrom }
  for (const rot of Array.isArray(list?.rotations) ? list.rotations : []) {
    const rotatedAt = typeof rot?.rotatedAt === "string" && rot.rotatedAt.trim() ? rot.rotatedAt.trim() : null;
    const oldKeyId = typeof rot?.oldKeyId === "string" && rot.oldKeyId.trim() ? rot.oldKeyId.trim() : null;
    const newKeyId = typeof rot?.newKeyId === "string" && rot.newKeyId.trim() ? rot.newKeyId.trim() : null;
    if (!rotatedAt || !oldKeyId || !newKeyId) continue;

    const oldRow = timeline.get(oldKeyId) ?? {};
    if (!oldRow.rotatedAt || Date.parse(rotatedAt) < Date.parse(oldRow.rotatedAt)) oldRow.rotatedAt = rotatedAt;
    timeline.set(oldKeyId, oldRow);

    const newRow = timeline.get(newKeyId) ?? {};
    if (!newRow.validFrom || Date.parse(rotatedAt) < Date.parse(newRow.validFrom)) newRow.validFrom = rotatedAt;
    timeline.set(newKeyId, newRow);
  }

  for (const rev of Array.isArray(list?.revocations) ? list.revocations : []) {
    const revokedAt = typeof rev?.revokedAt === "string" && rev.revokedAt.trim() ? rev.revokedAt.trim() : null;
    const keyId = typeof rev?.keyId === "string" && rev.keyId.trim() ? rev.keyId.trim() : null;
    if (!revokedAt || !keyId) continue;
    const row = timeline.get(keyId) ?? {};
    if (!row.revokedAt || Date.parse(revokedAt) < Date.parse(row.revokedAt)) row.revokedAt = revokedAt;
    timeline.set(keyId, row);
  }

  return timeline;
}

