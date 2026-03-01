import { canonicalJsonStringify, normalizeForCanonicalJson } from "./canonical-json.js";
import { sha256Hex } from "./crypto.js";
import { computeMerkleRoot, buildMerkleProof, verifyMerkleProof } from "./merkle-tree.js";

export const IDENTITY_LOG_ENTRY_SCHEMA_VERSION = "IdentityLogEntry.v1";
export const IDENTITY_LOG_PROOF_SCHEMA_VERSION = "IdentityLogProof.v1";
export const IDENTITY_LOG_CHECKPOINT_SCHEMA_VERSION = "IdentityLogCheckpoint.v1";

export const IDENTITY_LOG_OPS_AUDIT_ACTION = "IDENTITY_LOG_APPEND";

export const IDENTITY_LOG_EVENT_TYPE = Object.freeze({
  CREATE: "create",
  ROTATE: "rotate",
  REVOKE: "revoke",
  CAPABILITY_CLAIM_CHANGE: "capability-claim-change"
});

const IDENTITY_LOG_EVENT_TYPES = new Set(Object.values(IDENTITY_LOG_EVENT_TYPE));
const IDENTITY_STATUSES = new Set(["active", "suspended", "revoked"]);

function fail(code, message, details = null) {
  const err = new TypeError(message);
  err.code = code;
  if (details !== null && details !== undefined) err.details = details;
  throw err;
}

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
}

function normalizeNonEmptyString(value, name, { max = 512 } = {}) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
  const normalized = value.trim();
  if (normalized.length > max) throw new TypeError(`${name} must be <= ${max} characters`);
  return normalized;
}

function normalizeOptionalString(value, name, { max = 1024 } = {}) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  if (normalized.length > max) throw new TypeError(`${name} must be <= ${max} characters`);
  return normalized;
}

function normalizeSafeInteger(value, name, { min = 0 } = {}) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < min) throw new TypeError(`${name} must be an integer >= ${min}`);
  return normalized;
}

function normalizeSha256Hex(value, name, { allowNull = false } = {}) {
  if (allowNull && (value === null || value === undefined || String(value).trim() === "")) return null;
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) throw new TypeError(`${name} must be a sha256 hex string`);
  return normalized;
}

function normalizeIsoDateTime(value, name) {
  const normalized = normalizeNonEmptyString(value, name, { max: 128 });
  if (!Number.isFinite(Date.parse(normalized))) throw new TypeError(`${name} must be an ISO date-time`);
  return normalized;
}

function normalizeIdentityStatus(value, name, { allowNull = false } = {}) {
  if (allowNull && (value === null || value === undefined || String(value).trim() === "")) return null;
  const normalized = normalizeNonEmptyString(value, name, { max: 32 }).toLowerCase();
  if (!IDENTITY_STATUSES.has(normalized)) throw new TypeError(`${name} must be active|suspended|revoked`);
  return normalized;
}

function normalizeCapabilities(value, name) {
  const list = Array.isArray(value) ? value : [];
  const dedupe = new Set();
  for (let index = 0; index < list.length; index += 1) {
    const candidate = String(list[index] ?? "").trim();
    if (!candidate) continue;
    dedupe.add(candidate);
  }
  const out = Array.from(dedupe.values());
  out.sort((left, right) => left.localeCompare(right));
  return out;
}

function capabilityListsEqual(left, right) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function normalizeEventType(value) {
  const normalized = normalizeNonEmptyString(value, "eventType", { max: 64 }).toLowerCase();
  if (!IDENTITY_LOG_EVENT_TYPES.has(normalized)) {
    throw new TypeError("eventType must be create|rotate|revoke|capability-claim-change");
  }
  return normalized;
}

function normalizeTrustedCheckpoint(value, name = "trustedCheckpoint") {
  if (value === null || value === undefined) return null;
  assertPlainObject(value, name);
  return {
    treeSize: normalizeSafeInteger(value.treeSize, `${name}.treeSize`, { min: 0 }),
    checkpointHash: normalizeSha256Hex(value.checkpointHash, `${name}.checkpointHash`)
  };
}

