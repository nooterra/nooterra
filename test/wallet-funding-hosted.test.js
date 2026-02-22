import test from "node:test";
import assert from "node:assert/strict";

import { buildOnramperHostedUrls } from "../src/core/wallet-funding-hosted.js";

test("buildOnramperHostedUrls: returns card+bank URLs with expected defaults", () => {
  const out = buildOnramperHostedUrls({
    walletAddress: "0xabc",
    blockchain: "BASE-SEPOLIA",
    config: {
      apiKey: "onr_test",
      baseUrl: "https://buy.onramper.com",
      defaultCrypto: "usdc",
      defaultFiat: "usd",
      onlyCryptos: "usdc",
      onlyCryptoNetworks: "base_sepolia",
      networkId: "base-sepolia",
      signingSecret: "secret123"
    }
  });

  assert.equal(out.provider, "onramper");
  assert.equal(out.preferredMethod, "card");
  assert.ok(out.card);
  assert.ok(out.bank);

  const card = new URL(out.card);
  assert.equal(card.origin, "https://buy.onramper.com");
  assert.equal(card.searchParams.get("apiKey"), "onr_test");
  assert.equal(card.searchParams.get("mode"), "buy");
  assert.equal(card.searchParams.get("defaultPaymentMethod"), "creditcard");
  assert.equal(card.searchParams.get("defaultCrypto"), "usdc");
  assert.equal(card.searchParams.get("defaultFiat"), "usd");
  assert.equal(card.searchParams.get("networkWallets"), "base_sepolia:0xabc");
  assert.ok(card.searchParams.get("signature"));

  const bank = new URL(out.bank);
  assert.equal(bank.searchParams.get("defaultPaymentMethod"), "banktransfer");
});

test("buildOnramperHostedUrls: omits sensitive params when signing secret is missing", () => {
  const out = buildOnramperHostedUrls({
    walletAddress: "0xabc",
    blockchain: "BASE",
    config: {
      apiKey: "onr_test",
      baseUrl: "https://buy.onramper.com"
    }
  });

  const card = new URL(String(out.card));
  assert.equal(card.searchParams.get("networkWallets"), null);
  assert.equal(card.searchParams.get("signature"), null);
});

test("buildOnramperHostedUrls: can return card-only for requested method", () => {
  const out = buildOnramperHostedUrls({
    requestedMethod: "card",
    walletAddress: "0xabc",
    config: {
      apiKey: "onr_test"
    }
  });

  assert.ok(out.card);
  assert.equal(out.bank, null);
  assert.equal(out.preferredMethod, "card");
});

test("buildOnramperHostedUrls: returns unavailable when api key missing", () => {
  const out = buildOnramperHostedUrls({
    walletAddress: "0xabc",
    config: {
      apiKey: ""
    }
  });

  assert.equal(out.card, null);
  assert.equal(out.bank, null);
  assert.equal(out.preferredMethod, null);
});
