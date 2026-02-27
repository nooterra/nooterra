import { canonicalJsonStringify, normalizeForCanonicalJson } from "./canonical-json.js";
import { sha256Hex } from "./crypto.js";
import { ARTIFACT_REF_SCHEMA_VERSION, normalizeArtifactRefV1 } from "./artifact-ref.js";

export const STATE_CHECKPOINT_SCHEMA_VERSION = "StateCheckpoint.v1";

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