export function computeIdentityLogEntryHash(entry) {
  assertPlainObject(entry, "entry");
  const canonical = canonicalJsonStringify(
    normalizeForCanonicalJson(
      {
        ...entry,
        entryHash: null
      },
      { path: "$" }
    )
  );
  return sha256Hex(canonical);
}

function normalizeIdentityLogEntry(entry, { strictHash = true } = {}) {
  assertPlainObject(entry, "entry");
  const eventType = normalizeEventType(entry.eventType);
  const normalized = normalizeForCanonicalJson(
    {
      schemaVersion: IDENTITY_LOG_ENTRY_SCHEMA_VERSION,
      entryId: normalizeNonEmptyString(entry.entryId, "entry.entryId", { max: 200 }),
      tenantId: normalizeNonEmptyString(entry.tenantId, "entry.tenantId", { max: 200 }),
      agentId: normalizeNonEmptyString(entry.agentId, "entry.agentId", { max: 200 }),
      eventType,
      logIndex: normalizeSafeInteger(entry.logIndex, "entry.logIndex", { min: 0 }),
      prevEntryHash: normalizeSha256Hex(entry.prevEntryHash, "entry.prevEntryHash", { allowNull: true }),
      keyIdBefore: normalizeOptionalString(entry.keyIdBefore, "entry.keyIdBefore", { max: 200 }),
      keyIdAfter: normalizeOptionalString(entry.keyIdAfter, "entry.keyIdAfter", { max: 200 }),
      statusBefore: normalizeIdentityStatus(entry.statusBefore, "entry.statusBefore", { allowNull: true }),
      statusAfter: normalizeIdentityStatus(entry.statusAfter, "entry.statusAfter", { allowNull: true }),
      capabilitiesBefore: normalizeCapabilities(entry.capabilitiesBefore, "entry.capabilitiesBefore"),
      capabilitiesAfter: normalizeCapabilities(entry.capabilitiesAfter, "entry.capabilitiesAfter"),
      reasonCode: normalizeOptionalString(entry.reasonCode, "entry.reasonCode", { max: 200 }),
      reason: normalizeOptionalString(entry.reason, "entry.reason", { max: 500 }),
      occurredAt: normalizeIsoDateTime(entry.occurredAt, "entry.occurredAt"),
      recordedAt: normalizeIsoDateTime(entry.recordedAt ?? entry.occurredAt, "entry.recordedAt"),
      metadata:
        entry.metadata && typeof entry.metadata === "object" && !Array.isArray(entry.metadata)
          ? normalizeForCanonicalJson(entry.metadata, { path: "$.metadata" })
          : null,
      entryHash: normalizeSha256Hex(entry.entryHash, "entry.entryHash", { allowNull: !strictHash })
    },
    { path: "$" }
  );

  if (eventType === IDENTITY_LOG_EVENT_TYPE.CREATE) {
    if (!normalized.keyIdAfter) throw new TypeError("create event requires keyIdAfter");
    if (normalized.statusAfter === null) throw new TypeError("create event requires statusAfter");
  }
  if (eventType === IDENTITY_LOG_EVENT_TYPE.ROTATE) {
    if (!normalized.keyIdBefore || !normalized.keyIdAfter) throw new TypeError("rotate event requires keyIdBefore and keyIdAfter");
    if (normalized.keyIdBefore === normalized.keyIdAfter) throw new TypeError("rotate event requires keyIdBefore and keyIdAfter to differ");
  }
  if (eventType === IDENTITY_LOG_EVENT_TYPE.REVOKE) {
    if (normalized.statusAfter !== "revoked") throw new TypeError("revoke event requires statusAfter=revoked");
  }
  if (eventType === IDENTITY_LOG_EVENT_TYPE.CAPABILITY_CLAIM_CHANGE) {
    if (capabilityListsEqual(normalized.capabilitiesBefore, normalized.capabilitiesAfter)) {
      throw new TypeError("capability-claim-change event requires capability delta");
    }
  }

  const expectedEntryHash = computeIdentityLogEntryHash(normalized);
  if (!strictHash) {
    normalized.entryHash = expectedEntryHash;
    return normalized;
  }
  if (normalized.entryHash !== expectedEntryHash) {
    fail("IDENTITY_LOG_ENTRY_HASH_MISMATCH", "entry.entryHash mismatch", {
      entryId: normalized.entryId,
      expectedEntryHash,
      actualEntryHash: normalized.entryHash
    });
  }
  return normalized;
}

