import { canonicalJsonStringify, normalizeForCanonicalJson } from "./canonical-json.js";
import { sha256Hex } from "./crypto.js";
import { ARTIFACT_REF_SCHEMA_VERSION, normalizeArtifactRefV1 } from "./artifact-ref.js";

export const STATE_CHECKPOINT_SCHEMA_VERSION = "StateCheckpoint.v1";
export const STATE_CHECKPOINT_LINEAGE_COMPACTION_SCHEMA_VERSION = "StateCheckpointLineageCompaction.v1";
export const STATE_CHECKPOINT_LINEAGE_RESTORE_SCHEMA_VERSION = "StateCheckpointLineageRestore.v1";
export const STATE_CHECKPOINT_LINEAGE_ERROR_CODE = Object.freeze({
  EMPTY: "STATE_CHECKPOINT_LINEAGE_EMPTY",
  DUPLICATE_ID: "STATE_CHECKPOINT_LINEAGE_DUPLICATE_CHECKPOINT_ID",
  MULTIPLE_ROOTS: "STATE_CHECKPOINT_LINEAGE_MULTIPLE_ROOTS",
  UNKNOWN_PARENT: "STATE_CHECKPOINT_LINEAGE_UNKNOWN_PARENT",
  BRANCH: "STATE_CHECKPOINT_LINEAGE_BRANCH_UNSUPPORTED",
  CYCLE: "STATE_CHECKPOINT_LINEAGE_CYCLE",
  DISCONNECTED: "STATE_CHECKPOINT_LINEAGE_DISCONNECTED",
  HASH_MISMATCH: "STATE_CHECKPOINT_LINEAGE_HASH_MISMATCH",
  RETAINED_HASH_MISMATCH: "STATE_CHECKPOINT_RETAINED_HASH_MISMATCH",
  INDEX_MISMATCH: "STATE_CHECKPOINT_LINEAGE_INDEX_MISMATCH"
});

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
}

function assertNonEmptyString(value, name, { max = 256 } = {}) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
  const normalized = value.trim();
  if (normalized.length > max) throw new TypeError(`${name} must be <= ${max} characters`);
  return normalized;
}

function normalizeOptionalString(value, name, { max = 500 } = {}) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  if (normalized.length > max) throw new TypeError(`${name} must be <= ${max} characters`);
  return normalized;
}

function normalizeOptionalGrantRef(value, name) {
  const normalized = normalizeOptionalString(value, name, { max: 200 });
  if (normalized === null) return null;
  if (!/^[A-Za-z0-9:_-]+$/.test(normalized)) {
    throw new TypeError(`${name} must match ^[A-Za-z0-9:_-]+$`);
  }
  return normalized;
}

function normalizeIsoDateTime(value, name) {
  const normalized = assertNonEmptyString(value, name, { max: 128 });
  if (!Number.isFinite(Date.parse(normalized))) throw new TypeError(`${name} must be an ISO date-time`);
  return normalized;
}

function normalizeRevision(value, name = "revision") {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new TypeError(`${name} must be a non-negative safe integer`);
  return n;
}

function normalizePositiveInteger(value, name, { min = 1, max = 1_000_000 } = {}) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    throw new TypeError(`${name} must be an integer in range ${min}..${max}`);
  }
  return n;
}

function normalizeDiffRefs(value) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError("diffRefs must be an array");
  const dedupe = new Map();
  for (let index = 0; index < value.length; index += 1) {
    const ref = normalizeArtifactRefV1(value[index], {
      name: `diffRefs[${index}]`,
      requireHash: true
    });
    dedupe.set(`${ref.artifactId}\n${ref.artifactHash}`, ref);
  }
  const out = Array.from(dedupe.values());
  out.sort((left, right) => {
    const artifactOrder = String(left.artifactId ?? "").localeCompare(String(right.artifactId ?? ""));
    if (artifactOrder !== 0) return artifactOrder;
    return String(left.artifactHash ?? "").localeCompare(String(right.artifactHash ?? ""));
  });
  return out;
}

