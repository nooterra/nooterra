#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { defaultSessionPath, readSavedSession } from "../setup/session-store.mjs";

const COMMANDS = new Set(["status", "fund", "balance"]);
const FUND_METHODS = new Set(["card", "bank", "transfer", "faucet"]);
const FORMAT_OPTIONS = new Set(["text", "json"]);

function usage() {
  const text = [
    "usage:",
    "  settld wallet status [--base-url <url>] [--tenant-id <id>] [--session-file <path>] [--cookie <cookie>] [--magic-link-api-key <key>] [--format text|json] [--json-out <path>]",
    "  settld wallet fund [--method card|bank|transfer|faucet] [--open] [--hosted-url <url>] [--non-interactive] [--base-url <url>] [--tenant-id <id>] [--session-file <path>] [--cookie <cookie>] [--magic-link-api-key <key>] [--format text|json] [--json-out <path>]",
    "  settld wallet balance [--watch] [--min-usdc <amount>] [--interval-seconds <n>] [--timeout-seconds <n>] [--base-url <url>] [--tenant-id <id>] [--session-file <path>] [--cookie <cookie>] [--magic-link-api-key <key>] [--format text|json] [--json-out <path>]",
    "",
    "flags:",
    "  --method <name>                 Funding method for `fund`",
    "  --open                          Open hosted link in browser (card/bank)",
    "  --hosted-url <url>              Override hosted funding URL (card/bank)",
    "  --non-interactive               Disable prompts for method selection",
    "  --watch                         Poll balance until funded or timeout",
    "  --min-usdc <amount>             Target spend wallet USDC (default watch target: >0)",
    "  --interval-seconds <n>          Poll interval for --watch (default: 5)",
    "  --timeout-seconds <n>           Watch timeout (default: 180)",
    "  --base-url <url>                Settld onboarding base URL",
    "  --tenant-id <id>                Tenant ID",
    "  --session-file <path>           Saved session path (default: ~/.settld/session.json)",
    "  --cookie <cookie>               Buyer session cookie override",
    "  --magic-link-api-key <key>      Control-plane API key (admin mode fallback)",
    "  --bootstrap-api-key <key>       Alias for --magic-link-api-key",
    "  --x-api-key <key>               Alias for --magic-link-api-key",
    "  --provider <name>               Wallet provider (default: circle)",
    "  --circle-mode <mode>            Circle mode hint: auto|sandbox|production (default: auto)",
    "  --circle-base-url <url>         Circle base URL override",
    "  --circle-blockchain <name>      Circle blockchain override",
    "  --spend-wallet-id <id>          Circle spend wallet ID hint",
    "  --escrow-wallet-id <id>         Circle escrow wallet ID hint",
    "  --token-id-usdc <id>            Circle USDC token ID hint",
    "  --format <text|json>            Output format (default: text)",
    "  --json-out <path>               Write JSON payload to file",
    "  --help                          Show this help"
  ].join("\n");
  process.stderr.write(`${text}\n`);
}

function fail(message) {
  throw new Error(String(message ?? "wallet command failed"));
}

function readArgValue(argv, index, rawArg) {
  const arg = String(rawArg ?? "");
  const eq = arg.indexOf("=");
  if (eq >= 0) return { value: arg.slice(eq + 1), nextIndex: index };
  return { value: String(argv[index + 1] ?? ""), nextIndex: index + 1 };
}

function normalizeHttpUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return parsed.toString().replace(/\/+$/, "");
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function safeTrim(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseNonNegativeNumber(value, { field }) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) fail(`${field} must be a non-negative number`);
  return num;
}

function parsePositiveNumber(value, { field }) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) fail(`${field} must be a positive number`);
  return num;
}

function usdcAmountNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : null;
}

