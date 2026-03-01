import test from "node:test";
import assert from "node:assert/strict";

import { configForLog, loadConfig } from "../src/core/config.js";

const FED_ENV_KEYS = [
  "COORDINATOR_DID",
  "PROXY_COORDINATOR_DID",
  "PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS",
  "COORDINATOR_SIGNING_PRIVATE_KEY_PEM",
  "COORDINATOR_SIGNING_KEY_ID",
  "COORDINATOR_SIGNING_KEY",
  "PROXY_COORDINATOR_SIGNING_PRIVATE_KEY_PEM",
  "PROXY_COORDINATOR_SIGNING_KEY_ID",
];

function withFederationEnv(overrides, fn) {
  const snapshot = new Map();
  for (const key of FED_ENV_KEYS) snapshot.set(key, process.env[key]);
  try {
    for (const key of FED_ENV_KEYS) delete process.env[key];
    for (const [key, value] of Object.entries(overrides ?? {})) {
      if (value === null || value === undefined) delete process.env[key];
      else process.env[key] = String(value);
    }
    return fn();
  } finally {
    for (const key of FED_ENV_KEYS) {
      const prev = snapshot.get(key);
      if (prev === undefined) delete process.env[key];
      else process.env[key] = prev;
    }
  }
}

test("config federation: defaults to disabled when no federation env vars are set", () => {
  withFederationEnv({}, () => {
    const cfg = loadConfig({ mode: "api" });
    assert.equal(cfg.federation?.enabled, false);
    assert.equal(cfg.federation?.coordinatorDid, null);
    assert.deepEqual(cfg.federation?.trustedCoordinatorDids, []);
    assert.equal(cfg.federation?.signing?.enabled, false);
    assert.equal(cfg.federation?.signing?.keyId, null);
    assert.equal(cfg.federation?.signing?.privateKeyPem, null);
  });
});

test("config federation: parses coordinator DID, trusted peers, and signing config deterministically", () => {
  withFederationEnv(
    {
      COORDINATOR_DID: "did:nooterra:coord_alpha",
      PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS:
        "did:nooterra:coord_bravo, did:nooterra:coord_alpha, did:nooterra:coord_bravo, did:nooterra:coord_charlie",
      PROXY_COORDINATOR_SIGNING_PRIVATE_KEY_PEM: "-----BEGIN PRIVATE KEY-----\\nmock\\n-----END PRIVATE KEY-----",
      PROXY_COORDINATOR_SIGNING_KEY_ID: "key_coord_alpha_1",
    },
    () => {
      const cfg = loadConfig({ mode: "api" });
      assert.equal(cfg.federation?.enabled, true);
      assert.equal(cfg.federation?.coordinatorDid, "did:nooterra:coord_alpha");
      assert.deepEqual(cfg.federation?.trustedCoordinatorDids, [
        "did:nooterra:coord_alpha",
        "did:nooterra:coord_bravo",
        "did:nooterra:coord_charlie",
      ]);
      assert.equal(cfg.federation?.signing?.enabled, true);
      assert.equal(cfg.federation?.signing?.keyId, "key_coord_alpha_1");
      assert.equal(
        cfg.federation?.signing?.privateKeyPem,
        "-----BEGIN PRIVATE KEY-----\\nmock\\n-----END PRIVATE KEY-----"
      );
    }
  );
});

test("config federation: fails closed when trusted peers are configured without coordinator DID", () => {
  withFederationEnv(
    {
      PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS: "did:nooterra:coord_bravo",
    },
    () => {
      assert.throws(
        () => loadConfig({ mode: "api" }),
        /requires COORDINATOR_DID/i
      );
    }
  );
});

test("config federation: fails closed when signing key id is set without coordinator DID", () => {
  withFederationEnv(
    {
      PROXY_COORDINATOR_SIGNING_KEY_ID: "key_coord_alpha_1",
    },
    () => {
      assert.throws(
        () => loadConfig({ mode: "api" }),
        /requires COORDINATOR_DID/i
      );
    }
  );
});

test("config federation: fails closed when signing private key is set without signing key id", () => {
  withFederationEnv(
    {
      COORDINATOR_DID: "did:nooterra:coord_alpha",
      PROXY_COORDINATOR_SIGNING_PRIVATE_KEY_PEM: "-----BEGIN PRIVATE KEY-----\\nmock\\n-----END PRIVATE KEY-----",
    },
    () => {
      assert.throws(
        () => loadConfig({ mode: "api" }),
        /requires COORDINATOR_SIGNING_KEY_ID/i
      );
    }
  );
});