export function buildIdentityLogEntry(entry) {
  return normalizeIdentityLogEntry(entry, { strictHash: false });
}

export function validateIdentityLogEntry(entry) {
  return normalizeIdentityLogEntry(entry, { strictHash: true });
}

export function deriveIdentityLogEventTypes({ beforeIdentity = null, afterIdentity } = {}) {
  assertPlainObject(afterIdentity, "afterIdentity");
  const before = beforeIdentity && typeof beforeIdentity === "object" && !Array.isArray(beforeIdentity) ? beforeIdentity : null;
  if (!before) return [IDENTITY_LOG_EVENT_TYPE.CREATE];

  const beforeKeyId = normalizeOptionalString(before?.keys?.keyId ?? null, "beforeIdentity.keys.keyId", { max: 200 });
  const afterKeyId = normalizeOptionalString(afterIdentity?.keys?.keyId ?? null, "afterIdentity.keys.keyId", { max: 200 });
  const beforeStatus = normalizeIdentityStatus(before?.status ?? "active", "beforeIdentity.status", { allowNull: false });
  const afterStatus = normalizeIdentityStatus(afterIdentity?.status ?? "active", "afterIdentity.status", { allowNull: false });
  const beforeCapabilities = normalizeCapabilities(before?.capabilities, "beforeIdentity.capabilities");
  const afterCapabilities = normalizeCapabilities(afterIdentity?.capabilities, "afterIdentity.capabilities");

  const out = [];
  if (beforeKeyId && afterKeyId && beforeKeyId !== afterKeyId) out.push(IDENTITY_LOG_EVENT_TYPE.ROTATE);
  if (beforeStatus !== "revoked" && afterStatus === "revoked") out.push(IDENTITY_LOG_EVENT_TYPE.REVOKE);
  if (!capabilityListsEqual(beforeCapabilities, afterCapabilities)) out.push(IDENTITY_LOG_EVENT_TYPE.CAPABILITY_CLAIM_CHANGE);
  return out;
}

export function buildIdentityLogEventContext({ eventType, beforeIdentity = null, afterIdentity } = {}) {
  assertPlainObject(afterIdentity, "afterIdentity");
  const normalizedEventType = normalizeEventType(eventType);
  const before = beforeIdentity && typeof beforeIdentity === "object" && !Array.isArray(beforeIdentity) ? beforeIdentity : null;
  return {
    eventType: normalizedEventType,
    keyIdBefore: normalizeOptionalString(before?.keys?.keyId ?? null, "beforeIdentity.keys.keyId", { max: 200 }),
    keyIdAfter: normalizeOptionalString(afterIdentity?.keys?.keyId ?? null, "afterIdentity.keys.keyId", { max: 200 }),
    statusBefore: normalizeIdentityStatus(before?.status ?? null, "beforeIdentity.status", { allowNull: true }),
    statusAfter: normalizeIdentityStatus(afterIdentity?.status ?? null, "afterIdentity.status", { allowNull: true }),
    capabilitiesBefore: normalizeCapabilities(before?.capabilities, "beforeIdentity.capabilities"),
    capabilitiesAfter: normalizeCapabilities(afterIdentity?.capabilities, "afterIdentity.capabilities")
  };
}

