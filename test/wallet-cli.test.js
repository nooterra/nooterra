import test from "node:test";
import assert from "node:assert/strict";

import { parseArgs, runWalletCli } from "../scripts/wallet/cli.mjs";

function walletBootstrapFixture({ spendUsdc = 0 } = {}) {
  return {
    ok: true,
    walletBootstrap: {
      provider: "circle",
      mode: "sandbox",
      blockchain: "BASE-SEPOLIA",
      tokenIdUsdc: "token_usdc",
      wallets: {
        spend: { walletId: "wid_spend", address: "0xspend" },
        escrow: { walletId: "wid_escrow", address: "0xescrow" }
      },
      balances: {
        asOf: "2026-02-22T00:00:00.000Z",
        spend: { usdcAmount: spendUsdc, usdcAmountText: String(spendUsdc), tokenId: "token_usdc", symbol: "USDC" },
        escrow: { usdcAmount: 0, usdcAmountText: "0", tokenId: "token_usdc", symbol: "USDC" }
      },
      faucetEnabled: false,
      faucetResults: []
    }
  };
}

function walletFundingPlanFixture() {
  return {
    ok: true,
    schemaVersion: "MagicLinkWalletFunding.v1",
    tenantId: "tenant_demo",
    recommendedOptionId: "card_bank",
    options: [
      {
        optionId: "card_bank",
        available: true,
        preferredMethod: "card",
        methods: ["card", "bank"],
        urls: {
          card: "https://pay.example.com/topup?tenant=tenant_demo&method=card",
          bank: "https://pay.example.com/topup?tenant=tenant_demo&method=bank"
        }
      },
      {
        optionId: "transfer",
        available: true,
        transfer: {
          type: "transfer",
          method: "transfer",
          blockchain: "BASE-SEPOLIA",
          token: "USDC",
          tokenIdUsdc: "token_usdc",
          walletId: "wid_spend",
          address: "0xspend"
        }
      }
    ],
    session: null
  };
}

function walletFundingTransferFixture() {
  return {
    ...walletFundingPlanFixture(),
    session: {
      type: "transfer",
      method: "transfer",
      blockchain: "BASE-SEPOLIA",
      token: "USDC",
      tokenIdUsdc: "token_usdc",
      walletId: "wid_spend",
      address: "0xspend"
    }
  };
}

function walletFundingCardFixture() {
  return {
    ...walletFundingPlanFixture(),
    session: {
      type: "hosted",
      method: "card",
      url: "https://pay.example.com/topup?tenant=tenant_demo&method=card"
    }
  };
}

test("wallet cli: parseArgs keeps fund method unset for guided selection", () => {
  const parsed = parseArgs(["fund"]);
  assert.equal(parsed.command, "fund");
  assert.equal(parsed.method, null);
  assert.equal(parsed.format, "text");
});

test("wallet cli: parseArgs supports balance watch flags", () => {
  const parsed = parseArgs(["balance", "--watch", "--min-usdc", "2.5", "--interval-seconds", "1", "--timeout-seconds", "30"]);
  assert.equal(parsed.command, "balance");
  assert.equal(parsed.watch, true);
  assert.equal(parsed.minUsdc, 2.5);
  assert.equal(parsed.intervalSeconds, 1);
  assert.equal(parsed.timeoutSeconds, 30);
});

test("wallet cli: status uses session cookie auth and requests balances without faucet side effects", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 201,
      async text() {
        return JSON.stringify(walletBootstrapFixture({ spendUsdc: 0.5 }));
      }
    };
  };

  const chunks = [];
  const result = await runWalletCli({
    argv: ["status", "--format", "json"],
    fetchImpl,
    readSavedSessionImpl: async () => ({
      baseUrl: "https://api.nooterra.work",
      tenantId: "tenant_demo",
      cookie: "nooterra_session=abc123"
    }),
    stdout: { write: (chunk) => chunks.push(String(chunk)) }
  });

  assert.equal(result.ok, true);
  assert.equal(result.tenantId, "tenant_demo");
  assert.equal(result.wallet.spendWallet.walletId, "wid_spend");
  assert.equal(result.wallet.spendWallet.usdcAmount, 0.5);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers.cookie, "nooterra_session=abc123");
  const posted = JSON.parse(String(calls[0].init.body ?? "{}"));
  assert.equal(posted.provider, "circle");
  assert.equal(posted.circle.faucet, false);
  assert.equal(posted.circle.includeBalances, true);
  assert.match(chunks.join(""), /NooterraWalletStatus\.v1/);
});