export function parseArgs(argv) {
  const out = {
    command: String(argv[0] ?? "").trim() || null,
    method: null,
    open: false,
    hostedUrl: null,
    nonInteractive: false,
    watch: false,
    minUsdc: null,
    intervalSeconds: 5,
    timeoutSeconds: 180,
    baseUrl: null,
    tenantId: null,
    sessionFile: defaultSessionPath(),
    cookie: null,
    magicLinkApiKey: null,
    provider: "circle",
    circleMode: "auto",
    circleBaseUrl: null,
    circleBlockchain: null,
    spendWalletId: null,
    escrowWalletId: null,
    tokenIdUsdc: null,
    format: "text",
    jsonOut: null,
    help: false
  };

  for (let i = 1; i < argv.length; i += 1) {
    const arg = String(argv[i] ?? "");
    if (!arg) continue;

    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg === "--open") {
      out.open = true;
      continue;
    }
    if (arg === "--non-interactive" || arg === "--yes") {
      out.nonInteractive = true;
      continue;
    }
    if (arg === "--watch") {
      out.watch = true;
      continue;
    }
    if (arg === "--method" || arg.startsWith("--method=")) {
      const parsed = readArgValue(argv, i, arg);
      out.method = String(parsed.value ?? "").trim().toLowerCase();
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--hosted-url" || arg.startsWith("--hosted-url=")) {
      const parsed = readArgValue(argv, i, arg);
      out.hostedUrl = parsed.value;
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--min-usdc" || arg.startsWith("--min-usdc=")) {
      const parsed = readArgValue(argv, i, arg);
      out.minUsdc = parsed.value;
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--interval-seconds" || arg.startsWith("--interval-seconds=")) {
      const parsed = readArgValue(argv, i, arg);
      out.intervalSeconds = parsed.value;
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--timeout-seconds" || arg.startsWith("--timeout-seconds=")) {
      const parsed = readArgValue(argv, i, arg);
      out.timeoutSeconds = parsed.value;
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--base-url" || arg.startsWith("--base-url=")) {
      const parsed = readArgValue(argv, i, arg);
      out.baseUrl = parsed.value;
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--tenant-id" || arg.startsWith("--tenant-id=")) {
      const parsed = readArgValue(argv, i, arg);
      out.tenantId = parsed.value;
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--session-file" || arg.startsWith("--session-file=")) {
      const parsed = readArgValue(argv, i, arg);
      out.sessionFile = parsed.value;
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--cookie" || arg.startsWith("--cookie=")) {
      const parsed = readArgValue(argv, i, arg);
      out.cookie = parsed.value;
      i = parsed.nextIndex;
      continue;
    }
    if (
      arg === "--magic-link-api-key" ||
      arg === "--bootstrap-api-key" ||
      arg === "--x-api-key" ||
      arg.startsWith("--magic-link-api-key=") ||
      arg.startsWith("--bootstrap-api-key=") ||
      arg.startsWith("--x-api-key=")
    ) {
      const parsed = readArgValue(argv, i, arg);
      out.magicLinkApiKey = parsed.value;
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--provider" || arg.startsWith("--provider=")) {
      const parsed = readArgValue(argv, i, arg);
      out.provider = String(parsed.value ?? "").trim().toLowerCase();
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--circle-mode" || arg.startsWith("--circle-mode=")) {
      const parsed = readArgValue(argv, i, arg);
      out.circleMode = String(parsed.value ?? "").trim().toLowerCase();
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--circle-base-url" || arg.startsWith("--circle-base-url=")) {
      const parsed = readArgValue(argv, i, arg);
      out.circleBaseUrl = parsed.value;
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--circle-blockchain" || arg.startsWith("--circle-blockchain=")) {
      const parsed = readArgValue(argv, i, arg);
      out.circleBlockchain = parsed.value;
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--spend-wallet-id" || arg.startsWith("--spend-wallet-id=")) {
      const parsed = readArgValue(argv, i, arg);
      out.spendWalletId = parsed.value;
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--escrow-wallet-id" || arg.startsWith("--escrow-wallet-id=")) {
      const parsed = readArgValue(argv, i, arg);
      out.escrowWalletId = parsed.value;
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--token-id-usdc" || arg.startsWith("--token-id-usdc=")) {
      const parsed = readArgValue(argv, i, arg);
      out.tokenIdUsdc = parsed.value;
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--format" || arg.startsWith("--format=")) {
      const parsed = readArgValue(argv, i, arg);
      out.format = String(parsed.value ?? "").trim().toLowerCase();
      i = parsed.nextIndex;
      continue;
    }
    if (arg === "--json-out" || arg.startsWith("--json-out=")) {
      const parsed = readArgValue(argv, i, arg);
      out.jsonOut = parsed.value;
      i = parsed.nextIndex;
      continue;
    }
    fail(`unknown argument: ${arg}`);
  }

  if (!out.command || out.command === "--help" || out.command === "-h") {
    out.help = true;
    return out;
  }
  if (!COMMANDS.has(out.command)) fail(`unsupported wallet command: ${out.command}`);
  if (!FORMAT_OPTIONS.has(out.format)) fail("--format must be text|json");
  if (out.command !== "fund" && out.method !== null) fail("--method only applies to `settld wallet fund`");
  if (out.command === "fund" && out.method !== null && !FUND_METHODS.has(out.method)) {
    fail("--method must be one of: card|bank|transfer|faucet");
  }
  if (out.command !== "fund" && out.open) fail("--open only applies to `settld wallet fund`");
  if (out.command !== "fund" && out.hostedUrl) fail("--hosted-url only applies to `settld wallet fund`");
  if (out.command !== "fund" && out.nonInteractive) fail("--non-interactive only applies to `settld wallet fund`");
  if (out.command !== "balance" && out.watch) fail("--watch only applies to `settld wallet balance`");
  if (out.command !== "balance" && out.minUsdc !== null) fail("--min-usdc only applies to `settld wallet balance`");
  if (out.command !== "balance" && out.intervalSeconds !== 5) fail("--interval-seconds only applies to `settld wallet balance`");
  if (out.command !== "balance" && out.timeoutSeconds !== 180) fail("--timeout-seconds only applies to `settld wallet balance`");
  if (out.command === "balance") {
    out.intervalSeconds = parseNonNegativeNumber(out.intervalSeconds, { field: "--interval-seconds" });
    out.timeoutSeconds = parsePositiveNumber(out.timeoutSeconds, { field: "--timeout-seconds" });
    if (out.minUsdc !== null && String(out.minUsdc).trim() !== "") {
      out.minUsdc = parseNonNegativeNumber(out.minUsdc, { field: "--min-usdc" });
    } else {
      out.minUsdc = null;
    }
  }
  out.sessionFile = path.resolve(process.cwd(), String(out.sessionFile ?? "").trim() || defaultSessionPath());
  if (out.jsonOut) out.jsonOut = path.resolve(process.cwd(), String(out.jsonOut));
  return out;
}

