/**
 * Authentication & signer key repository.
 * Extracted from store-pg.js.
 *
 * Handles: auth_keys table (API key CRUD, rotation, status),
 *          signer_keys table (signing key management).
 */

import { DEFAULT_TENANT_ID, makeScopedKey, normalizeTenantId } from "../../core/tenancy.js";
import { normalizeSignerKeyPurpose, normalizeSignerKeyStatus } from "../../core/signer-keys.js";

// ---------------------------------------------------------------------------
// Shared helpers (pure, no DB)
// ---------------------------------------------------------------------------

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
}

// ---------------------------------------------------------------------------
// Row-to-record mappers
// ---------------------------------------------------------------------------

function authKeyRowToRecord(row) {
  if (!row) return null;
  const tenantId = normalizeTenantId(row?.tenant_id ?? DEFAULT_TENANT_ID);
  const keyId = row?.key_id ? String(row.key_id) : null;
  if (!keyId) return null;
  return {
    tenantId,
    keyId,
    secretHash: row?.secret_hash ? String(row.secret_hash) : null,
    scopes: Array.isArray(row?.scopes) ? row.scopes.map(String) : [],
    status: row?.status ? String(row.status) : "active",
    description: row?.description === null || row?.description === undefined ? null : String(row.description),
    expiresAt: row?.expires_at ? new Date(row.expires_at).toISOString() : null,
    lastUsedAt: row?.last_used_at ? new Date(row.last_used_at).toISOString() : null,
    createdAt: row?.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
    rotatedAt: row?.rotated_at ? new Date(row.rotated_at).toISOString() : null,
    revokedAt: row?.revoked_at ? new Date(row.revoked_at).toISOString() : null
  };
}

function signerKeyRowToRecord(row) {
  if (!row) return null;
  const tenantId = normalizeTenantId(row?.tenant_id ?? DEFAULT_TENANT_ID);
  const keyId = row?.key_id ? String(row.key_id) : null;
  if (!keyId) return null;
  const publicKeyPem = row?.public_key_pem ? String(row.public_key_pem) : null;
  if (!publicKeyPem) return null;
  return {
    tenantId,
    keyId,
    publicKeyPem,
    purpose: row?.purpose ? String(row.purpose) : "server",
    status: row?.status ? String(row.status) : "active",
    description: row?.description === null || row?.description === undefined ? null : String(row.description),
    validFrom: row?.valid_from ? new Date(row.valid_from).toISOString() : null,
    validTo: row?.valid_to ? new Date(row.valid_to).toISOString() : null,
    lastUsedAt: row?.last_used_at ? new Date(row.last_used_at).toISOString() : null,
    createdAt: row?.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
    rotatedAt: row?.rotated_at ? new Date(row.rotated_at).toISOString() : null,
    revokedAt: row?.revoked_at ? new Date(row.revoked_at).toISOString() : null
  };
}

function opsAuditRowToRecord(row) {
  if (!row) return null;
  const tenantId = normalizeTenantId(row?.tenant_id ?? DEFAULT_TENANT_ID);
  const id = row?.id === null || row?.id === undefined ? null : Number(row.id);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const action = row?.action ? String(row.action) : null;
  if (!action) return null;
  const detailsHash = row?.details_hash ? String(row.details_hash) : null;
  if (!detailsHash) return null;
  return {
    id,
    tenantId,
    actorKeyId: row?.actor_key_id ? String(row.actor_key_id) : null,
    actorPrincipalId: row?.actor_principal_id ? String(row.actor_principal_id) : null,
    action,
    targetType: row?.target_type ? String(row.target_type) : null,
    targetId: row?.target_id ? String(row.target_id) : null,
    requestId: row?.request_id ? String(row.request_id) : null,
    at: row?.at ? new Date(row.at).toISOString() : null,
    detailsHash,
    details: row?.details_json ?? null
  };
}

// ---------------------------------------------------------------------------
// Transaction helper
// ---------------------------------------------------------------------------

