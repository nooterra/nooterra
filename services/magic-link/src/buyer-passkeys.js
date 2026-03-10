import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { normalizeEmailLower } from "./buyer-auth.js";

const PASSKEY_CHALLENGE_PURPOSES = new Set(["signup", "login", "step_up"]);

function nowIso() {
  return new Date().toISOString();
}

function sha256Hex(text) {
  return crypto.createHash("sha256").update(String(text ?? ""), "utf8").digest("hex");
}

function clampText(value, { max }) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  return text.length <= max ? text : text.slice(0, max);
}

function ensureDir(filePath) {
  return fs.mkdir(path.dirname(filePath), { recursive: true });
}

function passkeysPath(dataDir, tenantId) {
  return path.join(String(dataDir ?? "."), "buyer-passkeys", `${String(tenantId ?? "").trim()}.json`);
}

function challengePath(dataDir, tenantId, challengeId) {
  return path.join(String(dataDir ?? "."), "buyer-passkey-challenges", String(tenantId ?? "").trim(), `${String(challengeId ?? "").trim()}.json`);
}

function normalizeCredentialId(value) {
  const text = clampText(value, { max: 512 });
  if (!text) return null;
  if (!/^[A-Za-z0-9._~=-]+$/.test(text)) return null;
  return text;
}

function normalizeLabel(value) {
  return clampText(value, { max: 160 }) ?? "";
}

function normalizeChallengePurpose(value) {
  const purpose = String(value ?? "").trim().toLowerCase();
  return PASSKEY_CHALLENGE_PURPOSES.has(purpose) ? purpose : null;
}

function normalizePublicKeyPem(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  try {
    const keyObject = crypto.createPublicKey(raw);
    return keyObject.export({ type: "spki", format: "pem" }).toString();
  } catch {
    return null;
  }
}

function describePublicKeyAlgorithm(publicKeyPem) {
  try {
    const keyObject = crypto.createPublicKey(publicKeyPem);
    const keyType = String(keyObject.asymmetricKeyType ?? "").trim().toLowerCase();
    if (keyType === "ec") return "ec";
    if (keyType === "ed25519") return "ed25519";
    if (keyType === "ed448") return "ed448";
    if (keyType === "rsa") return "rsa";
    if (keyType === "rsa-pss") return "rsa-pss";
    return "unknown";
  } catch {
    return "unknown";
  }
}

function verifyChallengeSignature({ publicKeyPem, challenge, signatureBase64Url }) {
  const normalizedKey = normalizePublicKeyPem(publicKeyPem);
  const challengeText = typeof challenge === "string" ? challenge.trim() : "";
  const signatureText = typeof signatureBase64Url === "string" ? signatureBase64Url.trim() : "";
  if (!normalizedKey || !challengeText || !signatureText) return false;

  let signature;
  let keyObject;
  try {
    signature = Buffer.from(signatureText, "base64url");
    keyObject = crypto.createPublicKey(normalizedKey);
  } catch {
    return false;
  }

  if (!signature.length) return false;
  const keyType = String(keyObject.asymmetricKeyType ?? "").trim().toLowerCase();
  const payload = Buffer.from(challengeText, "utf8");
  try {
    if (keyType === "ed25519" || keyType === "ed448") {
      return crypto.verify(null, payload, keyObject, signature);
    }
    return crypto.verify("sha256", payload, keyObject, signature);
  } catch {
    return false;
  }
}

function normalizePasskeyDoc(raw, tenantId) {
  const normalizedTenantId = String(tenantId ?? "").trim();
  const doc = {
    schemaVersion: "BuyerPasskeys.v1",
    tenantId: normalizedTenantId,
    updatedAt: nowIso(),
    users: {}
  };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return doc;
  const users = raw.users && typeof raw.users === "object" && !Array.isArray(raw.users) ? raw.users : {};
  for (const [rawEmail, rawRows] of Object.entries(users)) {
    const email = normalizeEmailLower(rawEmail);
    if (!email || !Array.isArray(rawRows)) continue;
    const rows = [];
    for (const row of rawRows) {
      const credentialId = normalizeCredentialId(row?.credentialId);
      const publicKeyPem = normalizePublicKeyPem(row?.publicKeyPem);
      if (!credentialId || !publicKeyPem) continue;
      const createdAt = typeof row?.createdAt === "string" && row.createdAt.trim() ? row.createdAt : nowIso();
      const updatedAt = typeof row?.updatedAt === "string" && row.updatedAt.trim() ? row.updatedAt : createdAt;
      rows.push({
        credentialId,
        publicKeyPem,
        algorithm: describePublicKeyAlgorithm(publicKeyPem),
        label: normalizeLabel(row?.label),
        createdAt,
        updatedAt,
        lastUsedAt: typeof row?.lastUsedAt === "string" && row.lastUsedAt.trim() ? row.lastUsedAt : null,
        revokedAt: typeof row?.revokedAt === "string" && row.revokedAt.trim() ? row.revokedAt : null
      });
    }
    rows.sort((a, b) => a.credentialId.localeCompare(b.credentialId));
    if (rows.length) doc.users[email] = rows;
  }
  return doc;
}