async function resolveRuntimeConfig({
  args,
  env = process.env,
  readSavedSessionImpl = readSavedSession
} = {}) {
  const saved = await readSavedSessionImpl({ sessionPath: args.sessionFile });
  const baseUrl = normalizeHttpUrl(args.baseUrl ?? env.SETTLD_BASE_URL ?? saved?.baseUrl ?? "https://api.settld.work");
  if (!baseUrl) fail("base URL must be a valid http(s) URL");

  const tenantId = safeTrim(args.tenantId ?? env.SETTLD_TENANT_ID ?? saved?.tenantId ?? "");
  if (!tenantId) fail("tenant ID is required (pass --tenant-id or run `settld login` first)");

  const cookie = safeTrim(args.cookie ?? env.SETTLD_SESSION_COOKIE ?? saved?.cookie ?? "");
  const magicLinkApiKey = safeTrim(
    args.magicLinkApiKey ??
      env.SETTLD_MAGIC_LINK_API_KEY ??
      env.SETTLD_BOOTSTRAP_API_KEY ??
      env.SETTLD_SETUP_API_KEY ??
      ""
  );
  if (!cookie && !magicLinkApiKey) {
    fail("auth required: pass --cookie/--magic-link-api-key or run `settld login` first");
  }

  return {
    baseUrl,
    tenantId,
    cookie: cookie || null,
    magicLinkApiKey: magicLinkApiKey || null
  };
}

