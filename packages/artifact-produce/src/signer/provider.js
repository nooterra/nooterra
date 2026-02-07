function assertNonEmptyString(v, name) {
  if (typeof v !== "string" || v.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
}

export function createSigner({ keyId, provider, publicKeyPem = null } = {}) {
  assertNonEmptyString(keyId, "keyId");
  if (!provider || typeof provider !== "object") throw new TypeError("provider is required");
  if (typeof provider.sign !== "function") throw new TypeError("provider.sign is required");
  if (typeof provider.getPublicKeyPem !== "function") throw new TypeError("provider.getPublicKeyPem is required");
  return { keyId, provider, publicKeyPem };
}

export function signerCanSign(signer) {
  if (!signer || typeof signer !== "object") return false;
  if (typeof signer.privateKeyPem === "string" && signer.privateKeyPem.trim()) return true;
  if (signer.provider && typeof signer.provider.sign === "function") return true;
  return false;
}

export function signerPublicKeyPemBestEffort(signer) {
  if (!signer || typeof signer !== "object") return null;
  const fromField = typeof signer.publicKeyPem === "string" && signer.publicKeyPem.trim() ? signer.publicKeyPem : null;
  if (fromField) return fromField;
  const fromProvider = signer.provider && typeof signer.provider.getPublicKeyPem === "function" ? signer.provider.getPublicKeyPem({ keyId: signer.keyId }) : null;
  return typeof fromProvider === "string" && fromProvider.trim() ? fromProvider : null;
}

