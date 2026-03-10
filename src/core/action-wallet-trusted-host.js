import { normalizeForCanonicalJson } from "./canonical-json.js";
import { sha256Hex } from "./crypto.js";

const ACTION_WALLET_TRUSTED_HOST_PROFILES = Object.freeze({
  "claude-desktop": Object.freeze({
    runtime: "claude-desktop",
    channel: "Claude MCP",
    hostName: "Claude MCP",
    transport: "mcp",
    installCommand: "npx -y nooterra setup --host claude-desktop",
    docsPath: "/docs/integrations/claude-desktop/PUBLIC_QUICKSTART.md"
  }),
  openclaw: Object.freeze({
    runtime: "openclaw",
    channel: "OpenClaw",
    hostName: "OpenClaw",
    transport: "mcp",
    installCommand: "npx -y clawhub@latest install nooterra-mcp-payments",
    docsPath: "/docs/integrations/openclaw/PUBLIC_QUICKSTART.md"
  })
});

const ACTION_WALLET_TRUSTED_HOST_RUNTIME_ALIASES = Object.freeze({
  mcp: "claude-desktop",
  claude: "claude-desktop",
  "claude-mcp": "claude-desktop",
  "claude-desktop": "claude-desktop",
  openclaw: "openclaw"
});

const ACTION_WALLET_TRUSTED_HOST_AUTH_TYPES = new Set(["none", "client_secret", "bearer_token"]);

function normalizeOptionalString(value, field, { max = 200, allowNull = false, lower = false } = {}) {
  if (value === null || value === undefined || String(value).trim() === "") {
    if (allowNull) return null;
    throw new TypeError(`${field} is required`);
  }
  const normalized = lower ? String(value).trim().toLowerCase() : String(value).trim();
  if (normalized.length > max) throw new TypeError(`${field} must be <= ${max} chars`);
  return normalized;
}