test("config federation: supports non-proxy signing env aliases", () => {
  withFederationEnv(
    {
      COORDINATOR_DID: "did:nooterra:coord_alpha",
      COORDINATOR_SIGNING_PRIVATE_KEY_PEM: "-----BEGIN PRIVATE KEY-----\\nmock\\n-----END PRIVATE KEY-----",
      COORDINATOR_SIGNING_KEY_ID: "key_coord_alpha_alias_1"
    },
    () => {
      const cfg = loadConfig({ mode: "api" });
      assert.equal(cfg.federation?.enabled, true);
      assert.equal(cfg.federation?.coordinatorDid, "did:nooterra:coord_alpha");
      assert.equal(cfg.federation?.signing?.enabled, true);
      assert.equal(cfg.federation?.signing?.keyId, "key_coord_alpha_alias_1");
      assert.equal(
        cfg.federation?.signing?.privateKeyPem,
        "-----BEGIN PRIVATE KEY-----\\nmock\\n-----END PRIVATE KEY-----"
      );
    }
  );
});

test("config federation: COORDINATOR_SIGNING_KEY alias is accepted for key id", () => {
  withFederationEnv(
    {
      COORDINATOR_DID: "did:nooterra:coord_alpha",
      COORDINATOR_SIGNING_PRIVATE_KEY_PEM: "-----BEGIN PRIVATE KEY-----\\nmock\\n-----END PRIVATE KEY-----",
      COORDINATOR_SIGNING_KEY: "key_coord_alpha_alias_2"
    },
    () => {
      const cfg = loadConfig({ mode: "api" });
      assert.equal(cfg.federation?.signing?.enabled, true);
      assert.equal(cfg.federation?.signing?.keyId, "key_coord_alpha_alias_2");
    }
  );
});

test("config federation: keeps signing disabled when only signing key id is configured", () => {
  withFederationEnv(
    {
      COORDINATOR_DID: "did:nooterra:coord_alpha",
      PROXY_COORDINATOR_SIGNING_KEY_ID: "key_coord_alpha_1",
    },
    () => {
      const cfg = loadConfig({ mode: "api" });
      assert.equal(cfg.federation?.enabled, true);
      assert.equal(cfg.federation?.coordinatorDid, "did:nooterra:coord_alpha");
      assert.equal(cfg.federation?.signing?.enabled, false);
      assert.equal(cfg.federation?.signing?.keyId, "key_coord_alpha_1");
      assert.equal(cfg.federation?.signing?.privateKeyPem, null);
    }
  );
});

test("config federation: coordinator DID takes precedence over proxy coordinator DID", () => {
  withFederationEnv(
    {
      COORDINATOR_DID: "did:nooterra:coord_alpha",
      PROXY_COORDINATOR_DID: "did:nooterra:coord_bravo",
      PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS: "did:nooterra:coord_charlie",
    },
    () => {
      const cfg = loadConfig({ mode: "api" });
      assert.equal(cfg.federation?.enabled, true);
      assert.equal(cfg.federation?.coordinatorDid, "did:nooterra:coord_alpha");
      assert.deepEqual(cfg.federation?.trustedCoordinatorDids, ["did:nooterra:coord_charlie"]);
    }
  );
});

test("config federation: configForLog excludes signing private key material", () => {
  withFederationEnv(
    {
      COORDINATOR_DID: "did:nooterra:coord_alpha",
      PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS: "did:nooterra:coord_bravo",
      PROXY_COORDINATOR_SIGNING_PRIVATE_KEY_PEM: "-----BEGIN PRIVATE KEY-----\\nmock\\n-----END PRIVATE KEY-----",
      PROXY_COORDINATOR_SIGNING_KEY_ID: "key_coord_alpha_1",
    },
    () => {
      const cfg = loadConfig({ mode: "api" });
      const redacted = configForLog(cfg);
      assert.equal(redacted.federation?.enabled, true);
      assert.equal(redacted.federation?.coordinatorDid, "did:nooterra:coord_alpha");
      assert.deepEqual(redacted.federation?.trustedCoordinatorDids, ["did:nooterra:coord_bravo"]);
      assert.equal(redacted.federation?.signing?.enabled, true);
      assert.equal(redacted.federation?.signing?.keyId, "key_coord_alpha_1");
      assert.equal(Object.prototype.hasOwnProperty.call(redacted.federation?.signing ?? {}, "privateKeyPem"), false);
    }
  );
});