export function validateIdentityLogEntriesAppendOnly(entries) {
  if (!Array.isArray(entries)) throw new TypeError("entries must be an array");
  if (entries.length === 0) return [];

  const normalized = entries.map((entry, index) => {
    try {
      return validateIdentityLogEntry(entry);
    } catch (err) {
      fail("IDENTITY_LOG_ENTRY_INVALID", `entries[${index}] is invalid: ${err?.message ?? String(err)}`);
    }
    return null;
  });

  const byEntryId = new Map();
  for (const entry of normalized) {
    const existing = byEntryId.get(entry.entryId) ?? null;
    if (!existing) {
      byEntryId.set(entry.entryId, entry.entryHash);
      continue;
    }
    if (existing !== entry.entryHash) {
      fail("IDENTITY_LOG_EQUIVOCATION", "entryId equivocation detected", { entryId: entry.entryId });
    }
    fail("IDENTITY_LOG_DUPLICATE_ENTRY_ID", "duplicate entryId detected", { entryId: entry.entryId });
  }

  const sorted = [...normalized].sort((left, right) => {
    const indexOrder = Number(left.logIndex) - Number(right.logIndex);
    if (indexOrder !== 0) return indexOrder;
    return String(left.entryId).localeCompare(String(right.entryId));
  });

  for (let index = 0; index < sorted.length; index += 1) {
    const entry = sorted[index];
    if (entry.logIndex !== index) {
      if (entry.logIndex < index) {
        fail("IDENTITY_LOG_EQUIVOCATION", "logIndex equivocation detected", { index, logIndex: entry.logIndex });
      }
      fail("IDENTITY_LOG_INDEX_GAP", "identity log index gap detected", { index, logIndex: entry.logIndex });
    }

    const expectedPrev = index === 0 ? null : sorted[index - 1].entryHash;
    if ((entry.prevEntryHash ?? null) !== expectedPrev) {
      fail("IDENTITY_LOG_PREV_HASH_MISMATCH", "identity log prevEntryHash mismatch", {
        entryId: entry.entryId,
        logIndex: entry.logIndex,
        expectedPrevEntryHash: expectedPrev,
        actualPrevEntryHash: entry.prevEntryHash ?? null
      });
    }
  }

  return sorted;
}

export function computeIdentityLogCheckpointHash(checkpoint) {
  assertPlainObject(checkpoint, "checkpoint");
  return sha256Hex(
    canonicalJsonStringify(
      normalizeForCanonicalJson(
        {
          ...checkpoint,
          checkpointHash: null
        },
        { path: "$" }
      )
    )
  );
}

function normalizeIdentityLogCheckpoint(checkpoint, { strictHash = true } = {}) {
  assertPlainObject(checkpoint, "checkpoint");
  const treeSize = normalizeSafeInteger(checkpoint.treeSize, "checkpoint.treeSize", { min: 0 });
  const normalized = normalizeForCanonicalJson(
    {
      schemaVersion: IDENTITY_LOG_CHECKPOINT_SCHEMA_VERSION,
      tenantId: normalizeNonEmptyString(checkpoint.tenantId, "checkpoint.tenantId", { max: 200 }),
      treeSize,
      rootHash: normalizeSha256Hex(checkpoint.rootHash, "checkpoint.rootHash", { allowNull: treeSize === 0 }),
      headEntryId: normalizeOptionalString(checkpoint.headEntryId, "checkpoint.headEntryId", { max: 200 }),
      headEntryHash: normalizeSha256Hex(checkpoint.headEntryHash, "checkpoint.headEntryHash", { allowNull: treeSize === 0 }),
      generatedAt: normalizeIsoDateTime(checkpoint.generatedAt, "checkpoint.generatedAt"),
      checkpointHash: normalizeSha256Hex(checkpoint.checkpointHash, "checkpoint.checkpointHash", { allowNull: !strictHash })
    },
    { path: "$" }
  );

  if (treeSize === 0) {
    if (normalized.rootHash !== null || normalized.headEntryId !== null || normalized.headEntryHash !== null) {
      throw new TypeError("empty checkpoint must have null root/head fields");
    }
  } else {
    if (!normalized.rootHash || !normalized.headEntryId || !normalized.headEntryHash) {
      throw new TypeError("non-empty checkpoint requires root/head fields");
    }
  }

  const expectedCheckpointHash = computeIdentityLogCheckpointHash(normalized);
  if (!strictHash) {
    normalized.checkpointHash = expectedCheckpointHash;
    return normalized;
  }
  if (normalized.checkpointHash !== expectedCheckpointHash) {
    fail("IDENTITY_LOG_CHECKPOINT_HASH_MISMATCH", "checkpoint.checkpointHash mismatch", {
      expectedCheckpointHash,
      actualCheckpointHash: normalized.checkpointHash
    });
  }
  return normalized;
}

