import { generateJwt } from "@coinbase/cdp-sdk/auth";

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

function safeTrim(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeClientIp(value) {
  const raw = safeTrim(value);
  if (!raw) return null;
  if (raw.startsWith("::ffff:")) return raw.slice(7);
  return raw;
}

function mapBlockchainToCoinbaseNetwork(raw) {
  const value = safeTrim(raw).toLowerCase();
  if (!value) return null;
  if (value === "base" || value === "base-mainnet" || value === "base_mainnet") return "base";
  if (value === "ethereum" || value === "eth" || value === "ethereum-mainnet" || value === "ethereum_mainnet") return "ethereum";
  if (value === "polygon" || value === "polygon-mainnet" || value === "polygon_mainnet") return "polygon";
  if (value === "solana" || value === "sol") return "solana";
  if (value === "arbitrum" || value === "arbitrum-mainnet" || value === "arbitrum_mainnet") return "arbitrum";
  if (value === "optimism" || value === "optimism-mainnet" || value === "optimism_mainnet") return "optimism";
  if (value === "bitcoin" || value === "btc") return "bitcoin";
  return null;
}

function buildHostedUrl({ payBaseUrl, sessionToken, defaultNetwork, defaultAsset, redirectUrl, fiatCurrency, paymentMethod }) {
  const u = new URL(payBaseUrl);
  u.searchParams.set("sessionToken", sessionToken);
  if (defaultNetwork) u.searchParams.set("defaultNetwork", defaultNetwork);
  if (defaultAsset) u.searchParams.set("defaultAsset", defaultAsset);
  if (redirectUrl) u.searchParams.set("redirectUrl", redirectUrl);
  if (fiatCurrency) u.searchParams.set("fiatCurrency", fiatCurrency);
  if (paymentMethod) u.searchParams.set("defaultPaymentMethod", paymentMethod);
  return u.toString();
}

function hostedMethodUrls({
  requestedMethod,
  payBaseUrl,
  sessionToken,
  defaultNetwork,
  defaultAsset,
  redirectUrl,
  fiatCurrency,
  cardPaymentMethod,
  bankPaymentMethod
}) {
  const cardUrl = buildHostedUrl({
    payBaseUrl,
    sessionToken,
    defaultNetwork,
    defaultAsset,
    redirectUrl,
    fiatCurrency,
    paymentMethod: safeTrim(cardPaymentMethod) || null
  });
  const bankUrl = buildHostedUrl({
    payBaseUrl,
    sessionToken,
    defaultNetwork,
    defaultAsset,
    redirectUrl,
    fiatCurrency,
    paymentMethod: safeTrim(bankPaymentMethod) || null
  });

  if (requestedMethod === "card") return { card: cardUrl, bank: null, preferredMethod: "card" };
  if (requestedMethod === "bank") return { card: null, bank: bankUrl, preferredMethod: "bank" };
  return { card: cardUrl, bank: bankUrl, preferredMethod: "card" };
}

function readJsonSafe(raw) {
  try {
    return JSON.parse(String(raw ?? ""));
  } catch {
    return null;
  }
}

export async function buildCoinbaseHostedUrls({
  requestedMethod = null,
  walletAddress = null,
  blockchain = null,
  clientIp = null,
  config = {},
  fetchImpl = fetch,
  generateJwtImpl = generateJwt
} = {}) {
  const apiKeyId = safeTrim(config.apiKeyId);
  const apiKeySecret = safeTrim(config.apiKeySecret);
  if (!apiKeyId || !apiKeySecret) {
    return { card: null, bank: null, preferredMethod: null, provider: "coinbase", unavailableReason: "MISSING_API_KEYS" };
  }
  const normalizedApiKeySecret = apiKeySecret.includes("\\n") ? apiKeySecret.replace(/\\n/g, "\n") : apiKeySecret;

  const tokenUrl = normalizeHttpUrl(config.tokenUrl ?? "https://api.developer.coinbase.com/onramp/v1/token");
  const payBaseUrl = normalizeHttpUrl(config.payBaseUrl ?? "https://pay.coinbase.com/buy/select-asset");
  if (!tokenUrl || !payBaseUrl) {
    return { card: null, bank: null, preferredMethod: null, provider: "coinbase", unavailableReason: "INVALID_URLS" };
  }

  const parsedTokenUrl = new URL(tokenUrl);
  const networkOverride = safeTrim(config.destinationNetwork);
  const destinationNetwork = networkOverride || mapBlockchainToCoinbaseNetwork(blockchain);
  if (!destinationNetwork) {
    return { card: null, bank: null, preferredMethod: null, provider: "coinbase", unavailableReason: "UNSUPPORTED_NETWORK" };
  }

  const destinationAddress = safeTrim(walletAddress);
  if (!destinationAddress) {
    return { card: null, bank: null, preferredMethod: null, provider: "coinbase", unavailableReason: "MISSING_WALLET_ADDRESS" };
  }

  const purchaseAsset = safeTrim(config.purchaseAsset).toUpperCase() || "USDC";
  const fiatCurrency = safeTrim(config.fiatCurrency).toUpperCase() || "USD";
  const redirectUrl = normalizeHttpUrl(config.redirectUrl);
  const partnerUserRef = safeTrim(config.partnerUserRef) || null;
  const resolvedClientIp = normalizeClientIp(config.clientIp) || normalizeClientIp(clientIp) || null;

  const jwt = await generateJwtImpl({
    apiKeyId,
    apiKeySecret: normalizedApiKeySecret,
    requestMethod: "POST",
    requestHost: parsedTokenUrl.host,
    requestPath: parsedTokenUrl.pathname,
    expiresIn: 120
  });

  const requestBody = {
    addresses: [{
      address: destinationAddress,
      blockchains: [destinationNetwork]
    }],
    assets: [purchaseAsset]
  };
  if (resolvedClientIp) requestBody.clientIp = resolvedClientIp;
  if (partnerUserRef) requestBody.partnerUserRef = partnerUserRef;

  const res = await fetchImpl(tokenUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${jwt}`,
      "content-type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify(requestBody)
  });
  const raw = await res.text();
  const json = readJsonSafe(raw);
  if (!res.ok) {
    const detail = json && typeof json === "object" ? json : { message: raw || `HTTP ${res.status}` };
    const err = new Error(`coinbase session token request failed (${res.status})`);
    err.detail = detail;
    throw err;
  }

  const sessionToken = safeTrim(json?.token || json?.sessionToken || json?.session?.token);
  if (!sessionToken) {
    const err = new Error("coinbase session token response missing token");
    err.detail = json;
    throw err;
  }

  const urls = hostedMethodUrls({
    requestedMethod,
    payBaseUrl,
    sessionToken,
    defaultNetwork: destinationNetwork,
    defaultAsset: purchaseAsset,
    redirectUrl,
    fiatCurrency,
    cardPaymentMethod: config.cardPaymentMethod,
    bankPaymentMethod: config.bankPaymentMethod
  });

  return {
    ...urls,
    provider: "coinbase",
    sessionToken,
    destinationNetwork,
    purchaseAsset,
    fiatCurrency
  };
}