function computeStateCheckpointHash(checkpoint) {
  const canonical = canonicalJsonStringify({
    ...checkpoint,
    checkpointHash: null
  });
  return sha256Hex(canonical);
}

function throwLineageError(code, message, details = null) {
  const err = new TypeError(message);
  err.code = code;
  if (details !== null && details !== undefined) err.details = details;
  throw err;
}

function normalizeLineageInput(checkpoints) {
  if (!Array.isArray(checkpoints) || checkpoints.length === 0) {
    throwLineageError(STATE_CHECKPOINT_LINEAGE_ERROR_CODE.EMPTY, "checkpoints must be a non-empty array");
  }
  const byId = new Map();
  for (let index = 0; index < checkpoints.length; index += 1) {
    const checkpoint = checkpoints[index];
    try {
      validateStateCheckpointV1(checkpoint);
    } catch (err) {
      throwLineageError(
        STATE_CHECKPOINT_LINEAGE_ERROR_CODE.EMPTY,
        `checkpoints[${index}] is invalid: ${err?.message ?? String(err)}`
      );
    }
    const checkpointId = assertNonEmptyString(checkpoint.checkpointId, `checkpoints[${index}].checkpointId`, { max: 200 });
    if (byId.has(checkpointId)) {
      throwLineageError(
        STATE_CHECKPOINT_LINEAGE_ERROR_CODE.DUPLICATE_ID,
        "checkpoint lineage contains duplicate checkpointId",
        { checkpointId }
      );
    }
    byId.set(checkpointId, normalizeForCanonicalJson(checkpoint, { path: `$.checkpoints[${index}]` }));
  }

  const childrenByParent = new Map();
  const roots = [];
  for (const checkpoint of byId.values()) {
    const parentCheckpointId = normalizeOptionalString(checkpoint.parentCheckpointId, "parentCheckpointId", { max: 200 });
    if (parentCheckpointId === null) {
      roots.push(checkpoint);
      continue;
    }
    if (!byId.has(parentCheckpointId)) {
      throwLineageError(
        STATE_CHECKPOINT_LINEAGE_ERROR_CODE.UNKNOWN_PARENT,
        "checkpoint lineage parentCheckpointId does not exist",
        {
          checkpointId: checkpoint.checkpointId,
          parentCheckpointId
        }
      );
    }
    const existingChildren = childrenByParent.get(parentCheckpointId) ?? [];
    existingChildren.push(checkpoint.checkpointId);
    childrenByParent.set(parentCheckpointId, existingChildren);
  }
  if (roots.length !== 1) {
    throwLineageError(
      STATE_CHECKPOINT_LINEAGE_ERROR_CODE.MULTIPLE_ROOTS,
      "checkpoint lineage must resolve to exactly one root checkpoint",
      { rootCount: roots.length }
    );
  }
  for (const [parentCheckpointId, children] of childrenByParent.entries()) {
    if (children.length > 1) {
      throwLineageError(
        STATE_CHECKPOINT_LINEAGE_ERROR_CODE.BRANCH,
        "checkpoint lineage branching is unsupported",
        { parentCheckpointId, children }
      );
    }
  }

  const ordered = [];
  const visited = new Set();
  let cursorId = roots[0].checkpointId;
  while (cursorId) {
    if (visited.has(cursorId)) {
      throwLineageError(STATE_CHECKPOINT_LINEAGE_ERROR_CODE.CYCLE, "checkpoint lineage contains a cycle", { checkpointId: cursorId });
    }
    visited.add(cursorId);
    const checkpoint = byId.get(cursorId);
    if (!checkpoint) break;
    ordered.push(checkpoint);
    const children = childrenByParent.get(cursorId) ?? [];
    cursorId = children.length === 1 ? children[0] : null;
  }

  if (ordered.length !== byId.size) {
    throwLineageError(
      STATE_CHECKPOINT_LINEAGE_ERROR_CODE.DISCONNECTED,
      "checkpoint lineage is disconnected",
      {
        visitedCount: ordered.length,
        checkpointCount: byId.size
      }
    );
  }
  const entries = ordered.map((checkpoint, index) =>
    normalizeForCanonicalJson(
      {
        index,
        checkpointId: checkpoint.checkpointId,
        parentCheckpointId: normalizeOptionalString(checkpoint.parentCheckpointId, "parentCheckpointId", { max: 200 }),
        checkpointHash: checkpoint.checkpointHash,
        createdAt: checkpoint.createdAt,
        updatedAt: checkpoint.updatedAt,
        revision: normalizeRevision(checkpoint.revision, "revision")
      },
      { path: `$.entries[${index}]` }
    )
  );
  const first = entries[0] ?? null;
  const last = entries[entries.length - 1] ?? null;
  return {
    checkpoints: ordered,
    entries,
    rootCheckpointId: first?.checkpointId ?? null,
    headCheckpointId: last?.checkpointId ?? null
  };
}

