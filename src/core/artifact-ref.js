import { normalizeForCanonicalJson } from "./canonical-json.js";

export const ARTIFACT_REF_SCHEMA_VERSION = "ArtifactRef.v1";

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
}

function assertNonEmptyString(value, name, { max = 256 } = {}) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
  const normalized = value.trim();
  if (normalized.length > max) throw new TypeError(`${name} must be <= ${max} characters`);
  return normalized;
}

function normalizeOptionalString(value, name, { max = 256 } = {}) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  if (normalized.length > max) throw new TypeError(`${name} must be <= ${max} characters`);
  return normalized;
}

function normalizeArtifactHash(value, name, { requireHash = true } = {}) {
  if (value === null || value === undefined || String(value).trim() === "") {
    if (requireHash) throw new TypeError(`${name} is required`);
    return null;
  }
  const normalized = String(value).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) throw new TypeError(`${name} must be a sha256 hex string`);
  return normalized;
}

export function normalizeArtifactRefV1(value, { name = "artifactRef", requireHash = true } = {}) {
  assertPlainObject(value, name);
  const schemaVersion = normalizeOptionalString(value.schemaVersion, `${name}.schemaVersion`, { max: 64 }) ?? ARTIFACT_REF_SCHEMA_VERSION;
  if (schemaVersion !== ARTIFACT_REF_SCHEMA_VERSION) {
    throw new TypeError(`${name}.schemaVersion must be ${ARTIFACT_REF_SCHEMA_VERSION}`);
  }
  return normalizeForCanonicalJson(
    {
      schemaVersion,
      artifactId: assertNonEmptyString(value.artifactId, `${name}.artifactId`, { max: 256 }),
      artifactHash: normalizeArtifactHash(value.artifactHash, `${name}.artifactHash`, { requireHash }),
      artifactType: normalizeOptionalString(value.artifactType, `${name}.artifactType`, { max: 128 }),
      tenantId: normalizeOptionalString(value.tenantId, `${name}.tenantId`, { max: 128 }),
      metadata:
        value.metadata && typeof value.metadata === "object" && !Array.isArray(value.metadata)
          ? normalizeForCanonicalJson(value.metadata, { path: `${name}.metadata` })
          : null
    },
    { path: `$.${name}` }
  );
}

export function buildArtifactRefV1({
  artifactId,
  artifactHash,
  artifactType = null,
  tenantId = null,
  metadata = null
} = {}) {
  return normalizeArtifactRefV1(
    {
      schemaVersion: ARTIFACT_REF_SCHEMA_VERSION,
      artifactId,
      artifactHash,
      artifactType,
      tenantId,
      metadata
    },
    { name: "artifactRef", requireHash: true }
  );
}

export function validateArtifactRefV1(value, { requireHash = true } = {}) {
  normalizeArtifactRefV1(value, { name: "artifactRef", requireHash });
}

