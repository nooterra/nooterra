function parseTrustedKeysJson(raw, name) {
  if (raw === null || raw === undefined) return new Map();
  const text = String(raw).trim();
  if (!text) return new Map();
  let json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error(`${name} must be valid JSON: ${err?.message ?? String(err ?? "")}`);
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error(`${name} must be a JSON object mapping keyId -> publicKeyPem`);
  const out = new Map();
  for (const [keyId, publicKeyPem] of Object.entries(json)) {
    if (typeof keyId !== "string" || !keyId.trim()) continue;
    if (typeof publicKeyPem !== "string" || !publicKeyPem.trim()) continue;
    out.set(keyId.trim(), publicKeyPem);
  }
  return out;
}

function parseTrustedKeyIdsJson(raw, name) {
  if (raw === null || raw === undefined) return new Set();
  const text = String(raw).trim();
  if (!text) return new Set();
  let json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error(`${name} must be valid JSON: ${err?.message ?? String(err ?? "")}`);
  }
  if (!Array.isArray(json)) throw new Error(`${name} must be a JSON array of keyId strings`);
  const out = new Set();
  for (const v of json) {
    const keyId = typeof v === "string" ? v.trim() : "";
    if (keyId) out.add(keyId);
  }
  return out;
}

export function trustedGovernanceRootKeysFromEnv() {
  return parseTrustedKeysJson(process.env.SETTLD_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON ?? null, "SETTLD_TRUSTED_GOVERNANCE_ROOT_KEYS_JSON");
}

export function trustedPricingSignerKeysFromEnv() {
  return parseTrustedKeysJson(process.env.SETTLD_TRUSTED_PRICING_SIGNER_KEYS_JSON ?? null, "SETTLD_TRUSTED_PRICING_SIGNER_KEYS_JSON");
}

export function trustedPricingSignerKeyIdsFromEnv() {
  return parseTrustedKeyIdsJson(process.env.SETTLD_TRUSTED_PRICING_SIGNER_KEY_IDS_JSON ?? null, "SETTLD_TRUSTED_PRICING_SIGNER_KEY_IDS_JSON");
}

export function trustedTimeAuthorityKeysFromEnv() {
  return parseTrustedKeysJson(process.env.SETTLD_TRUSTED_TIME_AUTHORITY_KEYS_JSON ?? null, "SETTLD_TRUSTED_TIME_AUTHORITY_KEYS_JSON");
}
