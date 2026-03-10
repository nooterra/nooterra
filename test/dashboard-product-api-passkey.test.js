import test from "node:test";
import assert from "node:assert/strict";
import { createPublicKey, verify as verifySignature, webcrypto } from "node:crypto";

import {
  generateBrowserEd25519KeypairPem,
  loadStoredBuyerPasskeyBundle,
  removeStoredBuyerPasskeyBundle,
  saveStoredBuyerPasskeyBundle,
  signBrowserPasskeyChallengeBase64Url,
  touchStoredBuyerPasskeyBundle
} from "../dashboard/src/product/api.js";

function decodeBase64Url(value) {
  const normalized = String(value ?? "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, "base64");
}

function createMockLocalStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(String(key), String(value));
    },
    removeItem(key) {
      store.delete(String(key));
    },
    clear() {
      store.clear();
    }
  };
}

test("dashboard product api: browser passkey helpers store, touch, sign, and remove deterministic fields", async () => {
  const originalWindow = globalThis.window;
  const originalLocalStorage = globalThis.localStorage;
  const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");

  globalThis.window = {};
  globalThis.localStorage = createMockLocalStorage();
  if (!globalThis.crypto) {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto
    });
  }

  try {
    const { publicKeyPem, privateKeyPem, keyId } = await generateBrowserEd25519KeypairPem();
    const saved = saveStoredBuyerPasskeyBundle({
      tenantId: " tenant_demo ",
      email: "Founder@Nooterra.Work ",
      credentialId: " cred_demo ",
      publicKeyPem,
      privateKeyPem,
      keyId,
      label: " Founder laptop ",
      createdAt: "2026-03-09T10:00:00.000Z"
    });

    assert.equal(saved?.tenantId, "tenant_demo");
    assert.equal(saved?.email, "founder@nooterra.work");
    assert.equal(saved?.credentialId, "cred_demo");
    assert.equal(saved?.label, "Founder laptop");

    const loaded = loadStoredBuyerPasskeyBundle({
      tenantId: "tenant_demo",
      email: "FOUNDER@NOOTERRA.WORK"
    });
    assert.equal(loaded?.tenantId, "tenant_demo");
    assert.equal(loaded?.email, "founder@nooterra.work");
    assert.equal(loaded?.credentialId, "cred_demo");
    assert.equal(loaded?.publicKeyPem, publicKeyPem.trim());
    assert.equal(loaded?.privateKeyPem, privateKeyPem.trim());
    assert.equal(loaded?.keyId, keyId);
    assert.equal(loaded?.label, "Founder laptop");
    assert.equal(loaded?.createdAt, "2026-03-09T10:00:00.000Z");
    assert.equal(loaded?.lastUsedAt, null);

    const touched = touchStoredBuyerPasskeyBundle({
      tenantId: "tenant_demo",
      email: "founder@nooterra.work"
    });
    assert.equal(typeof touched?.lastUsedAt, "string");
    assert.notEqual(touched?.lastUsedAt, null);

    const challenge = "passkey_challenge_demo";
    const signature = await signBrowserPasskeyChallengeBase64Url({
      privateKeyPem,
      challenge
    });
    assert.match(signature, /^[A-Za-z0-9_-]+$/);
    assert.equal(
      verifySignature(null, Buffer.from(challenge, "utf8"), createPublicKey(publicKeyPem), decodeBase64Url(signature)),
      true
    );

    assert.equal(
      removeStoredBuyerPasskeyBundle({
        tenantId: "tenant_demo",
        email: "founder@nooterra.work"
      }),
      true
    );
    assert.equal(
      loadStoredBuyerPasskeyBundle({
        tenantId: "tenant_demo",
        email: "founder@nooterra.work"
      }),
      null
    );
  } finally {
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
    if (originalLocalStorage === undefined) {
      delete globalThis.localStorage;
    } else {
      globalThis.localStorage = originalLocalStorage;
    }
    if (originalCryptoDescriptor) {
      Object.defineProperty(globalThis, "crypto", originalCryptoDescriptor);
    } else {
      delete globalThis.crypto;
    }
  }
});
