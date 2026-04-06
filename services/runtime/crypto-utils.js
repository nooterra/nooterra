/**
 * Credential Encryption Utilities
 *
 * AES-256-GCM encryption for OAuth tokens and BYOK API keys at rest.
 * Set CREDENTIAL_ENCRYPTION_KEY env var (64-char hex = 32 bytes) to enable.
 * Insecure plaintext fallback is allowed only outside production, or when
 * ALLOW_INSECURE_CREDENTIALS=true is explicitly set.
 */

import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

function log(level, msg) {
  const ts = new Date().toISOString();
  const line = JSON.stringify({ ts, level, component: 'crypto-utils', msg });
  if (level === 'error' || level === 'warn') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

let _keyWarningLogged = false;
let _plaintextWarningLogged = false;

function insecureCredentialFallbackAllowed() {
  // NEVER allow insecure credentials in production, regardless of env vars
  if (process.env.NODE_ENV === 'production') return false;
  return true; // dev/test only
}

/**
 * Returns the 32-byte encryption key from CREDENTIAL_ENCRYPTION_KEY env var.
 * Returns null only when insecure fallback is explicitly allowed.
 */
export function getEncryptionKey(options = {}) {
  const { strict = false, allowInsecureFallback = true } = options;
  const hex = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!hex) {
    if (strict && (!allowInsecureFallback || !insecureCredentialFallbackAllowed())) {
      throw new Error('CREDENTIAL_ENCRYPTION_KEY must be configured for secure credential storage');
    }
    if (!_keyWarningLogged) {
      log('warn', 'CREDENTIAL_ENCRYPTION_KEY not set — insecure credential fallback is active');
      _keyWarningLogged = true;
    }
    return null;
  }
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY must be a 64-character hex string');
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Encrypt plaintext with AES-256-GCM.
 * @param {string} plaintext
 * @param {Buffer} key - 32-byte key
 * @returns {string} "iv:ciphertext:authTag" in hex
 */
export function encrypt(plaintext, key) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${encrypted}:${authTag}`;
}

/**
 * Decrypt a value produced by encrypt().
 * @param {string} encrypted - "iv:ciphertext:authTag" in hex
 * @param {Buffer} key - 32-byte key
 * @returns {string} plaintext
 */
export function decrypt(encrypted, key) {
  const [ivHex, ciphertextHex, authTagHex] = encrypted.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(ciphertextHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Returns true if a string looks like an encrypted value (iv:ciphertext:authTag).
 */
export function looksEncrypted(value) {
  if (!value || typeof value !== 'string') return false;
  const parts = value.split(':');
  return parts.length === 3 && parts.every(p => /^[0-9a-f]+$/.test(p));
}

/**
 * Encrypt a credential. Outside production, plaintext fallback is allowed only
 * when secure storage is intentionally unavailable.
 */
export function encryptCredential(plaintext) {
  const key = getEncryptionKey({ strict: true, allowInsecureFallback: true });
  if (!key) return plaintext;
  return encrypt(plaintext, key);
}

/**
 * Decrypt a credential. Encrypted values must always decrypt successfully.
 * Plaintext fallback is only allowed in non-production or when explicitly enabled.
 */
export function decryptCredential(value) {
  if (!value) return value;
  const encrypted = looksEncrypted(value);
  if (!encrypted) {
    if (!insecureCredentialFallbackAllowed()) {
      throw new Error('Plaintext credentials are not allowed without ALLOW_INSECURE_CREDENTIALS=true');
    }
    if (!_plaintextWarningLogged) {
      log('warn', 'Using plaintext credential fallback');
      _plaintextWarningLogged = true;
    }
    return value;
  }

  const key = getEncryptionKey({ strict: true, allowInsecureFallback: false });
  try {
    return decrypt(value, key);
  } catch (err) {
    log('error', `Failed to decrypt credential: ${err.message}`);
    throw new Error('Stored credential could not be decrypted');
  }
}
