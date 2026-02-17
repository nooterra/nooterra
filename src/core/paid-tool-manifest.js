import { canonicalJsonStringify, normalizeForCanonicalJson } from "./canonical-json.js";
import { sha256Hex } from "./crypto.js";

export const PAID_TOOL_MANIFEST_SCHEMA_VERSION = "PaidToolManifest.v1";

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
}

function normalizeNonEmptyString(value, name, { max = 256 } = {}) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new TypeError(`${name} is required`);
  if (text.length > max) throw new TypeError(`${name} must be <= ${max} chars`);
  return text;
}

function normalizeOptionalString(value, name, { max = 2048 } = {}) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const text = String(value).trim();
  if (text.length > max) throw new TypeError(`${name} must be <= ${max} chars`);
  return text;
}

function normalizeHttpMethod(value, name) {
  const method = normalizeNonEmptyString(value ?? "GET", name, { max: 16 }).toUpperCase();
  if (!["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].includes(method)) {
    throw new TypeError(`${name} must be GET|POST|PUT|PATCH|DELETE|HEAD`);
  }
  return method;
}

function normalizeCurrency(value, name) {
  const raw = typeof value === "string" && value.trim() !== "" ? value.trim().toUpperCase() : "USD";
  if (!/^[A-Z][A-Z0-9_]{2,11}$/.test(raw)) throw new TypeError(`${name} must match ^[A-Z][A-Z0-9_]{2,11}$`);
  return raw;
}

function normalizePositiveSafeInt(value, name) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new TypeError(`${name} must be a positive safe integer`);
  return n;
}

function normalizeRoutePath(value, name) {
  const text = normalizeNonEmptyString(value, name, { max: 1024 });
  if (!text.startsWith("/")) throw new TypeError(`${name} must start with /`);
  if (text.includes("..")) throw new TypeError(`${name} must not contain path traversal`);
  return text;
}

function normalizePricing(rawPricing, defaults, fieldPath) {
  const pricing = rawPricing && typeof rawPricing === "object" && !Array.isArray(rawPricing) ? rawPricing : {};
  const amountCents = normalizePositiveSafeInt(pricing.amountCents ?? defaults.amountCents ?? 500, `${fieldPath}.amountCents`);
  const currency = normalizeCurrency(pricing.currency ?? defaults.currency ?? "USD", `${fieldPath}.currency`);
  return normalizeForCanonicalJson({ amountCents, currency }, { path: "$" });
}

function normalizeTool(rawTool, defaults, { index }) {
  assertPlainObject(rawTool, `tools[${index}]`);
  const toolId = normalizeNonEmptyString(rawTool.toolId, `tools[${index}].toolId`, { max: 128 });
  const mcpToolName = normalizeOptionalString(rawTool.mcpToolName, `tools[${index}].mcpToolName`, { max: 180 });
  const description = normalizeOptionalString(rawTool.description, `tools[${index}].description`, { max: 1000 });
  const method = normalizeHttpMethod(rawTool.method ?? "GET", `tools[${index}].method`);
  const upstreamPath = normalizeOptionalString(rawTool.upstreamPath, `tools[${index}].upstreamPath`, { max: 1024 });
  const paidPath = normalizeRoutePath(rawTool.paidPath, `tools[${index}].paidPath`);
  const idempotency = normalizeOptionalString(rawTool.idempotency, `tools[${index}].idempotency`, { max: 64 }) ?? defaults.idempotency ?? "idempotent";
  const signatureMode = normalizeOptionalString(rawTool.signatureMode, `tools[${index}].signatureMode`, { max: 64 }) ?? defaults.signatureMode ?? "required";
  if (!["idempotent", "non_idempotent", "side_effecting"].includes(String(idempotency))) {
    throw new TypeError(`tools[${index}].idempotency must be idempotent|non_idempotent|side_effecting`);
  }
  if (!["required", "optional"].includes(String(signatureMode))) {
    throw new TypeError(`tools[${index}].signatureMode must be required|optional`);
  }
  const pricing = normalizePricing(rawTool.pricing, defaults, `tools[${index}].pricing`);
  const auth =
    rawTool.auth && typeof rawTool.auth === "object" && !Array.isArray(rawTool.auth)
      ? normalizeForCanonicalJson(rawTool.auth, { path: "$" })
      : normalizeForCanonicalJson({ mode: "none" }, { path: "$" });
  const metadata =
    rawTool.metadata && typeof rawTool.metadata === "object" && !Array.isArray(rawTool.metadata)
      ? normalizeForCanonicalJson(rawTool.metadata, { path: "$" })
      : null;

  return normalizeForCanonicalJson(
    {
      toolId,
      mcpToolName,
      description,
      method,
      upstreamPath,
      paidPath,
      pricing,
      idempotency,
      signatureMode,
      auth,
      metadata
    },
    { path: "$" }
  );
}

