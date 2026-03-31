/**
 * Credential Encryption Utilities
 *
 * AES-256-GCM encryption for OAuth tokens and BYOK API keys at rest.
 * Set CREDENTIAL_ENCRYPTION_KEY env var (64-char hex = 32 bytes) to enable.
 * Without the key, functions gracefully fall back to plaintext (backward compatible).
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

/**
 * Returns the 32-byte encryption key from CREDENTIAL_ENCRYPTION_KEY env var.
 * Returns null if not set (encryption disabled).
 */
export function getEncryptionKey() {
  const hex = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!hex) {
    if (!_keyWarningLogged) {
      log('warn', 'CREDENTIAL_ENCRYPTION_KEY not set — credentials stored in plaintext');
      _keyWarningLogged = true;
    }
    return null;
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
 * Encrypt a credential if a key is available, otherwise return plaintext.
 */
export function encryptCredential(plaintext) {
  const key = getEncryptionKey();
  if (!key) return plaintext;
  return encrypt(plaintext, key);
}

/**
 * Decrypt a credential if it looks encrypted and a key is available, otherwise return as-is.
 */
export function decryptCredential(value) {
  if (!value) return value;
  const key = getEncryptionKey();
  if (!key || !looksEncrypted(value)) return value;
  try {
    return decrypt(value, key);
  } catch (err) {
    log('error', `Failed to decrypt credential: ${err.message}`);
    return value; // return raw value so caller can still attempt to use it
  }
}