function buildCirclePayload(args, { faucet = false, includeBalances = false } = {}) {
  return {
    mode: String(args.circleMode ?? "auto").trim() || "auto",
    faucet: Boolean(faucet),
    includeBalances: Boolean(includeBalances),
    ...(safeTrim(args.circleBaseUrl) ? { baseUrl: safeTrim(args.circleBaseUrl) } : {}),
    ...(safeTrim(args.circleBlockchain) ? { blockchain: safeTrim(args.circleBlockchain) } : {}),
    ...(safeTrim(args.spendWalletId) ? { spendWalletId: safeTrim(args.spendWalletId) } : {}),
    ...(safeTrim(args.escrowWalletId) ? { escrowWalletId: safeTrim(args.escrowWalletId) } : {}),
    ...(safeTrim(args.tokenIdUsdc) ? { tokenIdUsdc: safeTrim(args.tokenIdUsdc) } : {})
  };
}

function buildWalletBootstrapBody({ args, faucet = false, includeBalances = false } = {}) {
  const provider = String(args.provider ?? "circle").trim() || "circle";
  return {
    provider,
    ...(provider === "circle" ? { circle: buildCirclePayload(args, { faucet, includeBalances }) } : {})
  };
}

async function requestJson({ url, method = "GET", body = undefined, cookie = null, magicLinkApiKey = null, fetchImpl = fetch } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  if (magicLinkApiKey) headers["x-api-key"] = magicLinkApiKey;
  const res = await fetchImpl(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { res, json, text };
}

async function requestWalletBootstrap({
  baseUrl,
  tenantId,
  cookie = null,
  magicLinkApiKey = null,
  body,
  fetchImpl = fetch
} = {}) {
  const url = new URL(`/v1/tenants/${encodeURIComponent(tenantId)}/onboarding/wallet-bootstrap`, `${baseUrl}/`).toString();
  const { res, json, text } = await requestJson({
    url,
    method: "POST",
    body,
    cookie,
    magicLinkApiKey,
    fetchImpl
  });
  if (!res.ok) {
    const message =
      json && typeof json === "object"
        ? json?.message ?? json?.error ?? `HTTP ${res.status}`
        : text || `HTTP ${res.status}`;
    fail(`wallet bootstrap failed (${res.status}): ${String(message)}`);
  }
  const bootstrap = json?.walletBootstrap;
  if (!isPlainObject(bootstrap)) fail("wallet bootstrap response missing walletBootstrap object");
  return bootstrap;
}

async function requestWalletFundingPlan({
  baseUrl,
  tenantId,
  cookie = null,
  magicLinkApiKey = null,
  body,
  fetchImpl = fetch
} = {}) {
  const url = new URL(`/v1/tenants/${encodeURIComponent(tenantId)}/onboarding/wallet-funding`, `${baseUrl}/`).toString();
  const { res, json, text } = await requestJson({
    url,
    method: "POST",
    body,
    cookie,
    magicLinkApiKey,
    fetchImpl
  });
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    const message =
      json && typeof json === "object"
        ? json?.message ?? json?.error ?? `HTTP ${res.status}`
        : text || `HTTP ${res.status}`;
    fail(`wallet funding request failed (${res.status}): ${String(message)}`);
  }
  if (!isPlainObject(json)) fail("wallet funding response must be an object");
  return json;
}

