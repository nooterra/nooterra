import crypto from "node:crypto";

function normalizeHttpUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

function parseCsvList(raw) {
  const input = String(raw ?? "").trim();
  if (!input) return [];
  return [...new Set(input.split(",").map((x) => String(x ?? "").trim()).filter(Boolean))];
}

function normalizeOnramperNetworkId(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const key = value.toLowerCase();
  if (key === "base-sepolia") return "base_sepolia";
  if (key === "base") return "base";
  if (key === "ethereum" || key === "eth") return "ethereum";
  if (key === "ethereum-sepolia" || key === "sepolia") return "ethereum_sepolia";
  if (key === "polygon" || key === "matic") return "polygon";
  if (key === "solana" || key === "sol") return "solana";
  return key.replace(/[^a-z0-9_-]+/g, "_");
}

function normalizedList(raw) {
  return parseCsvList(raw)
    .map((x) => String(x).trim().toLowerCase())
    .filter(Boolean);
}

function addIfPresent(searchParams, key, value) {
  const raw = String(value ?? "").trim();
  if (!raw) return;
  searchParams.set(key, raw);
}

function buildSensitiveSignature({ signingSecret, sensitivePairs }) {
  const secret = String(signingSecret ?? "").trim();
  if (!secret || !Array.isArray(sensitivePairs) || !sensitivePairs.length) return null;
  const rows = sensitivePairs
    .map((entry) => {
      const k = String(entry?.key ?? "").trim();
      const v = String(entry?.value ?? "").trim();
      if (!k || !v) return null;
      return { key: k, value: v };
    })
    .filter(Boolean)
    .sort((a, b) => a.key.localeCompare(b.key));
  if (!rows.length) return null;
  const signContent = rows.map(({ key, value }) => `${key}=${value}`).join("&");
  return crypto.createHmac("sha256", secret).update(signContent, "utf8").digest("hex");
}

function buildMethodUrl({
  baseUrl,
  apiKey,
  method,
  defaultFiat,
  defaultCrypto,
  onlyCryptos,
  onlyCryptoNetworks,
  walletAddress,
  networkId,
  signingSecret,
  successRedirectUrl,
  failureRedirectUrl
}) {
  const u = new URL(baseUrl);
  const sp = u.searchParams;
  sp.set("apiKey", apiKey);
  sp.set("mode", "buy");

  addIfPresent(sp, "defaultFiat", defaultFiat);
  addIfPresent(sp, "defaultCrypto", defaultCrypto);

  if (onlyCryptos.length) sp.set("onlyCryptos", onlyCryptos.join(","));
  if (onlyCryptoNetworks.length) sp.set("onlyCryptoNetworks", onlyCryptoNetworks.join(","));

  if (method === "card") sp.set("defaultPaymentMethod", "creditcard");
  if (method === "bank") sp.set("defaultPaymentMethod", "banktransfer");

  addIfPresent(sp, "successRedirectUrl", successRedirectUrl);
  addIfPresent(sp, "failureRedirectUrl", failureRedirectUrl);

  const sensitivePairs = [];
  if (walletAddress && networkId && signingSecret) {
    const networkWallets = `${networkId}:${walletAddress}`;
    sp.set("networkWallets", networkWallets);
    sensitivePairs.push({ key: "networkWallets", value: networkWallets });
  }

  const signature = buildSensitiveSignature({ signingSecret, sensitivePairs });
  if (signature) sp.set("signature", signature);

  return u.toString();
}

export function buildOnramperHostedUrls({
  requestedMethod = null,
  walletAddress = null,
  blockchain = null,
  config = {}
} = {}) {
  const apiKey = String(config.apiKey ?? "").trim();
  if (!apiKey) return { card: null, bank: null, preferredMethod: null, provider: "onramper" };

  const baseUrl = normalizeHttpUrl(config.baseUrl ?? "https://buy.onramper.com");
  if (!baseUrl) return { card: null, bank: null, preferredMethod: null, provider: "onramper" };

  const onlyCryptos = normalizedList(config.onlyCryptos);
  const onlyCryptoNetworks = normalizedList(config.onlyCryptoNetworks);
  const defaultCrypto = String(config.defaultCrypto ?? "usdc").trim().toLowerCase();
  const defaultFiat = String(config.defaultFiat ?? "usd").trim().toLowerCase();

  const configuredNetworkId = normalizeOnramperNetworkId(config.networkId);
  const inferredNetworkId = normalizeOnramperNetworkId(blockchain);
  const networkId = configuredNetworkId || inferredNetworkId;
  const signingSecret = String(config.signingSecret ?? "").trim();
  const successRedirectUrl = normalizeHttpUrl(config.successRedirectUrl);
  const failureRedirectUrl = normalizeHttpUrl(config.failureRedirectUrl);

  const make = (method) =>
    buildMethodUrl({
      baseUrl,
      apiKey,
      method,
      defaultFiat,
      defaultCrypto,
      onlyCryptos,
      onlyCryptoNetworks,
      walletAddress: String(walletAddress ?? "").trim() || null,
      networkId,
      signingSecret,
      successRedirectUrl,
      failureRedirectUrl
    });

  let card = make("card");
  let bank = make("bank");

  if (requestedMethod === "card") bank = null;
  if (requestedMethod === "bank") card = null;

  const preferredMethod = card ? "card" : bank ? "bank" : null;
  return { card, bank, preferredMethod, provider: "onramper" };
}
