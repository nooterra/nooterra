import test from "node:test";
import assert from "node:assert/strict";

import { buildCoinbaseHostedUrls } from "../src/core/wallet-funding-coinbase.js";

test("buildCoinbaseHostedUrls: returns card+bank urls when token API succeeds", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ token: "tok_123" });
      }
    };
  };

  const out = await buildCoinbaseHostedUrls({
    walletAddress: "0xabc",
    blockchain: "BASE",
    clientIp: "127.0.0.1",
    config: {
      apiKeyId: "organizations/org/apiKeys/key",
      apiKeySecret: "-----BEGIN EC PRIVATE KEY-----\\nabc\\n-----END EC PRIVATE KEY-----\\n",
      destinationNetwork: "base",
      purchaseAsset: "USDC",
      tokenUrl: "https://api.developer.coinbase.com/onramp/v1/token",
      payBaseUrl: "https://pay.coinbase.com/buy/select-asset"
    },
    generateJwtImpl: async () => "jwt_mock_123",
    fetchImpl
  });

  assert.equal(out.provider, "coinbase");
  assert.equal(out.preferredMethod, "card");
  assert.ok(out.card);
  assert.ok(out.bank);
  assert.equal(calls.length, 1);
  const posted = JSON.parse(String(calls[0].init.body ?? "{}"));
  assert.equal(posted.addresses[0].address, "0xabc");
  assert.equal(posted.assets[0], "USDC");

  const card = new URL(out.card);
  assert.equal(card.origin, "https://pay.coinbase.com");
  assert.equal(card.searchParams.get("sessionToken"), "tok_123");
  assert.equal(card.searchParams.get("defaultNetwork"), "base");
  assert.equal(card.searchParams.get("defaultAsset"), "USDC");
});

test("buildCoinbaseHostedUrls: reports unavailable when network unsupported", async () => {
  const out = await buildCoinbaseHostedUrls({
    walletAddress: "0xabc",
    blockchain: "BASE-SEPOLIA",
    config: {
      apiKeyId: "organizations/org/apiKeys/key",
      apiKeySecret: "-----BEGIN EC PRIVATE KEY-----\\nabc\\n-----END EC PRIVATE KEY-----\\n"
    },
    generateJwtImpl: async () => "jwt_mock_123",
    fetchImpl: async () => {
      throw new Error("should not call fetch");
    }
  });

  assert.equal(out.card, null);
  assert.equal(out.bank, null);
  assert.equal(out.unavailableReason, "UNSUPPORTED_NETWORK");
});