function extractWalletSnapshot(walletBootstrap) {
  const root = isPlainObject(walletBootstrap) ? walletBootstrap : {};
  const spend = isPlainObject(root.wallets?.spend) ? root.wallets.spend : {};
  const escrow = isPlainObject(root.wallets?.escrow) ? root.wallets.escrow : {};
  const balances = isPlainObject(root.balances) ? root.balances : {};
  const spendBalance = isPlainObject(balances.spend) ? balances.spend : {};
  const escrowBalance = isPlainObject(balances.escrow) ? balances.escrow : {};
  return {
    provider: String(root.provider ?? "circle"),
    mode: safeTrim(root.mode) || null,
    baseUrl: safeTrim(root.baseUrl) || null,
    blockchain: safeTrim(root.blockchain) || null,
    tokenIdUsdc: safeTrim(root.tokenIdUsdc) || null,
    spendWallet: {
      walletId: safeTrim(spend.walletId) || null,
      address: safeTrim(spend.address) || null,
      usdcAmount: usdcAmountNumber(spendBalance.usdcAmount),
      usdcAmountText: safeTrim(spendBalance.usdcAmountText) || null
    },
    escrowWallet: {
      walletId: safeTrim(escrow.walletId) || null,
      address: safeTrim(escrow.address) || null,
      usdcAmount: usdcAmountNumber(escrowBalance.usdcAmount),
      usdcAmountText: safeTrim(escrowBalance.usdcAmountText) || null
    },
    balances: {
      asOf: safeTrim(balances.asOf) || null,
      error: safeTrim(balances.error) || null
    },
    faucetEnabled: Boolean(root.faucetEnabled),
    faucetResults: Array.isArray(root.faucetResults) ? root.faucetResults : []
  };
}

export function openInBrowser(url) {
  const target = String(url ?? "").trim();
  if (!target) return { ok: false, message: "missing URL" };
  const platform = process.platform;
  let result;
  if (platform === "darwin") {
    result = spawnSync("open", [target], { stdio: "ignore" });
  } else if (platform === "win32") {
    result = spawnSync("cmd", ["/c", "start", "", target], { stdio: "ignore" });
  } else {
    result = spawnSync("xdg-open", [target], { stdio: "ignore" });
  }
  if (result.error) {
    return { ok: false, message: result.error.message || "failed to open browser" };
  }
  if (typeof result.status === "number" && result.status !== 0) {
    return { ok: false, message: `open command exited with ${result.status}` };
  }
  return { ok: true };
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function deriveFundingChoiceFromPlan(plan) {
  const optionRows = Array.isArray(plan?.options) ? plan.options : [];
  const cardBank = optionRows.find((row) => String(row?.optionId ?? "") === "card_bank");
  const transfer = optionRows.find((row) => String(row?.optionId ?? "") === "transfer");
  return {
    cardBankAvailable: Boolean(cardBank?.available),
    transferAvailable: Boolean(transfer?.available ?? true),
    recommendedOptionId: safeTrim(plan?.recommendedOptionId) || (cardBank?.available ? "card_bank" : "transfer"),
    preferredHostedMethod: safeTrim(cardBank?.preferredMethod) || "card"
  };
}

async function promptFundMethod({
  plan,
  stdin = process.stdin,
  stdout = process.stdout
} = {}) {
  const derived = deriveFundingChoiceFromPlan(plan);
  if (!stdin?.isTTY || !stdout?.isTTY) {
    return derived.recommendedOptionId === "card_bank" ? derived.preferredHostedMethod : "transfer";
  }

  const rows = [];
  if (derived.cardBankAvailable) rows.push({ id: "card_bank", label: "Card/Bank top-up (Recommended)" });
  if (derived.transferAvailable) rows.push({ id: "transfer", label: "USDC transfer" });
  if (rows.length === 0) fail("no available funding options");
  if (rows.length === 1) return rows[0].id === "card_bank" ? derived.preferredHostedMethod : "transfer";

  stdout.write("Select funding method\n");
  stdout.write("=====================\n");
  rows.forEach((row, index) => {
    stdout.write(`${index + 1}) ${row.label}\n`);
  });
  const defaultChoice = derived.recommendedOptionId === "card_bank" ? "1" : "2";
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answerRaw = String(await rl.question(`Choose [${defaultChoice}]: `) ?? "").trim();
    const answer = answerRaw || defaultChoice;
    const selected = rows[Number(answer) - 1] ?? rows.find((row) => row.id === answer) ?? null;
    if (!selected) return derived.recommendedOptionId === "card_bank" ? derived.preferredHostedMethod : "transfer";
    return selected.id === "card_bank" ? derived.preferredHostedMethod : "transfer";
  } finally {
    rl.close();
  }
}

