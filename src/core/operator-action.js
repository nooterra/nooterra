import { canonicalJsonStringify, normalizeForCanonicalJson } from "./canonical-json.js";
import { keyIdFromPublicKeyPem, sha256Hex, signHashHexEd25519, verifyHashHexEd25519 } from "./crypto.js";

export const OPERATOR_ACTION_SCHEMA_VERSION = "OperatorAction.v1";
export const OPERATOR_ACTION_SIGNATURE_SCHEMA_VERSION = "OperatorActionSignature.v1";

const ALLOWED_CASE_KINDS = new Set(["challenge", "dispute", "escalation"]);
const ALLOWED_ACTIONS = new Set(["APPROVE", "REJECT", "REQUEST_INFO", "OVERRIDE_ALLOW", "OVERRIDE_DENY"]);

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new TypeError(`${name} must be a plain object`);
  }
}

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
  return String(value).trim();
}

function assertIsoDateTime(value, name) {
  const out = assertNonEmptyString(value, name);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(out)) throw new TypeError(`${name} must be an ISO date-time`);
  if (!Number.isFinite(Date.parse(out))) throw new TypeError(`${name} must be an ISO date-time`);
  return new Date(out).toISOString();
}

function assertPemString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty PEM string`);
  return value;
}

function assertId(value, name, { max = 200 } = {}) {
  const out = assertNonEmptyString(value, name);
  if (out.length > max) throw new TypeError(`${name} must be <= ${max} chars`);
  if (!/^[A-Za-z0-9:._/-]+$/.test(out)) throw new TypeError(`${name} must match ^[A-Za-z0-9:._/-]+$`);
  return out;
}

function assertOptionalId(value, name, { max = 200 } = {}) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  return assertId(value, name, { max });
}

function assertSha256Hex(value, name) {
  const out = assertNonEmptyString(value, name).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(out)) throw new TypeError(`${name} must be sha256 hex`);
  return out;
}

function assertAction(value, name = "action.action") {
  const out = assertNonEmptyString(value, name).toUpperCase();
  if (!ALLOWED_ACTIONS.has(out)) {
    throw new TypeError(`${name} must be APPROVE|REJECT|REQUEST_INFO|OVERRIDE_ALLOW|OVERRIDE_DENY`);
  }
  return out;
}

function assertJustificationCode(value, name = "action.justificationCode") {
  const out = assertNonEmptyString(value, name).toUpperCase();
  if (out.length > 128) throw new TypeError(`${name} must be <= 128 chars`);
  if (!/^[A-Z][A-Z0-9._:-]*$/.test(out)) throw new TypeError(`${name} must match ^[A-Z][A-Z0-9._:-]*$`);
  return out;
}

function assertOptionalJustificationText(value, name = "action.justification", { max = 2000 } = {}) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const out = String(value).trim();
  if (out.length > max) throw new TypeError(`${name} must be <= ${max} chars`);
  return out;
}

function assertOptionalToken(value, name, { max = 128 } = {}) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const out = String(value).trim().toLowerCase();
  if (out.length > max) throw new TypeError(`${name} must be <= ${max} chars`);
  if (!/^[a-z0-9._:-]+$/.test(out)) throw new TypeError(`${name} must match ^[a-z0-9._:-]+$`);
  return out;
}

function normalizeCaseRef(action) {
  const caseRefRaw = action.caseRef;
  if (!caseRefRaw || typeof caseRefRaw !== "object" || Array.isArray(caseRefRaw)) {
    throw new TypeError("action.caseRef must be an object");
  }
  const caseKind = assertNonEmptyString(caseRefRaw.kind, "action.caseRef.kind").toLowerCase();
  if (!ALLOWED_CASE_KINDS.has(caseKind)) {
    throw new TypeError("action.caseRef.kind must be challenge|dispute|escalation");
  }
  return normalizeForCanonicalJson(
    {
      kind: caseKind,
      caseId: assertId(caseRefRaw.caseId, "action.caseRef.caseId", { max: 240 })
    },
    { path: "$.caseRef" }
  );
}

function normalizeActor(actor) {
  assertPlainObject(actor, "action.actor");
  const operatorId = assertOptionalId(actor.operatorId ?? actor.id, "action.actor.operatorId", { max: 200 });
  if (!operatorId) throw new TypeError("action.actor.operatorId is required");
  const role = assertOptionalToken(actor.role, "action.actor.role", { max: 128 });
  const tenantId = assertOptionalId(actor.tenantId, "action.actor.tenantId", { max: 128 });
  const sessionId = assertOptionalId(actor.sessionId, "action.actor.sessionId", { max: 256 });
  let metadata = null;
  if (Object.prototype.hasOwnProperty.call(actor, "metadata")) {
    assertPlainObject(actor.metadata, "action.actor.metadata");
    metadata = normalizeForCanonicalJson(actor.metadata, { path: "$.actor.metadata" });
  }
  return normalizeForCanonicalJson(
    {
      operatorId,
      ...(role ? { role } : {}),
      ...(tenantId ? { tenantId } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(metadata ? { metadata } : {})
    },
    { path: "$.actor" }
  );
}

function normalizeOperatorActionSignature(signature) {
  assertPlainObject(signature, "action.signature");
  return normalizeForCanonicalJson(
    {
      schemaVersion: (() => {
        const schemaVersion = assertNonEmptyString(signature.schemaVersion, "action.signature.schemaVersion");
        if (schemaVersion !== OPERATOR_ACTION_SIGNATURE_SCHEMA_VERSION) {
          throw new TypeError(`action.signature.schemaVersion must be ${OPERATOR_ACTION_SIGNATURE_SCHEMA_VERSION}`);
        }
        return schemaVersion;
      })(),
      algorithm: (() => {
        const algorithm = assertNonEmptyString(signature.algorithm, "action.signature.algorithm").toLowerCase();
        if (algorithm !== "ed25519") throw new TypeError("action.signature.algorithm must be ed25519");
        return "ed25519";
      })(),
      keyId: assertId(signature.keyId, "action.signature.keyId", { max: 256 }),
      signedAt: assertIsoDateTime(signature.signedAt, "action.signature.signedAt"),
      actionHash: assertSha256Hex(signature.actionHash, "action.signature.actionHash"),
      signatureBase64: assertNonEmptyString(signature.signatureBase64, "action.signature.signatureBase64")
    },
    { path: "$.signature" }
  );
}

export function buildOperatorActionV1(action = {}) {
  assertPlainObject(action, "action");
  if (action.schemaVersion !== undefined && action.schemaVersion !== null) {
    const schemaVersion = assertNonEmptyString(action.schemaVersion, "action.schemaVersion");
    if (schemaVersion !== OPERATOR_ACTION_SCHEMA_VERSION) {
      throw new TypeError(`action.schemaVersion must be ${OPERATOR_ACTION_SCHEMA_VERSION}`);
    }
  }

  let metadata = null;
  if (Object.prototype.hasOwnProperty.call(action, "metadata")) {
    assertPlainObject(action.metadata, "action.metadata");
    metadata = normalizeForCanonicalJson(action.metadata, { path: "$.metadata" });
  }

  const normalized = normalizeForCanonicalJson(
    {
      schemaVersion: OPERATOR_ACTION_SCHEMA_VERSION,
      ...(assertOptionalId(action.actionId, "action.actionId", { max: 240 })
        ? { actionId: assertOptionalId(action.actionId, "action.actionId", { max: 240 }) }
        : {}),
      caseRef: normalizeCaseRef(action),
      action: assertAction(action.action),
      justificationCode: assertJustificationCode(action.justificationCode),
      ...(assertOptionalJustificationText(action.justification) ? { justification: assertOptionalJustificationText(action.justification) } : {}),
      actor: normalizeActor(action.actor),
      actedAt: assertIsoDateTime(action.actedAt, "action.actedAt"),
      ...(metadata ? { metadata } : {})
    },
    { path: "$" }
  );

  return normalized;
}

function normalizeSignedOperatorActionV1(action = {}) {
  const normalizedAction = buildOperatorActionV1(action);
  const signature = normalizeOperatorActionSignature(action.signature);
  return normalizeForCanonicalJson(
    {
      ...normalizedAction,
      signature
    },
    { path: "$" }
  );
}

export function computeOperatorActionHashV1({ action } = {}) {
  const normalizedAction = buildOperatorActionV1(action ?? {});
  return sha256Hex(canonicalJsonStringify(normalizedAction));
}

export function signOperatorActionV1({ action, signedAt, publicKeyPem, privateKeyPem } = {}) {
  const normalizedAction = buildOperatorActionV1(action ?? {});
  const signerPublicKeyPem = assertPemString(publicKeyPem, "publicKeyPem");
  const signerPrivateKeyPem = assertPemString(privateKeyPem, "privateKeyPem");
  const actionHash = computeOperatorActionHashV1({ action: normalizedAction });
  const signatureBase64 = signHashHexEd25519(actionHash, signerPrivateKeyPem);
  return normalizeForCanonicalJson(
    {
      ...normalizedAction,
      signature: {
        schemaVersion: OPERATOR_ACTION_SIGNATURE_SCHEMA_VERSION,
        algorithm: "ed25519",
        keyId: keyIdFromPublicKeyPem(signerPublicKeyPem),
        signedAt: assertIsoDateTime(signedAt ?? normalizedAction.actedAt, "signedAt"),
        actionHash,
        signatureBase64
      }
    },
    { path: "$" }
  );
}

export function verifyOperatorActionV1({ action, publicKeyPem } = {}) {
  try {
    const signerPublicKeyPem = assertPemString(publicKeyPem, "publicKeyPem");
    assertPlainObject(action, "action");

    const schemaVersion = assertNonEmptyString(action.schemaVersion, "action.schemaVersion");
    if (schemaVersion !== OPERATOR_ACTION_SCHEMA_VERSION) {
      return {
        ok: false,
        code: "OPERATOR_ACTION_SCHEMA_MISMATCH",
        error: `action.schemaVersion must be ${OPERATOR_ACTION_SCHEMA_VERSION}`
      };
    }

    if (!action.signature || typeof action.signature !== "object" || Array.isArray(action.signature)) {
      return {
        ok: false,
        code: "OPERATOR_ACTION_SCHEMA_INVALID",
        error: "action.signature must be an object"
      };
    }

    if (String(action.signature.schemaVersion ?? "") !== OPERATOR_ACTION_SIGNATURE_SCHEMA_VERSION) {
      return {
        ok: false,
        code: "OPERATOR_ACTION_SIGNATURE_SCHEMA_MISMATCH",
        error: `action.signature.schemaVersion must be ${OPERATOR_ACTION_SIGNATURE_SCHEMA_VERSION}`
      };
    }

    const normalized = normalizeSignedOperatorActionV1(action);

    const expectedKeyId = keyIdFromPublicKeyPem(signerPublicKeyPem);
    if (normalized.signature.keyId !== expectedKeyId) {
      return {
        ok: false,
        code: "OPERATOR_ACTION_KEY_ID_MISMATCH",
        error: "signature keyId mismatch"
      };
    }

    const actionHash = computeOperatorActionHashV1({ action: normalized });
    if (normalized.signature.actionHash !== actionHash) {
      return {
        ok: false,
        code: "OPERATOR_ACTION_HASH_MISMATCH",
        error: "action hash mismatch"
      };
    }

    const signatureValid = verifyHashHexEd25519({
      hashHex: actionHash,
      signatureBase64: normalized.signature.signatureBase64,
      publicKeyPem: signerPublicKeyPem
    });
    if (!signatureValid) {
      return {
        ok: false,
        code: "OPERATOR_ACTION_SIGNATURE_INVALID",
        error: "signature invalid"
      };
    }

    const normalizedAction = buildOperatorActionV1(normalized);
    return {
      ok: true,
      code: null,
      error: null,
      actionHash,
      keyId: normalized.signature.keyId,
      action: normalizedAction,
      signedAction: normalized
    };
  } catch (err) {
    return {
      ok: false,
      code: "OPERATOR_ACTION_SCHEMA_INVALID",
      error: err?.message ?? String(err ?? "")
    };
  }
}