export function buildIdentityLogCheckpoint({ tenantId, entries, generatedAt = null } = {}) {
  const normalizedEntries = validateIdentityLogEntriesAppendOnly(entries);
  const treeSize = normalizedEntries.length;
  const rootHash = treeSize > 0 ? computeMerkleRoot({ leafHashes: normalizedEntries.map((entry) => entry.entryHash) }) : null;
  const head = treeSize > 0 ? normalizedEntries[treeSize - 1] : null;
  const resolvedGeneratedAt = generatedAt === null ? head?.recordedAt ?? "1970-01-01T00:00:00.000Z" : generatedAt;
  return normalizeIdentityLogCheckpoint(
    {
      schemaVersion: IDENTITY_LOG_CHECKPOINT_SCHEMA_VERSION,
      tenantId: normalizeNonEmptyString(tenantId, "tenantId", { max: 200 }),
      treeSize,
      rootHash,
      headEntryId: head?.entryId ?? null,
      headEntryHash: head?.entryHash ?? null,
      generatedAt: normalizeIsoDateTime(resolvedGeneratedAt, "generatedAt"),
      checkpointHash: null
    },
    { strictHash: false }
  );
}

export function validateIdentityLogCheckpoint(checkpoint) {
  return normalizeIdentityLogCheckpoint(checkpoint, { strictHash: true });
}

export function assertIdentityLogNoEquivocation({ trustedCheckpoint = null, observedCheckpoint } = {}) {
  const trusted = normalizeTrustedCheckpoint(trustedCheckpoint, "trustedCheckpoint");
  const observed = validateIdentityLogCheckpoint(observedCheckpoint);
  if (!trusted) return observed;

  if (trusted.treeSize === observed.treeSize && trusted.checkpointHash !== observed.checkpointHash) {
    fail("IDENTITY_LOG_EQUIVOCATION", "identity log checkpoint equivocation detected", {
      trustedCheckpointHash: trusted.checkpointHash,
      observedCheckpointHash: observed.checkpointHash,
      treeSize: observed.treeSize
    });
  }

  if (trusted.treeSize > observed.treeSize) {
    fail("IDENTITY_LOG_CHECKPOINT_ROLLBACK", "identity log checkpoint rollback detected", {
      trustedTreeSize: trusted.treeSize,
      observedTreeSize: observed.treeSize,
      trustedCheckpointHash: trusted.checkpointHash,
      observedCheckpointHash: observed.checkpointHash
    });
  }

  return observed;
}

function computeIdentityLogProofHash(proof) {
  return sha256Hex(
    canonicalJsonStringify(
      normalizeForCanonicalJson(
        {
          ...proof,
          proofHash: null
        },
        { path: "$" }
      )
    )
  );
}