async function withTx(pool, arg1, arg2) {
  const options = typeof arg1 === "function" ? null : arg1;
  const fn = typeof arg1 === "function" ? arg1 : arg2;
  if (typeof fn !== "function") throw new TypeError("fn is required");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const timeoutMs = options?.statementTimeoutMs ?? null;
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      await client.query("SELECT set_config('statement_timeout', $1, true)", [`${Math.floor(timeoutMs)}ms`]);
    }
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Internal helpers (need a DB client)
// ---------------------------------------------------------------------------

async function insertOpsAuditRow(client, { tenantId, audit }) {
  tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
  if (!audit || typeof audit !== "object") throw new TypeError("audit is required");
  const action = audit.action ? String(audit.action) : null;
  if (!action) throw new TypeError("audit.action is required");
  const detailsHash = audit.detailsHash ? String(audit.detailsHash) : audit.details_hash ? String(audit.details_hash) : null;
  if (!detailsHash) throw new TypeError("audit.detailsHash is required");
  const atIso = audit.at ? new Date(String(audit.at)).toISOString() : null;
  const res = await client.query(
    `
      INSERT INTO ops_audit (
        tenant_id, actor_key_id, actor_principal_id, action, target_type, target_id, request_id, at, details_hash, details_json
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8::timestamptz, now()),$9,$10)
      RETURNING id, tenant_id, actor_key_id, actor_principal_id, action, target_type, target_id, request_id, at, details_hash, details_json
    `,
    [
      tenantId,
      audit.actorKeyId ?? null,
      audit.actorPrincipalId ?? null,
      action,
      audit.targetType ?? null,
      audit.targetId ?? null,
      audit.requestId ?? null,
      atIso,
      detailsHash,
      audit.details ?? null
    ]
  );
  return res.rows.length ? opsAuditRowToRecord(res.rows[0]) : null;
}

async function persistSignerKey(client, { tenantId, signerKey, publicKeyByKeyId }) {
  tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
  if (!signerKey || typeof signerKey !== "object") throw new TypeError("signerKey is required");
  const keyId = signerKey.keyId ?? signerKey.id ?? null;
  assertNonEmptyString(keyId, "signerKey.keyId");
  assertNonEmptyString(signerKey.publicKeyPem, "signerKey.publicKeyPem");
  const purpose = normalizeSignerKeyPurpose(signerKey.purpose ?? "server");
  const status = normalizeSignerKeyStatus(signerKey.status ?? "active");
  const description = signerKey.description === null || signerKey.description === undefined ? null : String(signerKey.description);
  const validFrom = signerKey.validFrom ? new Date(String(signerKey.validFrom)).toISOString() : null;
  const validTo = signerKey.validTo ? new Date(String(signerKey.validTo)).toISOString() : null;
  const lastUsedAt = signerKey.lastUsedAt ? new Date(String(signerKey.lastUsedAt)).toISOString() : null;
  const createdAt = signerKey.createdAt ? new Date(String(signerKey.createdAt)).toISOString() : new Date().toISOString();
  const updatedAt = signerKey.updatedAt ? new Date(String(signerKey.updatedAt)).toISOString() : new Date().toISOString();
  const rotatedAt = signerKey.rotatedAt ? new Date(String(signerKey.rotatedAt)).toISOString() : null;
  const revokedAt = signerKey.revokedAt ? new Date(String(signerKey.revokedAt)).toISOString() : null;

  await client.query(
    `
      INSERT INTO signer_keys (
        tenant_id, key_id, public_key_pem, purpose, status, description,
        valid_from, valid_to, last_used_at, created_at, updated_at, rotated_at, revoked_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT (tenant_id, key_id) DO UPDATE SET
        public_key_pem = EXCLUDED.public_key_pem,
        purpose = EXCLUDED.purpose,
        status = EXCLUDED.status,
        description = EXCLUDED.description,
        valid_from = EXCLUDED.valid_from,
        valid_to = EXCLUDED.valid_to,
        last_used_at = COALESCE(EXCLUDED.last_used_at, signer_keys.last_used_at),
        updated_at = EXCLUDED.updated_at,
        rotated_at = COALESCE(EXCLUDED.rotated_at, signer_keys.rotated_at),
        revoked_at = COALESCE(EXCLUDED.revoked_at, signer_keys.revoked_at)
    `,
    [
      tenantId,
      String(keyId),
      String(signerKey.publicKeyPem),
      purpose,
      status,
      description,
      validFrom,
      validTo,
      lastUsedAt,
      createdAt,
      updatedAt,
      rotatedAt,
      revokedAt
    ]
  );

  // Ensure signature verification map is hydrated.
  if (publicKeyByKeyId instanceof Map) {
    publicKeyByKeyId.set(String(keyId), String(signerKey.publicKeyPem));
  }
}