function computeLineageHash({ tenantId, ownerAgentId, sessionId, entries }) {
  return sha256Hex(
    canonicalJsonStringify(
      normalizeForCanonicalJson(
        {
          schemaVersion: "StateCheckpointLineage.v1",
          tenantId,
          ownerAgentId,
          sessionId,
          checkpointCount: Array.isArray(entries) ? entries.length : 0,
          entries: Array.isArray(entries)
            ? entries.map((row) =>
                normalizeForCanonicalJson(
                  {
                    index: row.index,
                    checkpointId: row.checkpointId,
                    parentCheckpointId: row.parentCheckpointId ?? null,
                    checkpointHash: row.checkpointHash,
                    createdAt: row.createdAt,
                    updatedAt: row.updatedAt,
                    revision: row.revision
                  },
                  { path: "$.lineageEntry" }
                )
              )
            : []
        },
        { path: "$.lineage" }
      )
    )
  );
}

function computeLineageCompactionHash(compaction) {
  return sha256Hex(
    canonicalJsonStringify(
      normalizeForCanonicalJson(
        {
          ...compaction,
          compactionHash: null
        },
        { path: "$" }
      )
    )
  );
}

function selectRetainedIndexes({ entries, retainEvery, retainTail }) {
  const retainedIndexes = new Set();
  const length = entries.length;
  if (length <= 0) return retainedIndexes;
  retainedIndexes.add(0);
  retainedIndexes.add(length - 1);
  for (let index = 0; index < length; index += retainEvery) retainedIndexes.add(index);
  const tailStart = Math.max(0, length - retainTail);
  for (let index = tailStart; index < length; index += 1) retainedIndexes.add(index);
  for (let index = 0; index < length; index += 1) {
    const row = entries[index];
    if (row && typeof row === "object" && row.metadata && row.metadata.pinned === true) {
      retainedIndexes.add(index);
    }
  }
  return retainedIndexes;
}