function normalizeIdentityLogProof(proof, { strictHash = true } = {}) {
  assertPlainObject(proof, "proof");
  const entry = validateIdentityLogEntry(proof.entry);
  const checkpoint = validateIdentityLogCheckpoint(proof.checkpoint);
  const leafIndex = normalizeSafeInteger(proof.leafIndex, "proof.leafIndex", { min: 0 });
  const treeSize = normalizeSafeInteger(proof.treeSize, "proof.treeSize", { min: 1 });
  const rootHash = normalizeSha256Hex(proof.rootHash, "proof.rootHash");
  const normalized = normalizeForCanonicalJson(
    {
      schemaVersion: IDENTITY_LOG_PROOF_SCHEMA_VERSION,
      tenantId: normalizeNonEmptyString(proof.tenantId, "proof.tenantId", { max: 200 }),
      entryId: normalizeNonEmptyString(proof.entryId, "proof.entryId", { max: 200 }),
      entry,
      treeSize,
      leafIndex,
      leafHash: normalizeSha256Hex(proof.leafHash, "proof.leafHash"),
      siblings: Array.isArray(proof.siblings) ? proof.siblings : [],
      rootHash,
      checkpoint,
      generatedAt: normalizeIsoDateTime(proof.generatedAt, "proof.generatedAt"),
      trustedCheckpoint: normalizeTrustedCheckpoint(proof.trustedCheckpoint, "proof.trustedCheckpoint"),
      proofHash: normalizeSha256Hex(proof.proofHash, "proof.proofHash", { allowNull: !strictHash })
    },
    { path: "$" }
  );

  if (normalized.entryId !== normalized.entry.entryId) {
    fail("IDENTITY_LOG_PROOF_ENTRY_MISMATCH", "proof.entryId must match proof.entry.entryId", {
      proofEntryId: normalized.entryId,
      entryId: normalized.entry.entryId
    });
  }
  if (normalized.tenantId !== normalized.entry.tenantId) {
    fail("IDENTITY_LOG_PROOF_TENANT_MISMATCH", "proof.tenantId must match proof.entry.tenantId", {
      proofTenantId: normalized.tenantId,
      entryTenantId: normalized.entry.tenantId
    });
  }
  if (normalized.leafIndex !== normalized.entry.logIndex) {
    fail("IDENTITY_LOG_PROOF_INDEX_MISMATCH", "proof.leafIndex must match proof.entry.logIndex", {
      proofLeafIndex: normalized.leafIndex,
      entryLogIndex: normalized.entry.logIndex
    });
  }
  if (normalized.leafHash !== normalized.entry.entryHash) {
    fail("IDENTITY_LOG_PROOF_LEAF_MISMATCH", "proof.leafHash must match proof.entry.entryHash", {
      proofLeafHash: normalized.leafHash,
      entryHash: normalized.entry.entryHash
    });
  }
  if (normalized.treeSize !== normalized.checkpoint.treeSize) {
    fail("IDENTITY_LOG_PROOF_TREE_SIZE_MISMATCH", "proof.treeSize must match proof.checkpoint.treeSize", {
      proofTreeSize: normalized.treeSize,
      checkpointTreeSize: normalized.checkpoint.treeSize
    });
  }
  if (normalized.rootHash !== normalized.checkpoint.rootHash) {
    fail("IDENTITY_LOG_PROOF_ROOT_MISMATCH", "proof.rootHash must match proof.checkpoint.rootHash", {
      proofRootHash: normalized.rootHash,
      checkpointRootHash: normalized.checkpoint.rootHash
    });
  }

  let merkleOk = false;
  try {
    merkleOk = verifyMerkleProof({
      leafHash: normalized.leafHash,
      leafIndex: normalized.leafIndex,
      treeSize: normalized.treeSize,
      siblings: normalized.siblings,
      rootHash: normalized.rootHash
    });
  } catch (err) {
    fail("IDENTITY_LOG_PROOF_MERKLE_INVALID", `invalid merkle proof: ${err?.message ?? String(err)}`);
  }
  if (!merkleOk) fail("IDENTITY_LOG_PROOF_MERKLE_INVALID", "invalid merkle proof");

  assertIdentityLogNoEquivocation({
    trustedCheckpoint: normalized.trustedCheckpoint,
    observedCheckpoint: normalized.checkpoint
  });

  const expectedProofHash = computeIdentityLogProofHash(normalized);
  if (!strictHash) {
    normalized.proofHash = expectedProofHash;
    return normalized;
  }
  if (normalized.proofHash !== expectedProofHash) {
    fail("IDENTITY_LOG_PROOF_HASH_MISMATCH", "proof.proofHash mismatch", {
      expectedProofHash,
      actualProofHash: normalized.proofHash
    });
  }
  return normalized;
}