export function normalizePaidToolManifestV1(manifestInput) {
  assertPlainObject(manifestInput, "manifest");
  const schemaVersion = normalizeNonEmptyString(manifestInput.schemaVersion, "manifest.schemaVersion", { max: 64 });
  if (schemaVersion !== PAID_TOOL_MANIFEST_SCHEMA_VERSION) {
    throw new TypeError(`manifest.schemaVersion must be ${PAID_TOOL_MANIFEST_SCHEMA_VERSION}`);
  }
  const providerId = normalizeNonEmptyString(manifestInput.providerId, "manifest.providerId", { max: 160 });
  const upstreamBaseUrl = normalizeOptionalString(manifestInput.upstreamBaseUrl, "manifest.upstreamBaseUrl", { max: 2048 });
  const sourceOpenApiPath = normalizeOptionalString(manifestInput.sourceOpenApiPath, "manifest.sourceOpenApiPath", { max: 2048 });

  const defaultsRaw =
    manifestInput.defaults && typeof manifestInput.defaults === "object" && !Array.isArray(manifestInput.defaults)
      ? manifestInput.defaults
      : {};
  const defaults = normalizeForCanonicalJson(
    {
      amountCents: normalizePositiveSafeInt(defaultsRaw.amountCents ?? 500, "manifest.defaults.amountCents"),
      currency: normalizeCurrency(defaultsRaw.currency ?? "USD", "manifest.defaults.currency"),
      idempotency: normalizeOptionalString(defaultsRaw.idempotency, "manifest.defaults.idempotency", { max: 64 }) ?? "idempotent",
      signatureMode: normalizeOptionalString(defaultsRaw.signatureMode, "manifest.defaults.signatureMode", { max: 64 }) ?? "required"
    },
    { path: "$" }
  );
  if (!["idempotent", "non_idempotent", "side_effecting"].includes(String(defaults.idempotency))) {
    throw new TypeError("manifest.defaults.idempotency must be idempotent|non_idempotent|side_effecting");
  }
  if (!["required", "optional"].includes(String(defaults.signatureMode))) {
    throw new TypeError("manifest.defaults.signatureMode must be required|optional");
  }

  if (!Array.isArray(manifestInput.tools) || manifestInput.tools.length === 0) {
    throw new TypeError("manifest.tools must be a non-empty array");
  }
  const tools = manifestInput.tools.map((row, index) => normalizeTool(row, defaults, { index }));
  const seenToolIds = new Set();
  const seenPaidPaths = new Set();
  for (const tool of tools) {
    if (seenToolIds.has(tool.toolId)) throw new TypeError(`manifest.tools contains duplicate toolId: ${tool.toolId}`);
    if (seenPaidPaths.has(tool.paidPath)) throw new TypeError(`manifest.tools contains duplicate paidPath: ${tool.paidPath}`);
    seenToolIds.add(tool.toolId);
    seenPaidPaths.add(tool.paidPath);
  }

  return normalizeForCanonicalJson(
    {
      schemaVersion: PAID_TOOL_MANIFEST_SCHEMA_VERSION,
      providerId,
      upstreamBaseUrl,
      sourceOpenApiPath,
      defaults,
      tools
    },
    { path: "$" }
  );
}

export function validatePaidToolManifestV1(manifestInput) {
  try {
    const manifest = normalizePaidToolManifestV1(manifestInput);
    return { ok: true, manifest };
  } catch (err) {
    return { ok: false, code: "PAID_TOOL_MANIFEST_INVALID", message: err?.message ?? String(err ?? "") };
  }
}

export function computePaidToolManifestHashV1(manifestInput) {
  const manifest = normalizePaidToolManifestV1(manifestInput);
  return sha256Hex(canonicalJsonStringify(manifest));
}
