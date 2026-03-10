import test from "node:test";
import assert from "node:assert/strict";

import {
  buildActionWalletTrustedHostRecord,
  resolveActionWalletTrustedHostProfile,
  sanitizeActionWalletTrustedHostRecord
} from "../src/core/action-wallet-trusted-host.js";

test("action-wallet trusted host: resolves launch runtime aliases to canonical profiles", () => {
  assert.equal(resolveActionWalletTrustedHostProfile("mcp").runtime, "claude-desktop");
  assert.equal(resolveActionWalletTrustedHostProfile("claude").channel, "Claude MCP");
  assert.equal(resolveActionWalletTrustedHostProfile("openclaw").runtime, "openclaw");
});

test("action-wallet trusted host: builds deterministic sanitized registry entries without leaking secrets", () => {
  const trustedHost = buildActionWalletTrustedHostRecord(
    {
      runtime: "openclaw",
      hostId: "host_partner_openclaw",
      hostName: "Partner OpenClaw",
      callbackUrls: ["https://partner.example/callback", "https://partner.example/callback"],
      environment: "staging",
      authModel: {
        type: "client_secret",
        clientSecret: "super_secret_1234"
      }
    },
    { now: "2026-03-09T18:00:00.000Z" }
  );

  assert.equal(trustedHost.runtime, "openclaw");
  assert.deepEqual(trustedHost.callbackUrls, ["https://partner.example/callback"]);
  assert.equal(trustedHost.authModel.type, "client_secret");
  assert.equal(typeof trustedHost.authModel.clientSecretHash, "string");
  assert.equal(trustedHost.authModel.clientSecretLast4, "1234");

  const sanitized = sanitizeActionWalletTrustedHostRecord(trustedHost);
  assert.equal(sanitized.authModel.clientSecretConfigured, true);
  assert.equal(sanitized.authModel.clientSecretLast4, "1234");
  assert.equal("clientSecretHash" in sanitized.authModel, false);
});

test("action-wallet trusted host: fails closed on unsupported runtimes and insecure non-localhost callbacks", () => {
  assert.throws(
    () => buildActionWalletTrustedHostRecord({ runtime: "chatgpt" }, { now: "2026-03-09T18:00:00.000Z" }),
    /runtime must resolve to one of/
  );
  assert.throws(
    () =>
      buildActionWalletTrustedHostRecord(
        {
          runtime: "openclaw",
          callbackUrls: ["http://partner.example/callback"]
        },
        { now: "2026-03-09T18:00:00.000Z" }
      ),
    /must use https outside localhost/
  );
});

test("action-wallet trusted host: preserves configured client-secret metadata across updates without re-sending the raw secret", () => {
  const existingTrustedHost = buildActionWalletTrustedHostRecord(
    {
      runtime: "claude-desktop",
      hostId: "host_partner_claude",
      authModel: {
        type: "client_secret",
        clientSecret: "super_secret_1234"
      }
    },
    { now: "2026-03-09T18:00:00.000Z" }
  );

  const updatedTrustedHost = buildActionWalletTrustedHostRecord(
    {
      runtime: "claude-desktop",
      hostId: "host_partner_claude",
      callbackUrls: ["https://partner.example/callback"]
    },
    {
      now: "2026-03-09T18:05:00.000Z",
      existing: {
        ...existingTrustedHost,
        authModel: {
          ...existingTrustedHost.authModel,
          keyId: "sk_test_host_1",
          lastIssuedAt: "2026-03-09T18:04:00.000Z"
        }
      }
    }
  );

  const sanitized = sanitizeActionWalletTrustedHostRecord(updatedTrustedHost);
  assert.equal(updatedTrustedHost.authModel.type, "client_secret");
  assert.equal(updatedTrustedHost.authModel.clientSecretConfigured, true);
  assert.equal(updatedTrustedHost.authModel.clientSecretLast4, "1234");
  assert.equal(sanitized.authModel.keyId, "sk_test_host_1");
  assert.equal(sanitized.authModel.lastIssuedAt, "2026-03-09T18:04:00.000Z");
});