export function buildStateCheckpointV1({
  checkpointId,
  tenantId,
  ownerAgentId,
  projectId = null,
  sessionId = null,
  traceId = null,
  parentCheckpointId = null,
  stateRef,
  diffRefs = [],
  delegationGrantRef = null,
  authorityGrantRef = null,
  redactionPolicyRef = null,
  metadata = null,
  createdAt = new Date().toISOString(),
  updatedAt = createdAt
} = {}) {
  const normalizedCreatedAt = normalizeIsoDateTime(createdAt, "createdAt");
  const normalizedUpdatedAt = normalizeIsoDateTime(updatedAt, "updatedAt");
  const normalizedDelegationGrantRef = normalizeOptionalGrantRef(delegationGrantRef, "delegationGrantRef");
  const normalizedAuthorityGrantRef = normalizeOptionalGrantRef(authorityGrantRef, "authorityGrantRef");
  const checkpointBase = normalizeForCanonicalJson(
    {
      schemaVersion: STATE_CHECKPOINT_SCHEMA_VERSION,
      checkpointId: assertNonEmptyString(checkpointId, "checkpointId", { max: 200 }),
      tenantId: assertNonEmptyString(tenantId, "tenantId", { max: 128 }),
      ownerAgentId: assertNonEmptyString(ownerAgentId, "ownerAgentId", { max: 200 }),
      projectId: normalizeOptionalString(projectId, "projectId", { max: 200 }),
      sessionId: normalizeOptionalString(sessionId, "sessionId", { max: 200 }),
      traceId: normalizeOptionalString(traceId, "traceId", { max: 256 }),
      parentCheckpointId: normalizeOptionalString(parentCheckpointId, "parentCheckpointId", { max: 200 }),
      stateRef: normalizeArtifactRefV1(stateRef, { name: "stateRef", requireHash: true }),
      diffRefs: normalizeDiffRefs(diffRefs),
      ...(normalizedDelegationGrantRef !== null ? { delegationGrantRef: normalizedDelegationGrantRef } : {}),
      ...(normalizedAuthorityGrantRef !== null ? { authorityGrantRef: normalizedAuthorityGrantRef } : {}),
      redactionPolicyRef: normalizeOptionalString(redactionPolicyRef, "redactionPolicyRef", { max: 200 }),
      metadata: metadata && typeof metadata === "object" && !Array.isArray(metadata) ? normalizeForCanonicalJson(metadata, { path: "$.metadata" }) : null,
      createdAt: normalizedCreatedAt,
      updatedAt: normalizedUpdatedAt,
      revision: 0,
      checkpointHash: null
    },
    { path: "$" }
  );
  const checkpointHash = computeStateCheckpointHash(checkpointBase);
  const checkpoint = normalizeForCanonicalJson({ ...checkpointBase, checkpointHash }, { path: "$" });
  validateStateCheckpointV1(checkpoint);
  return checkpoint;
}