async function loadPasskeyDoc({ dataDir, tenantId }) {
  const filePath = passkeysPath(dataDir, tenantId);
  try {
    const raw = JSON.parse(await fs.readFile(filePath, "utf8"));
    return normalizePasskeyDoc(raw, tenantId);
  } catch {
    return normalizePasskeyDoc(null, tenantId);
  }
}

async function savePasskeyDoc({ dataDir, tenantId, doc }) {
  const filePath = passkeysPath(dataDir, tenantId);
  await ensureDir(filePath);
  const tmpPath = `${filePath}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await fs.writeFile(tmpPath, JSON.stringify(doc, null, 2) + "\n", "utf8");
  await fs.rename(tmpPath, filePath);
}

function normalizeChallengeRecord(raw, { tenantId, challengeId }) {
  const normalizedTenantId = String(tenantId ?? "").trim();
  const normalizedChallengeId = String(challengeId ?? "").trim();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (String(raw.schemaVersion ?? "") !== "BuyerPasskeyChallengeRecord.v1") return null;
  const purpose = normalizeChallengePurpose(raw.purpose);
  const email = normalizeEmailLower(raw.email);
  const challenge = clampText(raw.challenge, { max: 512 });
  if (!purpose || !email || !challenge) return null;
  if (String(raw.tenantId ?? "") !== normalizedTenantId || String(raw.challengeId ?? "") !== normalizedChallengeId) return null;
  return {
    schemaVersion: "BuyerPasskeyChallengeRecord.v1",
    tenantId: normalizedTenantId,
    challengeId: normalizedChallengeId,
    purpose,
    email,
    challenge,
    createdAt: typeof raw.createdAt === "string" && raw.createdAt.trim() ? raw.createdAt : nowIso(),
    expiresAt: typeof raw.expiresAt === "string" && raw.expiresAt.trim() ? raw.expiresAt : "",
    consumedAt: typeof raw.consumedAt === "string" && raw.consumedAt.trim() ? raw.consumedAt : null,
    metadata: raw.metadata && typeof raw.metadata === "object" && !Array.isArray(raw.metadata) ? raw.metadata : {}
  };
}

async function loadChallengeRecord({ dataDir, tenantId, challengeId }) {
  const filePath = challengePath(dataDir, tenantId, challengeId);
  try {
    const raw = JSON.parse(await fs.readFile(filePath, "utf8"));
    return normalizeChallengeRecord(raw, { tenantId, challengeId });
  } catch {
    return null;
  }
}

async function saveChallengeRecord({ dataDir, tenantId, challengeId, record }) {
  const filePath = challengePath(dataDir, tenantId, challengeId);
  await ensureDir(filePath);
  await fs.writeFile(filePath, JSON.stringify(record, null, 2) + "\n", "utf8");
}

export async function issueBuyerPasskeyChallenge({ dataDir, tenantId, email, purpose, ttlSeconds, metadata = {} } = {}) {
  const normalizedTenantId = String(tenantId ?? "").trim();
  const normalizedEmail = normalizeEmailLower(email);
  const normalizedPurpose = normalizeChallengePurpose(purpose);
  const ttl = Number.parseInt(String(ttlSeconds ?? ""), 10);
  if (!normalizedTenantId) return { ok: false, error: "INVALID_TENANT", message: "tenantId is required" };
  if (!normalizedEmail) return { ok: false, error: "INVALID_EMAIL", message: "email is required" };
  if (!normalizedPurpose) return { ok: false, error: "PASSKEY_PURPOSE_INVALID", message: "invalid passkey challenge purpose" };
  if (!Number.isInteger(ttl) || ttl <= 0) throw new TypeError("ttlSeconds must be a positive integer");

  const challengeId = crypto.randomBytes(16).toString("hex");
  const challenge = crypto.randomBytes(32).toString("base64url");
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
  const record = {
    schemaVersion: "BuyerPasskeyChallengeRecord.v1",
    tenantId: normalizedTenantId,
    challengeId,
    purpose: normalizedPurpose,
    email: normalizedEmail,
    challenge,
    createdAt,
    expiresAt,
    consumedAt: null,
    metadata: metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {}
  };
  await saveChallengeRecord({ dataDir, tenantId: normalizedTenantId, challengeId, record });
  return { ok: true, tenantId: normalizedTenantId, email: normalizedEmail, challengeId, challenge, expiresAt };
}

function toPublicPasskeyRow(email, row) {
  return {
    email,
    credentialId: row.credentialId,
    algorithm: row.algorithm,
    label: row.label,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt
  };
}

export async function listBuyerPasskeys({ dataDir, tenantId, email, includeRevoked = false } = {}) {
  const normalizedTenantId = String(tenantId ?? "").trim();
  const normalizedEmail = normalizeEmailLower(email);
  if (!normalizedTenantId || !normalizedEmail) return [];
  const doc = await loadPasskeyDoc({ dataDir, tenantId: normalizedTenantId });
  const rows = Array.isArray(doc.users[normalizedEmail]) ? doc.users[normalizedEmail] : [];
  return rows.filter((row) => includeRevoked || !row.revokedAt).map((row) => toPublicPasskeyRow(normalizedEmail, row));
}

async function findBuyerPasskeyRow({ dataDir, tenantId, email, credentialId }) {
  const normalizedTenantId = String(tenantId ?? "").trim();
  const normalizedEmail = normalizeEmailLower(email);
  const normalizedCredentialId = normalizeCredentialId(credentialId);
  if (!normalizedTenantId || !normalizedEmail || !normalizedCredentialId) return { doc: null, row: null, email: normalizedEmail, credentialId: normalizedCredentialId };
  const doc = await loadPasskeyDoc({ dataDir, tenantId: normalizedTenantId });
  const rows = Array.isArray(doc.users[normalizedEmail]) ? doc.users[normalizedEmail] : [];
  const row = rows.find((candidate) => candidate.credentialId === normalizedCredentialId && !candidate.revokedAt) ?? null;
  return { doc, row, email: normalizedEmail, credentialId: normalizedCredentialId };
}

export async function registerBuyerPasskey({ dataDir, tenantId, email, credentialId, publicKeyPem, label = "" } = {}) {
  const normalizedTenantId = String(tenantId ?? "").trim();
  const normalizedEmail = normalizeEmailLower(email);
  const normalizedCredentialId = normalizeCredentialId(credentialId);
  const normalizedPublicKeyPem = normalizePublicKeyPem(publicKeyPem);
  if (!normalizedTenantId) return { ok: false, error: "INVALID_TENANT", message: "tenantId is required" };
  if (!normalizedEmail) return { ok: false, error: "INVALID_EMAIL", message: "email is required" };
  if (!normalizedCredentialId) return { ok: false, error: "PASSKEY_CREDENTIAL_INVALID", message: "credentialId is required" };
  if (!normalizedPublicKeyPem) return { ok: false, error: "PASSKEY_PUBLIC_KEY_INVALID", message: "publicKeyPem is required" };

  const doc = await loadPasskeyDoc({ dataDir, tenantId: normalizedTenantId });
  for (const [otherEmail, rows] of Object.entries(doc.users)) {
    const conflict = Array.isArray(rows)
      ? rows.find((row) => row.credentialId === normalizedCredentialId && !row.revokedAt && otherEmail !== normalizedEmail)
      : null;
    if (conflict) {
      return {
        ok: false,
        error: "PASSKEY_CREDENTIAL_CONFLICT",
        message: "credentialId is already registered to another buyer"
      };
    }
  }

  const nowAt = nowIso();
  const rows = Array.isArray(doc.users[normalizedEmail]) ? [...doc.users[normalizedEmail]] : [];
  const existingIndex = rows.findIndex((row) => row.credentialId === normalizedCredentialId);
  const nextRow = {
    credentialId: normalizedCredentialId,
    publicKeyPem: normalizedPublicKeyPem,
    algorithm: describePublicKeyAlgorithm(normalizedPublicKeyPem),
    label: normalizeLabel(label),
    createdAt: existingIndex >= 0 ? rows[existingIndex].createdAt : nowAt,
    updatedAt: nowAt,
    lastUsedAt: existingIndex >= 0 ? rows[existingIndex].lastUsedAt : null,
    revokedAt: null
  };
  if (existingIndex >= 0) rows[existingIndex] = nextRow;
  else rows.push(nextRow);
  rows.sort((a, b) => a.credentialId.localeCompare(b.credentialId));
  doc.users[normalizedEmail] = rows;
  doc.updatedAt = nowAt;
  await savePasskeyDoc({ dataDir, tenantId: normalizedTenantId, doc });
  return { ok: true, tenantId: normalizedTenantId, email: normalizedEmail, passkey: toPublicPasskeyRow(normalizedEmail, nextRow) };
}

export async function touchBuyerPasskey({ dataDir, tenantId, email, credentialId, at = nowIso() } = {}) {
  const found = await findBuyerPasskeyRow({ dataDir, tenantId, email, credentialId });
  if (!found.doc || !found.row || !found.email || !found.credentialId) return { ok: false, error: "PASSKEY_NOT_REGISTERED" };
  const rows = Array.isArray(found.doc.users[found.email]) ? [...found.doc.users[found.email]] : [];
  const index = rows.findIndex((row) => row.credentialId === found.credentialId && !row.revokedAt);
  if (index < 0) return { ok: false, error: "PASSKEY_NOT_REGISTERED" };
  rows[index] = {
    ...rows[index],
    lastUsedAt: typeof at === "string" && at.trim() ? at : nowIso(),
    updatedAt: typeof at === "string" && at.trim() ? at : nowIso()
  };
  found.doc.users[found.email] = rows;
  found.doc.updatedAt = typeof at === "string" && at.trim() ? at : nowIso();
  await savePasskeyDoc({ dataDir, tenantId, doc: found.doc });
  return { ok: true };
}

export async function verifyAndConsumeBuyerPasskeyChallenge({
  dataDir,
  tenantId,
  challengeId,
  challenge,
  purpose,
  credentialId,
  signature,
  publicKeyPem = null
} = {}) {
  const normalizedTenantId = String(tenantId ?? "").trim();
  const normalizedChallengeId = String(challengeId ?? "").trim();
  const normalizedChallenge = clampText(challenge, { max: 512 });
  const normalizedPurpose = normalizeChallengePurpose(purpose);
  const normalizedCredentialId = normalizeCredentialId(credentialId);
  const providedPublicKeyPem = publicKeyPem === null || publicKeyPem === undefined ? null : normalizePublicKeyPem(publicKeyPem);
  if (!normalizedTenantId) return { ok: false, error: "INVALID_TENANT", message: "tenantId is required" };
  if (!normalizedChallengeId || !normalizedChallenge) {
    return { ok: false, error: "PASSKEY_CHALLENGE_REQUIRED", message: "challengeId and challenge are required" };
  }
  if (!normalizedPurpose) return { ok: false, error: "PASSKEY_PURPOSE_INVALID", message: "invalid passkey challenge purpose" };
  if (!normalizedCredentialId) return { ok: false, error: "PASSKEY_CREDENTIAL_INVALID", message: "credentialId is required" };

  const record = await loadChallengeRecord({ dataDir, tenantId: normalizedTenantId, challengeId: normalizedChallengeId });
  if (!record) return { ok: false, error: "PASSKEY_CHALLENGE_MISSING", message: "no active passkey challenge" };
  if (record.purpose !== normalizedPurpose) return { ok: false, error: "PASSKEY_CHALLENGE_INVALID", message: "challenge purpose mismatch" };
  if (record.consumedAt) return { ok: false, error: "PASSKEY_CHALLENGE_CONSUMED", message: "challenge already used" };
  const expiresMs = Date.parse(record.expiresAt);
  if (!Number.isFinite(expiresMs) || Date.now() > expiresMs) return { ok: false, error: "PASSKEY_CHALLENGE_EXPIRED", message: "challenge expired" };
  if (record.challenge !== normalizedChallenge) {
    record.consumedAt = nowIso();
    await saveChallengeRecord({ dataDir, tenantId: normalizedTenantId, challengeId: normalizedChallengeId, record });
    return { ok: false, error: "PASSKEY_CHALLENGE_INVALID", message: "challenge mismatch" };
  }

  let verificationKeyPem = providedPublicKeyPem;
  let matchedPasskey = null;
  if (!verificationKeyPem) {
    const found = await findBuyerPasskeyRow({
      dataDir,
      tenantId: normalizedTenantId,
      email: record.email,
      credentialId: normalizedCredentialId
    });
    if (!found.row) return { ok: false, error: "PASSKEY_NOT_REGISTERED", message: "no active passkey matches this credential" };
    matchedPasskey = toPublicPasskeyRow(found.email, found.row);
    verificationKeyPem = found.row.publicKeyPem;
  }

  if (!verifyChallengeSignature({ publicKeyPem: verificationKeyPem, challenge: record.challenge, signatureBase64Url: signature })) {
    record.consumedAt = nowIso();
    await saveChallengeRecord({ dataDir, tenantId: normalizedTenantId, challengeId: normalizedChallengeId, record });
    return { ok: false, error: "PASSKEY_SIGNATURE_INVALID", message: "passkey signature is invalid" };
  }

  record.consumedAt = nowIso();
  record.metadata = {
    ...record.metadata,
    verifiedCredentialId: normalizedCredentialId,
    verifiedCredentialHash: sha256Hex(normalizedCredentialId)
  };
  await saveChallengeRecord({ dataDir, tenantId: normalizedTenantId, challengeId: normalizedChallengeId, record });

  return {
    ok: true,
    tenantId: normalizedTenantId,
    email: record.email,
    credentialId: normalizedCredentialId,
    publicKeyPem: verificationKeyPem,
    passkey: matchedPasskey,
    metadata: record.metadata
  };
}