async function setSignerKeyStatusRow(client, { tenantId, keyId, status, at }) {
  tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
  assertNonEmptyString(keyId, "keyId");
  const normalizedStatus = normalizeSignerKeyStatus(status);
  const ts = at ? new Date(String(at)).toISOString() : new Date().toISOString();
  await client.query(
    `
      UPDATE signer_keys
      SET status = $3,
          updated_at = $4,
          rotated_at = CASE WHEN $3 = 'rotated' THEN COALESCE(rotated_at, $4) ELSE rotated_at END,
          revoked_at = CASE WHEN $3 = 'revoked' THEN COALESCE(revoked_at, $4) ELSE revoked_at END
      WHERE tenant_id = $1 AND key_id = $2
    `,
    [tenantId, keyId, normalizedStatus, ts]
  );
}

// ---------------------------------------------------------------------------
// Repository factory
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {import("pg").Pool} opts.pool  - Postgres connection pool
 * @param {Map} [opts.authKeys]          - In-memory auth key cache (optional)
 * @param {Map} [opts.signerKeys]        - In-memory signer key cache (optional)
 * @param {Map} [opts.publicKeyByKeyId]  - keyId -> PEM lookup (optional)
 */
export function createAuthKeysRepository({ pool, authKeys, signerKeys, publicKeyByKeyId } = {}) {
  if (!pool) throw new TypeError("pool is required");

  // -------------------------------------------------------------------------
  // Auth key cache refresh
  // -------------------------------------------------------------------------

  async function refreshAuthKeys() {
    if (!(authKeys instanceof Map)) return;
    authKeys.clear();
    try {
      const res = await pool.query(
        "SELECT tenant_id, key_id, secret_hash, scopes, status, description, expires_at, last_used_at, created_at, updated_at, rotated_at, revoked_at FROM auth_keys"
      );
      for (const row of res.rows) {
        const record = authKeyRowToRecord(row);
        if (!record) continue;
        const key = makeScopedKey({ tenantId: record.tenantId, id: record.keyId });
        authKeys.set(key, record);
      }
    } catch {
      // Ignore during early migrations.
    }
  }

  // -------------------------------------------------------------------------
  // Signer key cache refresh
  // -------------------------------------------------------------------------

  async function refreshSignerKeys() {
    if (!(signerKeys instanceof Map)) return;
    signerKeys.clear();
    try {
      const res = await pool.query(
        "SELECT tenant_id, key_id, public_key_pem, purpose, status, description, valid_from, valid_to, last_used_at, created_at, updated_at, rotated_at, revoked_at FROM signer_keys"
      );
      for (const row of res.rows) {
        const record = signerKeyRowToRecord(row);
        if (!record) continue;
        const key = makeScopedKey({ tenantId: record.tenantId, id: record.keyId });
        signerKeys.set(key, record);
        // Keep verification map hydrated.
        if (publicKeyByKeyId instanceof Map) {
          publicKeyByKeyId.set(record.keyId, record.publicKeyPem);
        }
      }
    } catch {
      // Ignore during early migrations.
    }
  }

  // -------------------------------------------------------------------------
  // Auth key CRUD
  // -------------------------------------------------------------------------

  async function getAuthKey({ tenantId = DEFAULT_TENANT_ID, keyId } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    assertNonEmptyString(keyId, "keyId");
    const res = await pool.query(
      `
        SELECT tenant_id, key_id, secret_hash, scopes, status, description, expires_at, last_used_at, created_at, updated_at, rotated_at, revoked_at
        FROM auth_keys
        WHERE tenant_id = $1 AND key_id = $2
        LIMIT 1
      `,
      [tenantId, keyId]
    );
    return res.rows.length ? authKeyRowToRecord(res.rows[0]) : null;
  }

  async function listAuthKeys({ tenantId = DEFAULT_TENANT_ID } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    const res = await pool.query(
      `
        SELECT tenant_id, key_id, secret_hash, scopes, status, description, expires_at, last_used_at, created_at, updated_at, rotated_at, revoked_at
        FROM auth_keys
        WHERE tenant_id = $1
        ORDER BY key_id ASC
      `,
      [tenantId]
    );
    return res.rows.map(authKeyRowToRecord).filter(Boolean);
  }

  async function putAuthKey({ tenantId = DEFAULT_TENANT_ID, authKey, audit = null } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    if (!authKey || typeof authKey !== "object") throw new TypeError("authKey is required");
    const keyId = authKey.keyId ?? authKey.id ?? null;
    assertNonEmptyString(keyId, "authKey.keyId");
    assertNonEmptyString(authKey.secretHash, "authKey.secretHash");
    const scopes = Array.isArray(authKey.scopes) ? authKey.scopes.map(String).filter(Boolean) : [];
    const status = authKey.status ? String(authKey.status) : "active";
    const description = authKey.description === null || authKey.description === undefined ? null : String(authKey.description);
    const expiresAt = authKey.expiresAt ? new Date(String(authKey.expiresAt)).toISOString() : null;
    const lastUsedAt = authKey.lastUsedAt ? new Date(String(authKey.lastUsedAt)).toISOString() : null;
    const createdAt = authKey.createdAt ? new Date(String(authKey.createdAt)).toISOString() : new Date().toISOString();
    const updatedAt = authKey.updatedAt ? new Date(String(authKey.updatedAt)).toISOString() : new Date().toISOString();
    const rotatedAt = authKey.rotatedAt ? new Date(String(authKey.rotatedAt)).toISOString() : null;
    const revokedAt = authKey.revokedAt ? new Date(String(authKey.revokedAt)).toISOString() : null;

    const record = await withTx(pool, async (client) => {
      const res = await client.query(
        `
          INSERT INTO auth_keys (
            tenant_id, key_id, secret_hash, scopes, status, description,
            expires_at, last_used_at, created_at, updated_at, rotated_at, revoked_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
          ON CONFLICT (tenant_id, key_id) DO UPDATE SET
            secret_hash = EXCLUDED.secret_hash,
            scopes = EXCLUDED.scopes,
            status = EXCLUDED.status,
            description = EXCLUDED.description,
            expires_at = EXCLUDED.expires_at,
            last_used_at = COALESCE(EXCLUDED.last_used_at, auth_keys.last_used_at),
            updated_at = EXCLUDED.updated_at,
            rotated_at = COALESCE(EXCLUDED.rotated_at, auth_keys.rotated_at),
            revoked_at = COALESCE(EXCLUDED.revoked_at, auth_keys.revoked_at)
          RETURNING tenant_id, key_id, secret_hash, scopes, status, description, expires_at, last_used_at, created_at, updated_at, rotated_at, revoked_at
        `,
        [tenantId, String(keyId), String(authKey.secretHash), scopes, status, description, expiresAt, lastUsedAt, createdAt, updatedAt, rotatedAt, revokedAt]
      );
      const record = res.rows.length ? authKeyRowToRecord(res.rows[0]) : null;
      if (audit) await insertOpsAuditRow(client, { tenantId, audit });
      return record;
    });
    if (record && authKeys instanceof Map) {
      authKeys.set(makeScopedKey({ tenantId: record.tenantId, id: record.keyId }), record);
    }
    return record;
  }

  async function touchAuthKey({ tenantId = DEFAULT_TENANT_ID, keyId, at = null } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    assertNonEmptyString(keyId, "keyId");
    const ts = at ? new Date(String(at)).toISOString() : new Date().toISOString();
    const res = await pool.query(
      "UPDATE auth_keys SET last_used_at = $3, updated_at = $3 WHERE tenant_id = $1 AND key_id = $2",
      [tenantId, keyId, ts]
    );
    if (authKeys instanceof Map) {
      const key = makeScopedKey({ tenantId, id: String(keyId) });
      const existing = authKeys.get(key) ?? null;
      if (existing) authKeys.set(key, { ...existing, lastUsedAt: ts, updatedAt: ts });
    }
    return res.rowCount > 0;
  }

  async function setAuthKeyStatus({ tenantId = DEFAULT_TENANT_ID, keyId, status, at = null, audit = null } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    assertNonEmptyString(keyId, "keyId");
    assertNonEmptyString(status, "status");
    const ts = at ? new Date(String(at)).toISOString() : new Date().toISOString();
    const record = await withTx(pool, async (client) => {
      const res = await client.query(
        `
          UPDATE auth_keys
          SET status = $3,
              updated_at = $4,
              rotated_at = CASE WHEN $3 = 'rotated' THEN COALESCE(rotated_at, $4) ELSE rotated_at END,
              revoked_at = CASE WHEN $3 = 'revoked' THEN COALESCE(revoked_at, $4) ELSE revoked_at END
          WHERE tenant_id = $1 AND key_id = $2
          RETURNING tenant_id, key_id, secret_hash, scopes, status, description, expires_at, last_used_at, created_at, updated_at, rotated_at, revoked_at
        `,
        [tenantId, keyId, String(status), ts]
      );
      const record = res.rows.length ? authKeyRowToRecord(res.rows[0]) : null;
      if (audit) await insertOpsAuditRow(client, { tenantId, audit });
      return record;
    });
    if (record && authKeys instanceof Map) {
      authKeys.set(makeScopedKey({ tenantId: record.tenantId, id: record.keyId }), record);
    }
    return record;
  }

  async function rotateAuthKey({
    tenantId = DEFAULT_TENANT_ID,
    oldKeyId,
    newAuthKey,
    rotatedAt = null,
    audit = null
  } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    assertNonEmptyString(oldKeyId, "oldKeyId");
    if (!newAuthKey || typeof newAuthKey !== "object") throw new TypeError("newAuthKey is required");
    const newKeyId = newAuthKey.keyId ?? newAuthKey.id ?? null;
    assertNonEmptyString(newKeyId, "newAuthKey.keyId");
    const secretHash = newAuthKey.secretHash ?? null;
    assertNonEmptyString(secretHash, "newAuthKey.secretHash");
    const ts = rotatedAt ? new Date(String(rotatedAt)).toISOString() : new Date().toISOString();

    const result = await withTx(pool, async (client) => {
      const existing = await client.query(
        "SELECT status, scopes, description, expires_at FROM auth_keys WHERE tenant_id = $1 AND key_id = $2 LIMIT 1 FOR UPDATE",
        [tenantId, String(oldKeyId)]
      );
      if (!existing.rows.length) return null;
      const row = existing.rows[0];
      const status = row?.status ? String(row.status) : "active";
      if (status === "revoked") {
        const err = new Error("auth key is revoked");
        err.code = "AUTH_KEY_REVOKED";
        throw err;
      }

      await client.query(
        `
          UPDATE auth_keys
          SET status = 'rotated',
              updated_at = $3,
              rotated_at = COALESCE(rotated_at, $3)
          WHERE tenant_id = $1 AND key_id = $2
        `,
        [tenantId, String(oldKeyId), ts]
      );

      const scopes = Array.isArray(newAuthKey.scopes)
        ? newAuthKey.scopes.map(String).filter(Boolean)
        : Array.isArray(row?.scopes)
          ? row.scopes.map(String)
          : [];
      const description = newAuthKey.description === undefined ? (row?.description ?? null) : newAuthKey.description;
      const expiresAt =
        newAuthKey.expiresAt !== undefined
          ? newAuthKey.expiresAt
            ? new Date(String(newAuthKey.expiresAt)).toISOString()
            : null
          : row?.expires_at
            ? new Date(row.expires_at).toISOString()
            : null;

      const inserted = await client.query(
        `
          INSERT INTO auth_keys (
            tenant_id, key_id, secret_hash, scopes, status, description,
            expires_at, last_used_at, created_at, updated_at, rotated_at, revoked_at
          ) VALUES ($1,$2,$3,$4,'active',$5,$6,NULL,$7,$7,NULL,NULL)
          ON CONFLICT (tenant_id, key_id) DO UPDATE SET
            secret_hash = EXCLUDED.secret_hash,
            scopes = EXCLUDED.scopes,
            status = EXCLUDED.status,
            description = EXCLUDED.description,
            expires_at = EXCLUDED.expires_at,
            updated_at = EXCLUDED.updated_at
          RETURNING tenant_id, key_id, secret_hash, scopes, status, description, expires_at, last_used_at, created_at, updated_at, rotated_at, revoked_at
        `,
        [tenantId, String(newKeyId), String(secretHash), scopes, description === undefined ? null : description, expiresAt, ts]
      );
      const newRecord = inserted.rows.length ? authKeyRowToRecord(inserted.rows[0]) : null;

      if (audit) await insertOpsAuditRow(client, { tenantId, audit });
      return { rotatedAt: ts, oldKeyId: String(oldKeyId), newKeyId: String(newKeyId), newKey: newRecord };
    });

    if (!result) return null;
    if (authKeys instanceof Map) {
      const old = await getAuthKey({ tenantId, keyId: String(oldKeyId) });
      const next = await getAuthKey({ tenantId, keyId: String(result.newKeyId) });
      if (old) authKeys.set(makeScopedKey({ tenantId: old.tenantId, id: old.keyId }), old);
      if (next) authKeys.set(makeScopedKey({ tenantId: next.tenantId, id: next.keyId }), next);
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Signer key CRUD
  // -------------------------------------------------------------------------

  async function getSignerKey({ tenantId = DEFAULT_TENANT_ID, keyId } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    assertNonEmptyString(keyId, "keyId");
    const res = await pool.query(
      `
        SELECT tenant_id, key_id, public_key_pem, purpose, status, description, valid_from, valid_to, last_used_at, created_at, updated_at, rotated_at, revoked_at
        FROM signer_keys
        WHERE tenant_id = $1 AND key_id = $2
        LIMIT 1
      `,
      [tenantId, keyId]
    );
    return res.rows.length ? signerKeyRowToRecord(res.rows[0]) : null;
  }

  async function listSignerKeys({ tenantId = DEFAULT_TENANT_ID } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    const res = await pool.query(
      `
        SELECT tenant_id, key_id, public_key_pem, purpose, status, description, valid_from, valid_to, last_used_at, created_at, updated_at, rotated_at, revoked_at
        FROM signer_keys
        WHERE tenant_id = $1
        ORDER BY key_id ASC
      `,
      [tenantId]
    );
    return res.rows.map(signerKeyRowToRecord).filter(Boolean);
  }

  async function putSignerKey({ tenantId = DEFAULT_TENANT_ID, signerKey, audit = null } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    await withTx(pool, async (client) => {
      await persistSignerKey(client, { tenantId, signerKey, publicKeyByKeyId });
      if (audit) await insertOpsAuditRow(client, { tenantId, audit });
    });
    const record = await getSignerKey({ tenantId, keyId: signerKey?.keyId ?? signerKey?.id ?? "" });
    if (record && signerKeys instanceof Map) signerKeys.set(makeScopedKey({ tenantId, id: record.keyId }), record);
    return record;
  }

  async function setSignerKeyStatus({ tenantId = DEFAULT_TENANT_ID, keyId, status, at = null, audit = null } = {}) {
    tenantId = normalizeTenantId(tenantId ?? DEFAULT_TENANT_ID);
    await withTx(pool, async (client) => {
      await setSignerKeyStatusRow(client, { tenantId, keyId, status, at: at ?? new Date().toISOString() });
      if (audit) await insertOpsAuditRow(client, { tenantId, audit });
    });
    const record = await getSignerKey({ tenantId, keyId });
    if (record && signerKeys instanceof Map) signerKeys.set(makeScopedKey({ tenantId, id: record.keyId }), record);
    return record;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  return {
    // Auth keys
    getAuthKey,
    listAuthKeys,
    putAuthKey,
    touchAuthKey,
    setAuthKeyStatus,
    rotateAuthKey,
    refreshAuthKeys,

    // Signer keys
    getSignerKey,
    listSignerKeys,
    putSignerKey,
    setSignerKeyStatus,
    refreshSignerKeys
  };
}