export function validateStateCheckpointV1(value) {
  assertPlainObject(value, "stateCheckpoint");
  if (String(value.schemaVersion ?? "").trim() !== STATE_CHECKPOINT_SCHEMA_VERSION) {
    throw new TypeError(`stateCheckpoint.schemaVersion must be ${STATE_CHECKPOINT_SCHEMA_VERSION}`);
  }
  assertNonEmptyString(value.checkpointId, "stateCheckpoint.checkpointId", { max: 200 });
  assertNonEmptyString(value.tenantId, "stateCheckpoint.tenantId", { max: 128 });
  assertNonEmptyString(value.ownerAgentId, "stateCheckpoint.ownerAgentId", { max: 200 });
  normalizeOptionalString(value.projectId, "stateCheckpoint.projectId", { max: 200 });
  normalizeOptionalString(value.sessionId, "stateCheckpoint.sessionId", { max: 200 });
  normalizeOptionalString(value.traceId, "stateCheckpoint.traceId", { max: 256 });
  normalizeOptionalString(value.parentCheckpointId, "stateCheckpoint.parentCheckpointId", { max: 200 });
  normalizeOptionalGrantRef(value.delegationGrantRef, "stateCheckpoint.delegationGrantRef");
  normalizeOptionalGrantRef(value.authorityGrantRef, "stateCheckpoint.authorityGrantRef");
  normalizeOptionalString(value.redactionPolicyRef, "stateCheckpoint.redactionPolicyRef", { max: 200 });
  normalizeArtifactRefV1(value.stateRef, { name: "stateCheckpoint.stateRef", requireHash: true });
  if (Array.isArray(value.diffRefs)) {
    for (let index = 0; index < value.diffRefs.length; index += 1) {
      normalizeArtifactRefV1(value.diffRefs[index], {
        name: `stateCheckpoint.diffRefs[${index}]`,
        requireHash: true
      });
    }
  } else if (value.diffRefs !== undefined && value.diffRefs !== null) {
    throw new TypeError("stateCheckpoint.diffRefs must be an array");
  }
  normalizeIsoDateTime(value.createdAt, "stateCheckpoint.createdAt");
  normalizeIsoDateTime(value.updatedAt, "stateCheckpoint.updatedAt");
  normalizeRevision(value.revision, "stateCheckpoint.revision");
  assertNonEmptyString(value.checkpointHash, "stateCheckpoint.checkpointHash", { max: 64 });
  if (!/^[0-9a-f]{64}$/.test(String(value.checkpointHash))) {
    throw new TypeError("stateCheckpoint.checkpointHash must be a sha256 hex string");
  }

  const normalizedDelegationGrantRef = normalizeOptionalGrantRef(value.delegationGrantRef, "stateCheckpoint.delegationGrantRef");
  const normalizedAuthorityGrantRef = normalizeOptionalGrantRef(value.authorityGrantRef, "stateCheckpoint.authorityGrantRef");
  const normalized = normalizeForCanonicalJson(
    {
      schemaVersion: STATE_CHECKPOINT_SCHEMA_VERSION,
      checkpointId: String(value.checkpointId).trim(),
      tenantId: String(value.tenantId).trim(),
      ownerAgentId: String(value.ownerAgentId).trim(),
      projectId: normalizeOptionalString(value.projectId, "stateCheckpoint.projectId", { max: 200 }),
      sessionId: normalizeOptionalString(value.sessionId, "stateCheckpoint.sessionId", { max: 200 }),
      traceId: normalizeOptionalString(value.traceId, "stateCheckpoint.traceId", { max: 256 }),
      parentCheckpointId: normalizeOptionalString(value.parentCheckpointId, "stateCheckpoint.parentCheckpointId", { max: 200 }),
      stateRef: normalizeArtifactRefV1(value.stateRef, { name: "stateCheckpoint.stateRef", requireHash: true }),
      diffRefs: normalizeDiffRefs(value.diffRefs ?? []),
      ...(normalizedDelegationGrantRef !== null ? { delegationGrantRef: normalizedDelegationGrantRef } : {}),
      ...(normalizedAuthorityGrantRef !== null ? { authorityGrantRef: normalizedAuthorityGrantRef } : {}),
      redactionPolicyRef: normalizeOptionalString(value.redactionPolicyRef, "stateCheckpoint.redactionPolicyRef", { max: 200 }),
      metadata: value.metadata && typeof value.metadata === "object" && !Array.isArray(value.metadata) ? normalizeForCanonicalJson(value.metadata, { path: "$.metadata" }) : null,
      createdAt: normalizeIsoDateTime(value.createdAt, "stateCheckpoint.createdAt"),
      updatedAt: normalizeIsoDateTime(value.updatedAt, "stateCheckpoint.updatedAt"),
      revision: normalizeRevision(value.revision, "stateCheckpoint.revision"),
      checkpointHash: null
    },
    { path: "$" }
  );
  const expectedHash = computeStateCheckpointHash(normalized);
  if (String(value.checkpointHash).toLowerCase() !== expectedHash) {
    throw new TypeError("stateCheckpoint.checkpointHash mismatch");
  }
}

export function buildArtifactRefFromStoredArtifact(artifact, { tenantId = null } = {}) {
  assertPlainObject(artifact, "artifact");
  const artifactId = assertNonEmptyString(artifact.artifactId ?? artifact.id, "artifact.artifactId", { max: 256 });
  const artifactHash = assertNonEmptyString(artifact.artifactHash, "artifact.artifactHash", { max: 64 }).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(artifactHash)) throw new TypeError("artifact.artifactHash must be a sha256 hex string");
  const artifactType = normalizeOptionalString(artifact.artifactType ?? artifact.schemaVersion ?? null, "artifact.artifactType", { max: 128 });
  return normalizeForCanonicalJson(
    {
      schemaVersion: ARTIFACT_REF_SCHEMA_VERSION,
      artifactId,
      artifactHash,
      artifactType,
      tenantId: normalizeOptionalString(tenantId, "tenantId", { max: 128 }),
      metadata: null
    },
    { path: "$.artifactRef" }
  );
}