test("wallet cli: fund transfer returns spend address via wallet-funding backend", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/onboarding/wallet-funding")) {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify(walletFundingTransferFixture());
        }
      };
    }
    throw new Error(`unexpected url ${url}`);
  };

  const result = await runWalletCli({
    argv: ["fund", "--method", "transfer", "--format", "json"],
    fetchImpl,
    readSavedSessionImpl: async () => ({
      baseUrl: "https://api.nooterra.work",
      tenantId: "tenant_demo",
      cookie: "nooterra_session=abc123"
    }),
    stdout: { write() {} }
  });

  assert.equal(result.ok, true);
  assert.equal(result.method, "transfer");
  assert.equal(result.transfer.address, "0xspend");
  assert.equal(result.transfer.token, "USDC");
  assert.equal(calls.length, 1);
  const posted = JSON.parse(String(calls[0].init.body ?? "{}"));
  assert.equal(posted.method, "transfer");
});

test("wallet cli: fund card with --open uses backend-provided hosted URL", async () => {
  let openedUrl = null;
  const fetchImpl = async (url) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/onboarding/wallet-funding")) {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify(walletFundingCardFixture());
        }
      };
    }
    throw new Error(`unexpected url ${url}`);
  };

  const result = await runWalletCli({
    argv: ["fund", "--method", "card", "--open", "--format", "json"],
    fetchImpl,
    readSavedSessionImpl: async () => ({
      baseUrl: "https://api.nooterra.work",
      tenantId: "tenant_demo",
      cookie: "nooterra_session=abc123"
    }),
    openInBrowserImpl: (url) => {
      openedUrl = url;
      return { ok: true };
    },
    stdout: { write() {} }
  });

  assert.equal(result.ok, true);
  assert.equal(result.method, "card");
  assert.equal(result.hosted.opened, true);
  assert.equal(openedUrl, "https://pay.example.com/topup?tenant=tenant_demo&method=card");
});

test("wallet cli: fund without method chooses recommended method in non-interactive mode", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    const body = JSON.parse(String(init.body ?? "{}"));
    if (body.method === "card") {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify(walletFundingCardFixture());
        }
      };
    }
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify(walletFundingPlanFixture());
      }
    };
  };

  const result = await runWalletCli({
    argv: ["fund", "--non-interactive", "--format", "json"],
    fetchImpl,
    readSavedSessionImpl: async () => ({
      baseUrl: "https://api.nooterra.work",
      tenantId: "tenant_demo",
      cookie: "nooterra_session=abc123"
    }),
    stdout: { write() {} }
  });

  assert.equal(result.ok, true);
  assert.equal(result.method, "card");
  assert.equal(calls.length, 2);
});

test("wallet cli: balance watch waits until threshold is reached", async () => {
  const sequence = [0.2, 0.9, 1.1];
  let idx = 0;
  const fetchImpl = async () => ({
    ok: true,
    status: 201,
    async text() {
      const value = sequence[Math.min(idx, sequence.length - 1)];
      idx += 1;
      return JSON.stringify(walletBootstrapFixture({ spendUsdc: value }));
    }
  });

  const result = await runWalletCli({
    argv: ["balance", "--watch", "--min-usdc", "1", "--interval-seconds", "0", "--timeout-seconds", "2", "--format", "json"],
    fetchImpl,
    readSavedSessionImpl: async () => ({
      baseUrl: "https://api.nooterra.work",
      tenantId: "tenant_demo",
      cookie: "nooterra_session=abc123"
    }),
    stdout: { write() {} }
  });

  assert.equal(result.ok, true);
  assert.equal(result.watch.enabled, true);
  assert.equal(result.watch.satisfied, true);
  assert.ok(result.watch.attempts >= 2);
  assert.equal(result.wallet.spendWallet.usdcAmount, 1.1);
});