async function readWalletSnapshot({ args, runtime, fetchImpl, includeBalances = false, faucet = false } = {}) {
  const walletBootstrap = await requestWalletBootstrap({
    baseUrl: runtime.baseUrl,
    tenantId: runtime.tenantId,
    cookie: runtime.cookie,
    magicLinkApiKey: runtime.magicLinkApiKey,
    body: buildWalletBootstrapBody({ args, faucet, includeBalances }),
    fetchImpl
  });
  return extractWalletSnapshot(walletBootstrap);
}

async function runBalance({
  args,
  runtime,
  fetchImpl
} = {}) {
  if (!args.watch) {
    const wallet = await readWalletSnapshot({ args, runtime, fetchImpl, includeBalances: true, faucet: false });
    return {
      ok: true,
      schemaVersion: "SettldWalletBalance.v1",
      baseUrl: runtime.baseUrl,
      tenantId: runtime.tenantId,
      watch: null,
      wallet
    };
  }

  const target = args.minUsdc === null ? 0.000001 : Number(args.minUsdc);
  const deadline = Date.now() + Math.round(args.timeoutSeconds * 1000);
  const intervalMs = Math.round(Number(args.intervalSeconds) * 1000);
  const samples = [];
  let latest = null;
  let satisfied = false;

  while (Date.now() <= deadline) {
    latest = await readWalletSnapshot({ args, runtime, fetchImpl, includeBalances: true, faucet: false });
    const amount = usdcAmountNumber(latest?.spendWallet?.usdcAmount);
    samples.push({
      at: new Date().toISOString(),
      spendUsdc: amount
    });
    if (amount !== null && amount >= target) {
      satisfied = true;
      break;
    }
    if (Date.now() >= deadline) break;
    if (intervalMs > 0) await sleep(intervalMs);
  }

  return {
    ok: satisfied,
    schemaVersion: "SettldWalletBalance.v1",
    baseUrl: runtime.baseUrl,
    tenantId: runtime.tenantId,
    watch: {
      enabled: true,
      targetSpendUsdc: target,
      intervalSeconds: Number(args.intervalSeconds),
      timeoutSeconds: Number(args.timeoutSeconds),
      attempts: samples.length,
      satisfied
    },
    wallet: latest,
    samples
  };
}