export function compactStateCheckpointLineageV1({
  checkpoints,
  compactionId = null,
  retainEvery = 10,
  retainTail = 5,
  compactedAt = new Date().toISOString(),
  metadata = null
} = {}) {
  const normalizedRetainEvery = normalizePositiveInteger(retainEvery, "retainEvery", { min: 1, max: 10_000 });
  const normalizedRetainTail = normalizePositiveInteger(retainTail, "retainTail", { min: 1, max: 10_000 });
  const normalizedCompactedAt = normalizeIsoDateTime(compactedAt, "compactedAt");
  const normalizedLineage = normalizeLineageInput(checkpoints);
  const firstCheckpoint = normalizedLineage.checkpoints[0];
  const lineageHash = computeLineageHash({
    tenantId: firstCheckpoint.tenantId,
    ownerAgentId: firstCheckpoint.ownerAgentId,
    sessionId: normalizeOptionalString(firstCheckpoint.sessionId, "sessionId", { max: 200 }),
    entries: normalizedLineage.entries
  });

  const retainedIndexes = selectRetainedIndexes({
    entries: normalizedLineage.checkpoints,
    retainEvery: normalizedRetainEvery,
    retainTail: normalizedRetainTail
  });
  const entries = normalizedLineage.entries.map((entry) =>
    normalizeForCanonicalJson(
      {
        ...entry,
        retained: retainedIndexes.has(entry.index)
      },
      { path: "$.compaction.entries[]" }
    )
  );
  const retainedCheckpoints = normalizedLineage.checkpoints.filter((_, index) => retainedIndexes.has(index));
  const droppedCheckpointIds = entries.filter((entry) => entry.retained !== true).map((entry) => entry.checkpointId);
  const normalizedCompactionId =
    normalizeOptionalString(compactionId, "compactionId", { max: 200 }) ?? `cmp_${lineageHash.slice(0, 24)}`;

  const compaction = normalizeForCanonicalJson(
    {
      schemaVersion: STATE_CHECKPOINT_LINEAGE_COMPACTION_SCHEMA_VERSION,
      compactionId: normalizedCompactionId,
      compactedAt: normalizedCompactedAt,
      strategy: {
        retainEvery: normalizedRetainEvery,
        retainTail: normalizedRetainTail
      },
      lineage: {
        rootCheckpointId: normalizedLineage.rootCheckpointId,
        headCheckpointId: normalizedLineage.headCheckpointId,
        checkpointCount: entries.length,
        lineageHash
      },
      entries,
      retainedCheckpoints,
      droppedCheckpointIds,
      metadata: metadata && typeof metadata === "object" && !Array.isArray(metadata) ? normalizeForCanonicalJson(metadata, { path: "$.metadata" }) : null,
      compactionHash: null
    },
    { path: "$" }
  );
  const compactionHash = computeLineageCompactionHash(compaction);
  return normalizeForCanonicalJson(
    {
      ...compaction,
      compactionHash
    },
    { path: "$" }
  );
}