function normalizeCallbackUrls(value) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError("callbackUrls must be an array");
  const out = [];
  const seen = new Set();
  for (const raw of value) {
    const text = normalizeOptionalString(raw, "callbackUrls[]", { max: 2048 });
    let parsed;
    try {
      parsed = new URL(text);
    } catch {
      throw new TypeError("callbackUrls[] must be a valid URL");
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new TypeError("callbackUrls[] must use http or https");
    }
    if (
      parsed.protocol === "http:" &&
      parsed.hostname !== "localhost" &&
      parsed.hostname !== "127.0.0.1" &&
      parsed.hostname !== "[::1]"
    ) {
      throw new TypeError("callbackUrls[] must use https outside localhost");
    }
    const normalized = parsed.toString();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function normalizeAuthModel(value, existing = null) {
  if (value !== null && value !== undefined && (typeof value !== "object" || Array.isArray(value))) {
    throw new TypeError("authModel must be an object");
  }
  const raw = value && typeof value === "object" ? value : {};
  const existingAuthModel = existing && typeof existing === "object" && !Array.isArray(existing) ? existing : {};
  const clientSecret = normalizeOptionalString(raw.clientSecret ?? null, "authModel.clientSecret", {
    max: 500,
    allowNull: true
  });
  let type = normalizeOptionalString(raw.type ?? null, "authModel.type", { max: 40, allowNull: true, lower: true });
  if (type === null) type = clientSecret ? "client_secret" : "none";
  if (!ACTION_WALLET_TRUSTED_HOST_AUTH_TYPES.has(type)) {
    throw new TypeError("authModel.type must be none|client_secret|bearer_token");
  }
  if (type !== "client_secret" && clientSecret) {
    throw new TypeError("authModel.clientSecret is only supported when authModel.type=client_secret");
  }
  const preserveExistingClientSecret =
    type === "client_secret" &&
    clientSecret === null &&
    existingAuthModel.type === "client_secret" &&
    existingAuthModel.clientSecretConfigured === true;
  return {
    type,
    clientSecretHash: clientSecret
      ? sha256Hex(clientSecret)
      : preserveExistingClientSecret && typeof existingAuthModel.clientSecretHash === "string" && existingAuthModel.clientSecretHash.trim() !== ""
        ? existingAuthModel.clientSecretHash
        : null,
    clientSecretLast4: clientSecret
      ? clientSecret.slice(-4)
      : preserveExistingClientSecret && typeof existingAuthModel.clientSecretLast4 === "string" && existingAuthModel.clientSecretLast4.trim() !== ""
        ? existingAuthModel.clientSecretLast4
        : null,
    clientSecretConfigured: type === "client_secret" ? clientSecret !== null || preserveExistingClientSecret : false
  };
}

function defaultHostIdForProfile(profile) {
  if (profile.runtime === "claude-desktop") return "host_claude_mcp";
  return `host_${profile.runtime.replace(/[^a-z0-9]+/g, "_")}`;
}

export function listActionWalletTrustedHostRuntimes() {
  return Object.freeze(Object.keys(ACTION_WALLET_TRUSTED_HOST_PROFILES));
}

export function resolveActionWalletTrustedHostProfile(runtime) {
  const normalizedRuntime = normalizeOptionalString(runtime ?? "claude-desktop", "runtime", {
    max: 80,
    lower: true
  });
  const canonicalRuntime = ACTION_WALLET_TRUSTED_HOST_RUNTIME_ALIASES[normalizedRuntime] ?? null;
  if (!canonicalRuntime) {
    throw new TypeError(`runtime must resolve to one of: ${listActionWalletTrustedHostRuntimes().join(", ")}`);
  }
  return ACTION_WALLET_TRUSTED_HOST_PROFILES[canonicalRuntime];
}

export function buildActionWalletTrustedHostRecord(value, { now, existing = null } = {}) {
  const payload = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const createdAt = normalizeOptionalString(existing?.createdAt ?? now, "createdAt");
  const updatedAt = normalizeOptionalString(now, "updatedAt");
  const profile = resolveActionWalletTrustedHostProfile(payload.runtime ?? existing?.runtime ?? "claude-desktop");
  const hostId =
    normalizeOptionalString(payload.hostId ?? existing?.hostId ?? null, "hostId", { max: 200, allowNull: true }) ??
    defaultHostIdForProfile(profile);
  const hostName =
    normalizeOptionalString(payload.hostName ?? existing?.hostName ?? null, "hostName", { max: 200, allowNull: true }) ??
    profile.hostName;
  const callbackUrls = normalizeCallbackUrls(payload.callbackUrls ?? existing?.callbackUrls ?? []);
  const environment = normalizeOptionalString(payload.environment ?? existing?.environment ?? null, "environment", {
    max: 80,
    allowNull: true,
    lower: true
  });
  const authModel = normalizeAuthModel(payload.authModel ?? existing?.authModel ?? null, existing?.authModel ?? null);
  const keyId = normalizeOptionalString(existing?.authModel?.keyId ?? null, "authModel.keyId", {
    max: 200,
    allowNull: true
  });
  const lastIssuedAt = normalizeOptionalString(existing?.authModel?.lastIssuedAt ?? null, "authModel.lastIssuedAt", {
    max: 80,
    allowNull: true
  });
  return normalizeForCanonicalJson(
    {
      schemaVersion: "TrustedHostRegistryEntry.v1",
      hostId,
      hostName,
      channel: profile.channel,
      runtime: profile.runtime,
      transport: profile.transport,
      callbackUrls,
      environment,
      status: "active",
      approvalMode: "hosted_link",
      docsPath: profile.docsPath,
      installCommand: profile.installCommand,
      authModel: {
        type: authModel.type,
        clientSecretHash: authModel.clientSecretHash,
        clientSecretLast4: authModel.clientSecretLast4,
        clientSecretConfigured: authModel.clientSecretConfigured,
        keyId,
        lastIssuedAt
      },
      createdAt,
      updatedAt
    },
    { path: "$.trustedHost" }
  );
}

export function sanitizeActionWalletTrustedHostRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new TypeError("trusted host record is required");
  }
  return normalizeForCanonicalJson(
    {
      schemaVersion: "TrustedHostRegistryEntry.v1",
      hostId: record.hostId ?? null,
      hostName: record.hostName ?? null,
      channel: record.channel ?? null,
      runtime: record.runtime ?? null,
      transport: record.transport ?? null,
      callbackUrls: Array.isArray(record.callbackUrls) ? record.callbackUrls : [],
      environment: record.environment ?? null,
      status: record.status ?? "active",
      approvalMode: record.approvalMode ?? "hosted_link",
      docsPath: record.docsPath ?? null,
      installCommand: record.installCommand ?? null,
      authModel: {
        type: record.authModel?.type ?? "none",
        clientSecretConfigured: record.authModel?.clientSecretConfigured === true,
        keyId:
          typeof record.authModel?.keyId === "string" && record.authModel.keyId.trim() !== ""
            ? record.authModel.keyId.trim()
            : null,
        clientSecretLast4:
          typeof record.authModel?.clientSecretLast4 === "string" && record.authModel.clientSecretLast4.trim() !== ""
            ? record.authModel.clientSecretLast4.trim()
            : null,
        lastIssuedAt:
          typeof record.authModel?.lastIssuedAt === "string" && record.authModel.lastIssuedAt.trim() !== ""
            ? record.authModel.lastIssuedAt.trim()
            : null
      },
      createdAt: record.createdAt ?? null,
      updatedAt: record.updatedAt ?? null
    },
    { path: "$.trustedHost" }
  );
}