function renderText({ payload, args }) {
  if (args.command === "status") {
    const wallet = payload.wallet ?? {};
    const spend = wallet.spendWallet ?? {};
    const escrow = wallet.escrowWallet ?? {};
    const lines = [
      "Wallet status",
      "=============",
      `Tenant: ${payload.tenantId}`,
      `Provider: ${wallet.provider ?? "unknown"} (${wallet.mode ?? "unknown"})`,
      `Network: ${wallet.blockchain ?? "unknown"}`,
      `USDC token: ${wallet.tokenIdUsdc ?? "n/a"}`,
      `Spend wallet: ${spend.walletId ?? "n/a"} (${spend.address ?? "n/a"})`,
      `Escrow wallet: ${escrow.walletId ?? "n/a"} (${escrow.address ?? "n/a"})`
    ];
    if (spend.usdcAmount !== null) lines.push(`Spend USDC balance: ${spend.usdcAmount}`);
    if (escrow.usdcAmount !== null) lines.push(`Escrow USDC balance: ${escrow.usdcAmount}`);
    if (wallet.balances?.error) lines.push(`Balance warning: ${wallet.balances.error}`);
    return `${lines.join("\n")}\n`;
  }

  if (args.command === "balance") {
    const wallet = payload.wallet ?? {};
    const spend = wallet.spendWallet ?? {};
    const escrow = wallet.escrowWallet ?? {};
    const lines = [
      "Wallet balance",
      "==============",
      `Tenant: ${payload.tenantId}`,
      `Spend wallet: ${spend.walletId ?? "n/a"} (${spend.address ?? "n/a"})`,
      `Spend USDC: ${spend.usdcAmount ?? "n/a"}`,
      `Escrow wallet: ${escrow.walletId ?? "n/a"} (${escrow.address ?? "n/a"})`,
      `Escrow USDC: ${escrow.usdcAmount ?? "n/a"}`
    ];
    if (payload.watch?.enabled) {
      lines.push(
        `Watch: attempts=${payload.watch.attempts} target=${payload.watch.targetSpendUsdc} satisfied=${payload.watch.satisfied}`
      );
    }
    if (wallet.balances?.error) lines.push(`Balance warning: ${wallet.balances.error}`);
    return `${lines.join("\n")}\n`;
  }

  const lines = ["Wallet funding", "=============="];
  lines.push(`Tenant: ${payload.tenantId}`);
  lines.push(`Method: ${payload.method}`);
  if (payload.method === "transfer") {
    lines.push(`Send: USDC on ${payload.transfer?.blockchain ?? "unknown"}`);
    lines.push(`To: ${payload.transfer?.address ?? "n/a"}`);
    if (payload.transfer?.walletId) lines.push(`Spend wallet: ${payload.transfer.walletId}`);
    lines.push("Then run: settld wallet balance --watch --min-usdc 1");
  } else if (payload.method === "faucet") {
    const statuses = Array.isArray(payload.faucet?.results)
      ? payload.faucet.results.map((row) => `${row.wallet}:HTTP${row.status}`).join(", ")
      : "none";
    lines.push(`Faucet status: ${statuses}`);
  } else {
    lines.push(`Hosted funding URL: ${payload.hosted?.url ?? "n/a"}`);
    if (payload.hosted?.opened === true) {
      lines.push("Opened in browser.");
    } else {
      lines.push("Pass --open to launch this URL in your browser.");
    }
    if (payload.hosted?.openError) lines.push(`Open warning: ${payload.hosted.openError}`);
  }
  return `${lines.join("\n")}\n`;
}

