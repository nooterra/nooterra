import { canonicalJsonStringify } from "./canonical-json.js";
import { sha256Hex, signHashHexEd25519 } from "./crypto.js";

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
}

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new TypeError(`${name} must be a plain object`);
}

export const REVOCATION_LIST_SCHEMA_V1 = "RevocationList.v1";

function stripRevocationListSig(list) {
  const { listHash: _h, signature: _sig, ...rest } = list ?? {};
  return rest;
}

export function buildRevocationListV1Core({ listId, generatedAt, rotations = [], revocations = [], signerKeyId, signedAt } = {}) {
  assertNonEmptyString(listId, "listId");
  assertNonEmptyString(generatedAt, "generatedAt");
  if (!Array.isArray(rotations)) throw new TypeError("rotations must be an array");
  if (!Array.isArray(revocations)) throw new TypeError("revocations must be an array");
  assertNonEmptyString(signerKeyId, "signerKeyId");
  assertNonEmptyString(signedAt, "signedAt");
  return {
    schemaVersion: REVOCATION_LIST_SCHEMA_V1,
    listId,
    generatedAt,
    rotations,
    revocations,
    signerKeyId,
    signedAt
  };
}

export function signRevocationListV1({ listCore, signer } = {}) {
  assertPlainObject(listCore, "listCore");
  if (!signer || typeof signer !== "object") throw new TypeError("signer is required");
  assertNonEmptyString(signer.keyId, "signer.keyId");
  assertNonEmptyString(signer.privateKeyPem, "signer.privateKeyPem");

  const core = { ...listCore, signerKeyId: signer.keyId };
  const listHash = sha256Hex(canonicalJsonStringify(core));
  const signature = signHashHexEd25519(listHash, signer.privateKeyPem);
  return { ...core, listHash, signature };
}

export function validateRevocationListV1(list) {
  assertPlainObject(list, "list");
  if (list.schemaVersion !== REVOCATION_LIST_SCHEMA_V1) throw new TypeError("list.schemaVersion must be RevocationList.v1");
  assertNonEmptyString(list.listId, "list.listId");
  assertNonEmptyString(list.generatedAt, "list.generatedAt");
  if (!Array.isArray(list.rotations)) throw new TypeError("list.rotations must be an array");
  if (!Array.isArray(list.revocations)) throw new TypeError("list.revocations must be an array");
  // Signature fields are allowed to be null for non-strict / bootstrap bundles.
  if (list.signerKeyId !== null) assertNonEmptyString(list.signerKeyId, "list.signerKeyId");
  if (list.signedAt !== null) assertNonEmptyString(list.signedAt, "list.signedAt");
  if (list.listHash !== null) assertNonEmptyString(list.listHash, "list.listHash");
  if (list.signature !== null) assertNonEmptyString(list.signature, "list.signature");
  return { ok: true };
}

export function computeRevocationListV1Hash(list) {
  assertPlainObject(list, "list");
  const core = stripRevocationListSig(list);
  return sha256Hex(canonicalJsonStringify(core));
}

