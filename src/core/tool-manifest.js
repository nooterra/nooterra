import { canonicalJsonStringify, normalizeForCanonicalJson } from "./canonical-json.js";
import { sha256Hex, signHashHexEd25519, verifyHashHexEd25519 } from "./crypto.js";

export const TOOL_MANIFEST_SCHEMA_VERSION = "ToolManifest.v1";

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
}

export function computeToolManifestHashV1(manifestCore) {
  const core = normalizeForCanonicalJson(manifestCore ?? null, { path: "$" });
  if (!core || typeof core !== "object" || Array.isArray(core)) throw new TypeError("manifest core must be an object");
  if (String(core.schemaVersion ?? "") !== TOOL_MANIFEST_SCHEMA_VERSION) {
    throw new TypeError(`schemaVersion must be ${TOOL_MANIFEST_SCHEMA_VERSION}`);
  }
  return sha256Hex(canonicalJsonStringify(core));
}

export function buildToolManifestV1({
  toolId,
  toolVersion,
  endpoints,
  inputSchema,
  outputSchema,
  verifierHints = null,
  createdAt,
  signerKeyId,
  signerPrivateKeyPem,
  signerPublicKeyPem = null
}) {
  assertNonEmptyString(toolId, "toolId");
  assertNonEmptyString(toolVersion, "toolVersion");
  if (!Array.isArray(endpoints) || endpoints.length === 0) throw new TypeError("endpoints[] is required");
  assertNonEmptyString(signerKeyId, "signerKeyId");
  assertNonEmptyString(signerPrivateKeyPem, "signerPrivateKeyPem");

  const createdAtIso = createdAt ?? new Date().toISOString();
  assertNonEmptyString(createdAtIso, "createdAt");
  if (!Number.isFinite(Date.parse(createdAtIso))) throw new TypeError("createdAt must be an ISO date string");

  const inputSchemaNormalized = normalizeForCanonicalJson(inputSchema ?? {}, { path: "$" });
  const outputSchemaNormalized = normalizeForCanonicalJson(outputSchema ?? {}, { path: "$" });
  const inputSchemaHash = sha256Hex(canonicalJsonStringify(inputSchemaNormalized));
  const outputSchemaHash = sha256Hex(canonicalJsonStringify(outputSchemaNormalized));

  const core = normalizeForCanonicalJson(
    {
      schemaVersion: TOOL_MANIFEST_SCHEMA_VERSION,
      toolId,
      toolVersion,
      endpoints,
      inputSchemaHash,
      outputSchemaHash,
      verifierHints,
      createdAt: createdAtIso
    },
    { path: "$" }
  );
  const manifestHash = computeToolManifestHashV1(core);
  const signatureBase64 = signHashHexEd25519(manifestHash, signerPrivateKeyPem);

  const signature = normalizeForCanonicalJson(
    {
      algorithm: "ed25519",
      signerKeyId,
      ...(signerPublicKeyPem ? { signerPublicKeyPem: String(signerPublicKeyPem) } : {}),
      manifestHash,
      signature: signatureBase64
    },
    { path: "$" }
  );

  const manifest = normalizeForCanonicalJson({ ...core, signature }, { path: "$" });
  return { manifest, core, signature, manifestHash, inputSchema: inputSchemaNormalized, outputSchema: outputSchemaNormalized };
}

export function verifyToolManifestV1({ manifest, signerPublicKeyPem }) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return { ok: false, code: "TOOL_MANIFEST_INVALID", message: "manifest must be an object" };
  }
  if (String(manifest.schemaVersion ?? "") !== TOOL_MANIFEST_SCHEMA_VERSION) {
    return { ok: false, code: "TOOL_MANIFEST_VERSION_UNSUPPORTED", message: `schemaVersion must be ${TOOL_MANIFEST_SCHEMA_VERSION}` };
  }

  const sig = manifest.signature && typeof manifest.signature === "object" && !Array.isArray(manifest.signature) ? manifest.signature : null;
  if (!sig) return { ok: false, code: "TOOL_MANIFEST_SIGNATURE_MISSING", message: "signature missing" };
  if (String(sig.algorithm ?? "") !== "ed25519") {
    return { ok: false, code: "TOOL_MANIFEST_SIGNATURE_INVALID", message: "signature.algorithm must be ed25519" };
  }
  if (typeof sig.signature !== "string" || sig.signature.trim() === "") {
    return { ok: false, code: "TOOL_MANIFEST_SIGNATURE_INVALID", message: "signature.signature missing" };
  }
  if (typeof sig.manifestHash !== "string" || !/^[0-9a-f]{64}$/.test(sig.manifestHash)) {
    return { ok: false, code: "TOOL_MANIFEST_SIGNATURE_INVALID", message: "signature.manifestHash must be sha256 hex" };
  }

  // eslint-disable-next-line no-unused-vars
  const { signature, ...rest } = manifest;
  const core = normalizeForCanonicalJson(rest, { path: "$" });
  const computedHash = computeToolManifestHashV1(core);
  if (computedHash !== String(sig.manifestHash)) {
    return { ok: false, code: "TOOL_MANIFEST_SIGNATURE_INVALID", message: "manifestHash mismatch" };
  }

  const publicKeyPem =
    signerPublicKeyPem ??
    (typeof sig.signerPublicKeyPem === "string" && sig.signerPublicKeyPem.trim() !== "" ? sig.signerPublicKeyPem : null);
  if (!publicKeyPem) return { ok: false, code: "TOOL_MANIFEST_SIGNATURE_KEY_MISSING", message: "signer public key missing" };

  const verified = verifyHashHexEd25519({ hashHex: computedHash, signatureBase64: String(sig.signature), publicKeyPem });
  if (verified !== true) {
    return { ok: false, code: "TOOL_MANIFEST_SIGNATURE_INVALID", message: "signature verification failed" };
  }
  return { ok: true, manifestHash: computedHash };
}

