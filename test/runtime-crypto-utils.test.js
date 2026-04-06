import test from 'node:test';
import assert from 'node:assert/strict';

import { decryptCredential, encryptCredential } from '../services/runtime/crypto-utils.js';

function withEnv(overrides, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('encryptCredential fails closed in production when no encryption key is configured', () => {
  withEnv({
    NODE_ENV: 'production',
    CREDENTIAL_ENCRYPTION_KEY: null,
    ALLOW_INSECURE_CREDENTIALS: null,
  }, () => {
    assert.throws(
      () => encryptCredential('sk_live_secret'),
      /CREDENTIAL_ENCRYPTION_KEY must be configured/,
    );
  });
});

test('decryptCredential fails closed for encrypted values when no encryption key is configured', () => {
  withEnv({
    NODE_ENV: 'production',
    CREDENTIAL_ENCRYPTION_KEY: null,
    ALLOW_INSECURE_CREDENTIALS: null,
  }, () => {
    assert.throws(
      () => decryptCredential('00112233445566778899aabb:deadbeef:00112233445566778899aabbccddeeff'),
      /CREDENTIAL_ENCRYPTION_KEY must be configured/,
    );
  });
});

test('encryptCredential still allows plaintext fallback outside production', () => {
  withEnv({
    NODE_ENV: 'test',
    CREDENTIAL_ENCRYPTION_KEY: null,
    ALLOW_INSECURE_CREDENTIALS: null,
  }, () => {
    assert.equal(encryptCredential('local-dev-secret'), 'local-dev-secret');
  });
});