export function validateStateCheckpointLineageCompactionV1(value) {
  assertPlainObject(value, "stateCheckpointLineageCompaction");
  if (String(value.schemaVersion ?? "").trim() !== STATE_CHECKPOINT_LINEAGE_COMPACTION_SCHEMA_VERSION) {
    throwLineageError(
      STATE_CHECKPOINT_LINEAGE_ERROR_CODE.HASH_MISMATCH,
      `stateCheckpointLineageCompaction.schemaVersion must be ${STATE_CHECKPOINT_LINEAGE_COMPACTION_SCHEMA_VERSION}`
    );
  }
  const entries = Array.isArray(value.entries) ? value.entries : null;
  if (!entries || entries.length === 0) {
    throwLineageError(STATE_CHECKPOINT_LINEAGE_ERROR_CODE.EMPTY, "stateCheckpointLineageCompaction.entries must be a non-empty array");
  }
  const lineage = value.lineage;
  if (!lineage || typeof lineage !== "object" || Array.isArray(lineage)) {
    throwLineageError(STATE_CHECKPOINT_LINEAGE_ERROR_CODE.EMPTY, "stateCheckpointLineageCompaction.lineage must be an object");
  }

  const expectedCompactionHash = computeLineageCompactionHash(value);
  if (String(value.compactionHash ?? "").toLowerCase() !== expectedCompactionHash) {
    throwLineageError(
      STATE_CHECKPOINT_LINEAGE_ERROR_CODE.HASH_MISMATCH,
      "stateCheckpointLineageCompaction.compactionHash mismatch"
    );
  }

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    assertPlainObject(entry, `entries[${index}]`);
    const normalizedIndex = normalizeRevision(entry.index, `entries[${index}].index`);
    if (normalizedIndex !== index) {
      throwLineageError(
        STATE_CHECKPOINT_LINEAGE_ERROR_CODE.INDEX_MISMATCH,
        "stateCheckpointLineageCompaction entry index mismatch",
        { index, normalizedIndex }
      );
    }
    const checkpointId = assertNonEmptyString(entry.checkpointId, `entries[${index}].checkpointId`, { max: 200 });
    const parentCheckpointId = normalizeOptionalString(entry.parentCheckpointId, `entries[${index}].parentCheckpointId`, { max: 200 });
    assertNonEmptyString(entry.checkpointHash, `entries[${index}].checkpointHash`, { max: 64 });
    if (!/^[0-9a-f]{64}$/.test(String(entry.checkpointHash ?? "").toLowerCase())) {
      throwLineageError(
        STATE_CHECKPOINT_LINEAGE_ERROR_CODE.HASH_MISMATCH,
        `entries[${index}].checkpointHash must be sha256 hex`
      );
    }
    normalizeIsoDateTime(entry.createdAt, `entries[${index}].createdAt`);
    normalizeIsoDateTime(entry.updatedAt, `entries[${index}].updatedAt`);
    normalizeRevision(entry.revision, `entries[${index}].revision`);
    if (index === 0 && parentCheckpointId !== null) {
      throwLineageError(
        STATE_CHECKPOINT_LINEAGE_ERROR_CODE.DISCONNECTED,
        "root checkpoint entry parentCheckpointId must be null",
        { checkpointId, parentCheckpointId }
      );
    }
    if (index > 0 && parentCheckpointId !== entries[index - 1].checkpointId) {
      throwLineageError(
        STATE_CHECKPOINT_LINEAGE_ERROR_CODE.DISCONNECTED,
        "checkpoint compaction entries must form a linear parent chain",
        {
          checkpointId,
          parentCheckpointId,
          expectedParentCheckpointId: entries[index - 1].checkpointId
        }
      );
    }
  }
  const rootCheckpointId = normalizeOptionalString(lineage.rootCheckpointId, "lineage.rootCheckpointId", { max: 200 });
  const headCheckpointId = normalizeOptionalString(lineage.headCheckpointId, "lineage.headCheckpointId", { max: 200 });
  if (rootCheckpointId !== entries[0].checkpointId || headCheckpointId !== entries[entries.length - 1].checkpointId) {
    throwLineageError(
      STATE_CHECKPOINT_LINEAGE_ERROR_CODE.DISCONNECTED,
      "lineage root/head checkpoint ids must match entry boundaries"
    );
  }
  const lineageHash = assertNonEmptyString(lineage.lineageHash, "lineage.lineageHash", { max: 64 }).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(lineageHash)) {
    throwLineageError(STATE_CHECKPOINT_LINEAGE_ERROR_CODE.HASH_MISMATCH, "lineage.lineageHash must be sha256 hex");
  }

  const retainedById = new Map();
  const retainedCheckpoints = Array.isArray(value.retainedCheckpoints) ? value.retainedCheckpoints : [];
  for (let index = 0; index < retainedCheckpoints.length; index += 1) {
    const checkpoint = retainedCheckpoints[index];
    validateStateCheckpointV1(checkpoint);
    retainedById.set(checkpoint.checkpointId, checkpoint);
  }
  for (const entry of entries) {
    const retainedCheckpoint = retainedById.get(entry.checkpointId);
    if (!retainedCheckpoint) continue;
    if (String(retainedCheckpoint.checkpointHash ?? "").toLowerCase() !== String(entry.checkpointHash).toLowerCase()) {
      throwLineageError(
        STATE_CHECKPOINT_LINEAGE_ERROR_CODE.RETAINED_HASH_MISMATCH,
        "retained checkpoint hash does not match lineage entry hash",
        { checkpointId: entry.checkpointId }
      );
    }
  }

  const recomputedLineageHash = computeLineageHash({
    tenantId: retainedCheckpoints[0]?.tenantId ?? null,
    ownerAgentId: retainedCheckpoints[0]?.ownerAgentId ?? null,
    sessionId: normalizeOptionalString(retainedCheckpoints[0]?.sessionId ?? null, "sessionId", { max: 200 }),
    entries
  });
  if (recomputedLineageHash !== lineageHash) {
    throwLineageError(STATE_CHECKPOINT_LINEAGE_ERROR_CODE.HASH_MISMATCH, "lineage.lineageHash mismatch");
  }
}