async function writeJsonOut(jsonOutPath, payload) {
  if (!jsonOutPath) return;
  await fs.mkdir(path.dirname(jsonOutPath), { recursive: true });
  await fs.writeFile(jsonOutPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function normalizeHostedSession(session, { hostedOverride = null } = {}) {
  const result = isPlainObject(session) ? { ...session } : {};
  if (hostedOverride) result.url = hostedOverride;
  const url = normalizeHttpUrl(result.url ?? null);
  if (!url) fail("hosted funding URL is missing or invalid");
  return {
    type: "hosted",
    method: safeTrim(result.method) || "card",
    url
  };
}

export async function runWalletCli({
  argv = process.argv.slice(2),
  env = process.env,
  stdin = process.stdin,
  stdout = process.stdout,
  fetchImpl = fetch,
  readSavedSessionImpl = readSavedSession,
  openInBrowserImpl = openInBrowser
} = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    usage();
    return { ok: true, code: 0 };
  }

  const runtime = await resolveRuntimeConfig({
    args,
    env,
    readSavedSessionImpl
  });

  let payload;
  if (args.command === "status") {
    const wallet = await readWalletSnapshot({ args, runtime, fetchImpl, includeBalances: true, faucet: false });
    payload = {
      ok: true,
      schemaVersion: "SettldWalletStatus.v1",
      baseUrl: runtime.baseUrl,
      tenantId: runtime.tenantId,
      wallet
    };
  } else if (args.command === "balance") {
    payload = await runBalance({ args, runtime, fetchImpl });
    if (args.watch && !payload.ok) {
      fail(
        `wallet balance watch timed out after ${args.timeoutSeconds}s without reaching spend USDC >= ${payload.watch?.targetSpendUsdc}`
      );
    }
  } else if (args.command === "fund") {
    if (args.method === "faucet") {
      const wallet = await readWalletSnapshot({
        args,
        runtime,
        fetchImpl,
        includeBalances: true,
        faucet: true
      });
      payload = {
        ok: true,
        schemaVersion: "SettldWalletFundResult.v1",
        baseUrl: runtime.baseUrl,
        tenantId: runtime.tenantId,
        method: "faucet",
        faucet: {
          blockchain: wallet.blockchain,
          results: Array.isArray(wallet.faucetResults) ? wallet.faucetResults : []
        }
      };
    } else {
      let selectedMethod = args.method;
      const requestBase = {
        provider: String(args.provider ?? "circle").trim() || "circle",
        ...(String(args.provider ?? "circle").trim().toLowerCase() === "circle"
          ? { circle: buildCirclePayload(args, { faucet: false, includeBalances: true }) }
          : {})
      };
      if (safeTrim(args.hostedUrl)) requestBase.hostedUrl = safeTrim(args.hostedUrl);

      if (!selectedMethod) {
        const plan = await requestWalletFundingPlan({
          baseUrl: runtime.baseUrl,
          tenantId: runtime.tenantId,
          cookie: runtime.cookie,
          magicLinkApiKey: runtime.magicLinkApiKey,
          body: requestBase,
          fetchImpl
        });
        if (!plan || !isPlainObject(plan)) fail("wallet funding plan is unavailable");
        if (args.nonInteractive) {
          const derived = deriveFundingChoiceFromPlan(plan);
          selectedMethod = derived.recommendedOptionId === "card_bank" ? derived.preferredHostedMethod : "transfer";
        } else {
          selectedMethod = await promptFundMethod({ plan, stdin, stdout });
        }
      }

      if (selectedMethod === "transfer") {
        const funding = await requestWalletFundingPlan({
          baseUrl: runtime.baseUrl,
          tenantId: runtime.tenantId,
          cookie: runtime.cookie,
          magicLinkApiKey: runtime.magicLinkApiKey,
          body: {
            ...requestBase,
            method: "transfer"
          },
          fetchImpl
        });
        const session = funding?.session;
        if (!isPlainObject(session) || String(session.type) !== "transfer") {
          fail("wallet funding response missing transfer session");
        }
        payload = {
          ok: true,
          schemaVersion: "SettldWalletFundResult.v1",
          baseUrl: runtime.baseUrl,
          tenantId: runtime.tenantId,
          method: "transfer",
          transfer: {
            blockchain: safeTrim(session.blockchain) || null,
            token: safeTrim(session.token) || "USDC",
            tokenIdUsdc: safeTrim(session.tokenIdUsdc) || null,
            walletId: safeTrim(session.walletId) || null,
            address: safeTrim(session.address) || null
          }
        };
        if (!payload.transfer.address) fail("spend wallet address is missing; cannot produce transfer destination");
      } else if (selectedMethod === "card" || selectedMethod === "bank") {
        const funding = await requestWalletFundingPlan({
          baseUrl: runtime.baseUrl,
          tenantId: runtime.tenantId,
          cookie: runtime.cookie,
          magicLinkApiKey: runtime.magicLinkApiKey,
          body: {
            ...requestBase,
            method: selectedMethod
          },
          fetchImpl
        });
        const session = normalizeHostedSession(funding?.session, { hostedOverride: safeTrim(args.hostedUrl) || null });
        const openResult = args.open ? openInBrowserImpl(session.url) : { ok: false, message: null };
        payload = {
          ok: true,
          schemaVersion: "SettldWalletFundResult.v1",
          baseUrl: runtime.baseUrl,
          tenantId: runtime.tenantId,
          method: selectedMethod,
          hosted: {
            url: session.url,
            opened: Boolean(openResult.ok),
            openError: openResult.ok ? null : (openResult.message ?? null)
          }
        };
      } else {
        fail(`unsupported fund method: ${selectedMethod}`);
      }
    }
  } else {
    fail(`unsupported wallet command: ${args.command}`);
  }

  await writeJsonOut(args.jsonOut, payload);
  if (args.format === "json") {
    stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    stdout.write(renderText({ payload, args }));
  }
  return payload;
}

async function main(argv = process.argv.slice(2)) {
  try {
    await runWalletCli({ argv });
  } catch (err) {
    process.stderr.write(`${err?.message ?? String(err)}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