export function buildIdentityLogProof({ entries, entryId, checkpoint = null, generatedAt = null, trustedCheckpoint = null } = {}) {
  const normalizedEntries = validateIdentityLogEntriesAppendOnly(entries);
  const normalizedEntryId = normalizeNonEmptyString(entryId, "entryId", { max: 200 });
  const entry = normalizedEntries.find((row) => row.entryId === normalizedEntryId) ?? null;
  if (!entry) fail("IDENTITY_LOG_ENTRY_NOT_FOUND", "entryId not found in identity log", { entryId: normalizedEntryId });

  const proofVector = buildMerkleProof({
    leafHashes: normalizedEntries.map((row) => row.entryHash),
    index: entry.logIndex
  });

  const resolvedCheckpoint = checkpoint
    ? validateIdentityLogCheckpoint(checkpoint)
    : buildIdentityLogCheckpoint({ tenantId: entry.tenantId, entries: normalizedEntries, generatedAt });

  if (resolvedCheckpoint.treeSize !== normalizedEntries.length) {
    fail("IDENTITY_LOG_CHECKPOINT_TREE_SIZE_MISMATCH", "checkpoint treeSize does not match entry count", {
      checkpointTreeSize: resolvedCheckpoint.treeSize,
      entryCount: normalizedEntries.length
    });
  }
  if (resolvedCheckpoint.rootHash !== proofVector.rootHash) {
    fail("IDENTITY_LOG_CHECKPOINT_ROOT_MISMATCH", "checkpoint rootHash does not match computed merkle root", {
      checkpointRootHash: resolvedCheckpoint.rootHash,
      computedRootHash: proofVector.rootHash
    });
  }

  assertIdentityLogNoEquivocation({ trustedCheckpoint, observedCheckpoint: resolvedCheckpoint });

  const resolvedGeneratedAt = generatedAt === null ? resolvedCheckpoint.generatedAt : generatedAt;
  return normalizeIdentityLogProof(
    {
      schemaVersion: IDENTITY_LOG_PROOF_SCHEMA_VERSION,
      tenantId: entry.tenantId,
      entryId: entry.entryId,
      entry,
      treeSize: proofVector.treeSize,
      leafIndex: proofVector.leafIndex,
      leafHash: entry.entryHash,
      siblings: proofVector.siblings,
      rootHash: proofVector.rootHash,
      checkpoint: resolvedCheckpoint,
      generatedAt: normalizeIsoDateTime(resolvedGeneratedAt, "generatedAt"),
      trustedCheckpoint: normalizeTrustedCheckpoint(trustedCheckpoint, "trustedCheckpoint"),
      proofHash: null
    },
    { strictHash: false }
  );
}

export function validateIdentityLogProof(proof) {
  return normalizeIdentityLogProof(proof, { strictHash: true });
}

export function verifyIdentityLogProof({ proof, entryId = null, trustedCheckpoint = null } = {}) {
  try {
    const normalizedProof = validateIdentityLogProof(proof);
    if (entryId !== null && entryId !== undefined) {
      const normalizedEntryId = normalizeNonEmptyString(entryId, "entryId", { max: 200 });
      if (normalizedProof.entryId !== normalizedEntryId) {
        fail("IDENTITY_LOG_ENTRY_MISMATCH", "proof entryId does not match requested entryId", {
          requestedEntryId: normalizedEntryId,
          proofEntryId: normalizedProof.entryId
        });
      }
    }
    if (trustedCheckpoint !== null && trustedCheckpoint !== undefined) {
      assertIdentityLogNoEquivocation({
        trustedCheckpoint,
        observedCheckpoint: normalizedProof.checkpoint
      });
    }

    return {
      ok: true,
      entry: normalizedProof.entry,
      checkpoint: normalizedProof.checkpoint,
      proofHash: normalizedProof.proofHash,
      treeSize: normalizedProof.treeSize,
      rootHash: normalizedProof.rootHash
    };
  } catch (err) {
    return {
      ok: false,
      code: typeof err?.code === "string" && err.code.trim() !== "" ? err.code : "IDENTITY_LOG_PROOF_INVALID",
      message: err?.message ?? "identity log proof verification failed",
      details: err?.details ?? null
    };
  }
}

export function parseIdentityLogEntryFromAuditDetails(details, { allowNull = false } = {}) {
  if (details === null || details === undefined) {
    if (allowNull) return null;
    throw new TypeError("details is required");
  }
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    if (allowNull) return null;
    throw new TypeError("details must be an object");
  }
  const entry = details.entry ?? null;
  if (entry === null || entry === undefined) {
    if (allowNull) return null;
    throw new TypeError("details.entry is required");
  }
  return validateIdentityLogEntry(entry);
}