function computeLineageRestoreHash(payload) {
  return sha256Hex(
    canonicalJsonStringify(
      normalizeForCanonicalJson(
        {
          ...payload,
          restoreHash: null
        },
        { path: "$" }
      )
    )
  );
}

export function restoreStateCheckpointLineageV1({ compaction, restoredAt = null } = {}) {
  validateStateCheckpointLineageCompactionV1(compaction);
  const normalizedRestoredAt = normalizeIsoDateTime(restoredAt ?? compaction.compactedAt, "restoredAt");
  const retainedById = new Map();
  const retainedCheckpoints = Array.isArray(compaction.retainedCheckpoints) ? compaction.retainedCheckpoints : [];
  for (const checkpoint of retainedCheckpoints) {
    retainedById.set(String(checkpoint.checkpointId), normalizeForCanonicalJson(checkpoint, { path: "$.retainedCheckpoint" }));
  }
  const restoredEntries = compaction.entries.map((entry) => {
    const checkpoint = retainedById.get(entry.checkpointId);
    if (checkpoint) {
      return normalizeForCanonicalJson(
        {
          checkpointId: entry.checkpointId,
          retained: true,
          checkpoint
        },
        { path: "$.restoredEntries[]" }
      );
    }
    return normalizeForCanonicalJson(
      {
        checkpointId: entry.checkpointId,
        retained: false,
        checkpoint: {
          schemaVersion: "StateCheckpointLineageStub.v1",
          checkpointId: entry.checkpointId,
          parentCheckpointId: entry.parentCheckpointId,
          checkpointHash: entry.checkpointHash,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
          revision: entry.revision
        }
      },
      { path: "$.restoredEntries[]" }
    );
  });

  const restore = normalizeForCanonicalJson(
    {
      schemaVersion: STATE_CHECKPOINT_LINEAGE_RESTORE_SCHEMA_VERSION,
      restoredAt: normalizedRestoredAt,
      compactionId: compaction.compactionId,
      lineage: compaction.lineage,
      restoredEntries,
      missingCheckpointIds: compaction.droppedCheckpointIds ?? [],
      fullyHydrated: (compaction.droppedCheckpointIds ?? []).length === 0,
      restoreHash: null
    },
    { path: "$" }
  );
  const restoreHash = computeLineageRestoreHash(restore);
  return normalizeForCanonicalJson(
    {
      ...restore,
      restoreHash
    },
    { path: "$" }
  );
}
