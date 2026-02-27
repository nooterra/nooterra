#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

import { canonicalJsonStringify, normalizeForCanonicalJson } from "../../src/core/canonical-json.js";
import { sha256Hex } from "../../src/core/crypto.js";

const REPORT_SCHEMA_VERSION = "NooterraNs3EvidenceBindingCoverageMatrixReport.v1";
const POLICY_SCHEMA_VERSION = "NooterraNs3EvidenceBindingCoveragePolicy.v1";
const DRIFT_OVERRIDE_SCHEMA_VERSION = "NooterraNs3EvidenceBindingCoverageDriftOverride.v1";
const DRIFT_GATE_SCHEMA_VERSION = "NooterraNs3EvidenceBindingCoverageDriftGate.v1";
const DETERMINISTIC_CORE_SCHEMA_VERSION = "NooterraNs3EvidenceBindingCoverageDeterministicCore.v1";

const DEFAULT_REPORT_PATH = "artifacts/gates/ns3-evidence-binding-coverage-matrix.json";
const DEFAULT_POLICY_PATH = "docs/kernel-compatible/ns3-evidence-binding-coverage-policy.json";

const RUNTIME_SOURCE_PATH = "src/api/app.js";
const OPENAPI_SOURCE_PATH = "src/api/openapi.js";
const OPENAPI_BUILT_PATH = "openapi/nooterra.openapi.json";
const DOCS_CATALOG_PATH = "docs/spec/x402-error-codes.v1.txt";

const ALLOWED_METHODS = Object.freeze(["GET", "POST", "PUT", "PATCH", "DELETE"]);

function usage() {
  return [
    "usage: node scripts/ci/run-ns3-evidence-binding-coverage-matrix.mjs [options]",
    "",
    "options:",
    "  --report <file>          Output report path (default: artifacts/gates/ns3-evidence-binding-coverage-matrix.json)",
    "  --policy <file>          Coverage policy path (default: docs/kernel-compatible/ns3-evidence-binding-coverage-policy.json)",
    "  --drift-override <file>  Optional drift override JSON path",
    "  --now <iso-8601>         Optional deterministic timestamp for report + override validation",
    "  --help                   Show help"
  ].join("\n");
}

function normalizeOptionalString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function cmpString(a, b) {
  const aa = String(a ?? "");
  const bb = String(b ?? "");
  if (aa < bb) return -1;
  if (aa > bb) return 1;
  return 0;
}

function uniqueSortedStrings(values) {
  const seen = new Set();
  for (const value of values) {
    const normalized = normalizeOptionalString(value);
    if (!normalized) continue;
    seen.add(normalized);
  }
  return Array.from(seen).sort(cmpString);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function parseIso8601(value, fieldName) {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return null;
  const epochMs = Date.parse(normalized);
  if (!Number.isFinite(epochMs)) {
    throw new Error(`${fieldName} must be a valid ISO-8601 timestamp`);
  }
  return new Date(epochMs).toISOString();
}

function normalizeIssue(issue) {
  return {
    id: normalizeOptionalString(issue?.id) ?? "issue_unknown",
    category: normalizeOptionalString(issue?.category) ?? "coverage",
    code: normalizeOptionalString(issue?.code) ?? "unknown",
    message: normalizeOptionalString(issue?.message) ?? "unknown issue",
    operationId: normalizeOptionalString(issue?.operationId),
    route: normalizeOptionalString(issue?.route),
    method: normalizeOptionalString(issue?.method),
    dimension: normalizeOptionalString(issue?.dimension)
  };
}

function sortIssues(issues) {
  return [...issues]
    .map(normalizeIssue)
    .sort(
      (a, b) =>
        cmpString(a.id, b.id) ||
        cmpString(a.category, b.category) ||
        cmpString(a.code, b.code) ||
        cmpString(a.operationId, b.operationId) ||
        cmpString(a.dimension, b.dimension)
    );
}

export function parseArgs(argv, cwd = process.cwd()) {
  const out = {
    reportPath: path.resolve(cwd, DEFAULT_REPORT_PATH),
    policyPath: path.resolve(cwd, DEFAULT_POLICY_PATH),
    driftOverridePath: null,
    nowIso: null,
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] ?? "").trim();
    if (!arg) continue;

    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg === "--report") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--report requires a file path");
      out.reportPath = path.resolve(cwd, value);
      i += 1;
      continue;
    }
    if (arg === "--policy") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--policy requires a file path");
      out.policyPath = path.resolve(cwd, value);
      i += 1;
      continue;
    }
    if (arg === "--drift-override") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--drift-override requires a JSON file path");
      out.driftOverridePath = path.resolve(cwd, value);
      i += 1;
      continue;
    }
    if (arg === "--now") {
      const value = normalizeOptionalString(argv[i + 1]);
      if (!value) throw new Error("--now requires an ISO-8601 timestamp");
      out.nowIso = parseIso8601(value, "--now");
      i += 1;
      continue;
    }

    throw new Error(`unknown argument: ${arg}`);
  }

  return out;
}

async function loadTextArtifact(filePath) {
  let raw;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (err) {
    const errorCode = err?.code === "ENOENT" ? "file_missing" : "file_read_error";
    return {
      path: filePath,
      readOk: false,
      raw: null,
      sourceSha256: null,
      errorCode,
      errorMessage: err?.message ?? String(err)
    };
  }

  return {
    path: filePath,
    readOk: true,
    raw,
    sourceSha256: sha256Hex(raw),
    errorCode: null,
    errorMessage: null
  };
}

async function loadJsonArtifact(filePath) {
  const loaded = await loadTextArtifact(filePath);
  if (!loaded.readOk) {
    return {
      ...loaded,
      parseOk: false,
      json: null
    };
  }

  try {
    return {
      ...loaded,
      parseOk: true,
      json: JSON.parse(loaded.raw)
    };
  } catch (err) {
    return {
      ...loaded,
      parseOk: false,
      json: null,
      errorCode: "json_parse_error",
      errorMessage: err?.message ?? String(err)
    };
  }
}

function normalizeMethod(value, fieldName) {
  const normalized = normalizeOptionalString(value);
  if (!normalized) throw new Error(`${fieldName} is required`);
  const method = normalized.toUpperCase();
  if (!ALLOWED_METHODS.includes(method)) {
    throw new Error(`${fieldName} must be one of ${ALLOWED_METHODS.join(", ")}`);
  }
  return method;
}

function normalizePolicyOperation(rawRow, index) {
  if (!isPlainObject(rawRow)) {
    throw new Error(`policy operations[${index}] must be an object`);
  }

  const operationId = normalizeOptionalString(rawRow.operationId);
  if (!operationId) throw new Error(`policy operations[${index}].operationId is required`);

  const route = normalizeOptionalString(rawRow.route);
  if (!route) throw new Error(`policy operations[${index}].route is required`);
  if (!route.startsWith("/")) {
    throw new Error(`policy operations[${index}].route must start with /`);
  }

  const method = normalizeMethod(rawRow.method, `policy operations[${index}].method`);

  if (!Array.isArray(rawRow.requiredReasonCodes) || rawRow.requiredReasonCodes.length === 0) {
    throw new Error(`policy operations[${index}].requiredReasonCodes must be a non-empty array`);
  }
  if (!Array.isArray(rawRow.mismatchReasonCodes) || rawRow.mismatchReasonCodes.length === 0) {
    throw new Error(`policy operations[${index}].mismatchReasonCodes must be a non-empty array`);
  }

  const requiredReasonCodes = uniqueSortedStrings(rawRow.requiredReasonCodes);
  const mismatchReasonCodes = uniqueSortedStrings(rawRow.mismatchReasonCodes);

  if (requiredReasonCodes.length === 0) {
    throw new Error(`policy operations[${index}].requiredReasonCodes must include at least one non-empty code`);
  }
  if (mismatchReasonCodes.length === 0) {
    throw new Error(`policy operations[${index}].mismatchReasonCodes must include at least one non-empty code`);
  }

  const expectedReasonCodes = uniqueSortedStrings([...requiredReasonCodes, ...mismatchReasonCodes]);

  return {
    operationId,
    route,
    method,
    requiredReasonCodes,
    mismatchReasonCodes,
    expectedReasonCodes
  };
}

function normalizePolicy(rawPolicy, policyPath) {
  if (!isPlainObject(rawPolicy)) {
    throw new Error(`policy at ${policyPath} must be a JSON object`);
  }

  if (rawPolicy.schemaVersion !== POLICY_SCHEMA_VERSION) {
    throw new Error(`policy schemaVersion must be ${POLICY_SCHEMA_VERSION}`);
  }

  const policyId = normalizeOptionalString(rawPolicy.policyId) ?? "nooterra-ns3-evidence-binding-coverage-policy";
  const updatedAt = parseIso8601(normalizeOptionalString(rawPolicy.updatedAt), "policy.updatedAt");

  if (!Array.isArray(rawPolicy.operations) || rawPolicy.operations.length === 0) {
    throw new Error("policy operations must be a non-empty array");
  }

  const seenOperationIds = new Set();
  const seenRouteMethods = new Set();
  const operations = [];

  for (let index = 0; index < rawPolicy.operations.length; index += 1) {
    const operation = normalizePolicyOperation(rawPolicy.operations[index], index);

    if (seenOperationIds.has(operation.operationId)) {
      throw new Error(`policy operationId must be unique; duplicate ${operation.operationId}`);
    }
    seenOperationIds.add(operation.operationId);

    const routeMethodKey = `${operation.method} ${operation.route}`;
    if (seenRouteMethods.has(routeMethodKey)) {
      throw new Error(`policy operations route+method must be unique; duplicate ${routeMethodKey}`);
    }
    seenRouteMethods.add(routeMethodKey);

    operations.push(operation);
  }

  operations.sort((a, b) => cmpString(a.operationId, b.operationId) || cmpString(a.route, b.route) || cmpString(a.method, b.method));

  return {
    schemaVersion: POLICY_SCHEMA_VERSION,
    policyId,
    updatedAt,
    policyPath,
    operations
  };
}

async function loadPolicy(policyPath) {
  const loaded = await loadJsonArtifact(policyPath);
  if (!loaded.readOk) {
    return {
      ok: false,
      policy: null,
      sourceSha256: null,
      errorCode: `policy_${loaded.errorCode}`,
      errorMessage: loaded.errorMessage
    };
  }

  if (!loaded.parseOk) {
    return {
      ok: false,
      policy: null,
      sourceSha256: loaded.sourceSha256,
      errorCode: "policy_json_parse_error",
      errorMessage: loaded.errorMessage
    };
  }

  try {
    return {
      ok: true,
      policy: normalizePolicy(loaded.json, policyPath),
      sourceSha256: loaded.sourceSha256,
      errorCode: null,
      errorMessage: null
    };
  } catch (err) {
    return {
      ok: false,
      policy: null,
      sourceSha256: loaded.sourceSha256,
      errorCode: "policy_invalid",
      errorMessage: err?.message ?? String(err)
    };
  }
}

function parseDocsCatalogCodes(raw) {
  const codes = new Set();
  for (const line of String(raw ?? "").split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    codes.add(trimmed);
  }
  return codes;
}

function extractKnownErrorCodesFromOpenApiOperation(operationNode) {
  if (!isPlainObject(operationNode)) return [];
  const out = new Set();
  const responses = isPlainObject(operationNode.responses) ? operationNode.responses : {};

  for (const response of Object.values(responses)) {
    if (!isPlainObject(response)) continue;
    const known = response["x-nooterra-known-error-codes"];
    if (!Array.isArray(known)) continue;
    for (const code of known) {
      const normalized = normalizeOptionalString(code);
      if (normalized) out.add(normalized);
    }
  }

  return Array.from(out).sort(cmpString);
}

function isNs3BindingReasonCode(code) {
  const normalized = normalizeOptionalString(code);
  if (!normalized || !normalized.startsWith("X402_")) return false;
  if (normalized.includes("BINDING")) return true;
  if (normalized.endsWith("_REQUEST_BINDING_REQUIRED")) return true;
  if (normalized.endsWith("_REQUEST_MISMATCH")) return true;
  return false;
}

function sanitizeIssueSuffix(value) {
  return String(value ?? "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function collectOpenApiBindingCoverageOperations(openapiBuilt) {
  if (!openapiBuilt.readOk || !openapiBuilt.parseOk || !isPlainObject(openapiBuilt.json?.paths)) return [];

  const operations = [];
  for (const [route, pathItem] of Object.entries(openapiBuilt.json.paths)) {
    if (typeof route !== "string" || !route.startsWith("/")) continue;
    if (!route.startsWith("/runs/") && !route.startsWith("/tool-calls/") && !route.startsWith("/x402/gate/")) continue;
    if (!isPlainObject(pathItem)) continue;

    for (const method of ALLOWED_METHODS) {
      const methodLower = method.toLowerCase();
      const operationNode = isPlainObject(pathItem[methodLower]) ? pathItem[methodLower] : null;
      if (!operationNode) continue;

      const knownReasonCodes = extractKnownErrorCodesFromOpenApiOperation(operationNode).filter(isNs3BindingReasonCode);
      if (knownReasonCodes.length === 0) continue;

      operations.push({
        route,
        method,
        operationId: normalizeOptionalString(operationNode.operationId),
        knownReasonCodes
      });
    }
  }

  operations.sort((a, b) => cmpString(a.route, b.route) || cmpString(a.method, b.method) || cmpString(a.operationId, b.operationId));
  return operations;
}

function evaluateOperationCoverage({ operation, runtimeSource, openapiSource, openapiBuilt, docsCatalog }) {
  const issues = [];
  const expectedReasonCodes = operation.expectedReasonCodes;

  const runtimeMissingReasonCodes = [];
  const runtimePresentReasonCodes = [];
  if (runtimeSource.readOk) {
    for (const code of expectedReasonCodes) {
      if (runtimeSource.raw.includes(code)) runtimePresentReasonCodes.push(code);
      else runtimeMissingReasonCodes.push(code);
    }
  } else {
    runtimeMissingReasonCodes.push(...expectedReasonCodes);
  }
  const runtimeOk = runtimeSource.readOk && runtimeMissingReasonCodes.length === 0;
  if (!runtimeSource.readOk) {
    issues.push({
      id: `${operation.operationId}:runtime:source_unavailable`,
      category: "gate",
      code: `runtime_${runtimeSource.errorCode ?? "unavailable"}`,
      message: "runtime source is unavailable",
      operationId: operation.operationId,
      route: operation.route,
      method: operation.method,
      dimension: "runtime"
    });
  } else if (runtimeMissingReasonCodes.length > 0) {
    issues.push({
      id: `${operation.operationId}:runtime:missing_reason_codes`,
      category: "coverage",
      code: "runtime_reason_codes_missing",
      message: `runtime source is missing reason codes: ${runtimeMissingReasonCodes.join(", ")}`,
      operationId: operation.operationId,
      route: operation.route,
      method: operation.method,
      dimension: "runtime"
    });
  }

  const routeLiteral = `"${operation.route}": {`;
  const openapiSourceRoutePresent = openapiSource.readOk && openapiSource.raw.includes(routeLiteral);
  const openapiSourceMissingReasonCodes = [];
  const openapiSourcePresentReasonCodes = [];
  if (openapiSource.readOk) {
    for (const code of expectedReasonCodes) {
      if (openapiSource.raw.includes(code)) openapiSourcePresentReasonCodes.push(code);
      else openapiSourceMissingReasonCodes.push(code);
    }
  } else {
    openapiSourceMissingReasonCodes.push(...expectedReasonCodes);
  }
  const openapiSourceOk = openapiSource.readOk && openapiSourceRoutePresent && openapiSourceMissingReasonCodes.length === 0;

  if (!openapiSource.readOk) {
    issues.push({
      id: `${operation.operationId}:openapi_source:unavailable`,
      category: "gate",
      code: `openapi_source_${openapiSource.errorCode ?? "unavailable"}`,
      message: "openapi source is unavailable",
      operationId: operation.operationId,
      route: operation.route,
      method: operation.method,
      dimension: "openapi"
    });
  } else {
    if (!openapiSourceRoutePresent) {
      issues.push({
        id: `${operation.operationId}:openapi_source:route_missing`,
        category: "coverage",
        code: "openapi_source_route_missing",
        message: `openapi source is missing route ${operation.route}`,
        operationId: operation.operationId,
        route: operation.route,
        method: operation.method,
        dimension: "openapi"
      });
    }
    if (openapiSourceMissingReasonCodes.length > 0) {
      issues.push({
        id: `${operation.operationId}:openapi_source:reason_codes_missing`,
        category: "coverage",
        code: "openapi_source_reason_codes_missing",
        message: `openapi source is missing reason codes: ${openapiSourceMissingReasonCodes.join(", ")}`,
        operationId: operation.operationId,
        route: operation.route,
        method: operation.method,
        dimension: "openapi"
      });
    }
  }

  const methodLower = operation.method.toLowerCase();
  const openapiPaths = openapiBuilt.readOk && openapiBuilt.parseOk && isPlainObject(openapiBuilt.json?.paths) ? openapiBuilt.json.paths : null;
  const openapiPathItem = openapiPaths && isPlainObject(openapiPaths[operation.route]) ? openapiPaths[operation.route] : null;
  const openapiOperationNode = openapiPathItem && isPlainObject(openapiPathItem[methodLower]) ? openapiPathItem[methodLower] : null;
  const openapiBuiltRoutePresent = Boolean(openapiPathItem);
  const openapiBuiltMethodPresent = Boolean(openapiOperationNode);
  const openapiBuiltKnownReasonCodes = extractKnownErrorCodesFromOpenApiOperation(openapiOperationNode);
  const openapiBuiltMissingReasonCodes = expectedReasonCodes.filter((code) => !openapiBuiltKnownReasonCodes.includes(code));
  const observedOperationId = normalizeOptionalString(openapiOperationNode?.operationId);
  const operationIdMatch = observedOperationId === null ? null : observedOperationId === operation.operationId;

  const openapiBuiltOk =
    openapiBuilt.readOk &&
    openapiBuilt.parseOk &&
    openapiBuiltRoutePresent &&
    openapiBuiltMethodPresent &&
    openapiBuiltMissingReasonCodes.length === 0 &&
    operationIdMatch !== false;

  if (!openapiBuilt.readOk) {
    issues.push({
      id: `${operation.operationId}:openapi_built:unavailable`,
      category: "gate",
      code: `openapi_built_${openapiBuilt.errorCode ?? "unavailable"}`,
      message: "built openapi artifact is unavailable",
      operationId: operation.operationId,
      route: operation.route,
      method: operation.method,
      dimension: "openapi"
    });
  } else if (!openapiBuilt.parseOk) {
    issues.push({
      id: `${operation.operationId}:openapi_built:invalid_json`,
      category: "gate",
      code: "openapi_built_invalid_json",
      message: "built openapi artifact is invalid JSON",
      operationId: operation.operationId,
      route: operation.route,
      method: operation.method,
      dimension: "openapi"
    });
  } else {
    if (!openapiBuiltRoutePresent || !openapiBuiltMethodPresent) {
      issues.push({
        id: `${operation.operationId}:openapi_built:operation_missing`,
        category: "coverage",
        code: "openapi_built_operation_missing",
        message: `built openapi artifact is missing ${operation.method} ${operation.route}`,
        operationId: operation.operationId,
        route: operation.route,
        method: operation.method,
        dimension: "openapi"
      });
    }
    if (openapiBuiltMethodPresent && openapiBuiltMissingReasonCodes.length > 0) {
      issues.push({
        id: `${operation.operationId}:openapi_built:reason_codes_missing`,
        category: "coverage",
        code: "openapi_built_reason_codes_missing",
        message: `built openapi artifact is missing known reason codes: ${openapiBuiltMissingReasonCodes.join(", ")}`,
        operationId: operation.operationId,
        route: operation.route,
        method: operation.method,
        dimension: "openapi"
      });
    }
    if (operationIdMatch === false) {
      issues.push({
        id: `${operation.operationId}:openapi_built:operation_id_mismatch`,
        category: "coverage",
        code: "openapi_built_operation_id_mismatch",
        message: `built openapi operationId mismatch (expected ${operation.operationId}, observed ${observedOperationId})`,
        operationId: operation.operationId,
        route: operation.route,
        method: operation.method,
        dimension: "openapi"
      });
    }
  }

  const openapiOk = openapiSourceOk && openapiBuiltOk;

  let docsCodes = null;
  let docsParseError = null;
  if (docsCatalog.readOk) {
    try {
      docsCodes = parseDocsCatalogCodes(docsCatalog.raw);
    } catch (err) {
      docsParseError = err?.message ?? String(err);
    }
  }

  const docsMissingReasonCodes = [];
  const docsPresentReasonCodes = [];
  if (docsCodes) {
    for (const code of expectedReasonCodes) {
      if (docsCodes.has(code)) docsPresentReasonCodes.push(code);
      else docsMissingReasonCodes.push(code);
    }
  } else {
    docsMissingReasonCodes.push(...expectedReasonCodes);
  }

  const docsCatalogOk = docsCatalog.readOk && !docsParseError && docsMissingReasonCodes.length === 0;
  if (!docsCatalog.readOk) {
    issues.push({
      id: `${operation.operationId}:docs_catalog:unavailable`,
      category: "gate",
      code: `docs_catalog_${docsCatalog.errorCode ?? "unavailable"}`,
      message: "docs x402 error code catalog is unavailable",
      operationId: operation.operationId,
      route: operation.route,
      method: operation.method,
      dimension: "docsCatalog"
    });
  } else if (docsParseError) {
    issues.push({
      id: `${operation.operationId}:docs_catalog:parse_error`,
      category: "gate",
      code: "docs_catalog_parse_error",
      message: docsParseError,
      operationId: operation.operationId,
      route: operation.route,
      method: operation.method,
      dimension: "docsCatalog"
    });
  } else if (docsMissingReasonCodes.length > 0) {
    issues.push({
      id: `${operation.operationId}:docs_catalog:reason_codes_missing`,
      category: "coverage",
      code: "docs_catalog_reason_codes_missing",
      message: `docs x402 error code catalog is missing reason codes: ${docsMissingReasonCodes.join(", ")}`,
      operationId: operation.operationId,
      route: operation.route,
      method: operation.method,
      dimension: "docsCatalog"
    });
  }

  const strictCoverageOk = runtimeOk && openapiOk && docsCatalogOk;

  return {
    check: {
      operationId: operation.operationId,
      route: operation.route,
      method: operation.method,
      requiredReasonCodes: operation.requiredReasonCodes,
      mismatchReasonCodes: operation.mismatchReasonCodes,
      expectedReasonCodes,
      strictCoverageOk,
      dimensions: {
        runtime: {
          ok: runtimeOk,
          presentReasonCodes: runtimePresentReasonCodes,
          missingReasonCodes: runtimeMissingReasonCodes
        },
        openapi: {
          ok: openapiOk,
          source: {
            ok: openapiSourceOk,
            routePresent: openapiSourceRoutePresent,
            presentReasonCodes: openapiSourcePresentReasonCodes,
            missingReasonCodes: openapiSourceMissingReasonCodes
          },
          built: {
            ok: openapiBuiltOk,
            routePresent: openapiBuiltRoutePresent,
            methodPresent: openapiBuiltMethodPresent,
            operationId: observedOperationId,
            operationIdMatch,
            knownReasonCodes: openapiBuiltKnownReasonCodes,
            missingReasonCodes: openapiBuiltMissingReasonCodes
          }
        },
        docsCatalog: {
          ok: docsCatalogOk,
          presentReasonCodes: docsPresentReasonCodes,
          missingReasonCodes: docsMissingReasonCodes
        }
      },
      issueIds: issues.map((issue) => issue.id).sort(cmpString)
    },
    issues
  };
}

function summarizeSource(artifact, { includeParseState = false } = {}) {
  const base = {
    path: artifact.path,
    sourceSha256: artifact.sourceSha256,
    readOk: artifact.readOk,
    errorCode: artifact.errorCode,
    errorMessage: artifact.errorMessage
  };
  if (includeParseState) {
    base.parseOk = artifact.parseOk;
  }
  return base;
}

async function evaluateDriftOverride({ overridePath, nowIso }) {
  if (!overridePath) {
    return {
      provided: false,
      path: null,
      accepted: false,
      sourceSha256: null,
      schemaVersion: null,
      ticket: null,
      reason: null,
      approvedBy: null,
      approvedAt: null,
      expiresAt: null,
      errorCodes: []
    };
  }

  const loaded = await loadJsonArtifact(overridePath);
  if (!loaded.readOk) {
    return {
      provided: true,
      path: overridePath,
      accepted: false,
      sourceSha256: null,
      schemaVersion: null,
      ticket: null,
      reason: null,
      approvedBy: null,
      approvedAt: null,
      expiresAt: null,
      errorCodes: [`override_${loaded.errorCode}`],
      detail: loaded.errorMessage
    };
  }

  if (!loaded.parseOk) {
    return {
      provided: true,
      path: overridePath,
      accepted: false,
      sourceSha256: loaded.sourceSha256,
      schemaVersion: null,
      ticket: null,
      reason: null,
      approvedBy: null,
      approvedAt: null,
      expiresAt: null,
      errorCodes: ["override_json_parse_error"],
      detail: loaded.errorMessage
    };
  }

  const override = loaded.json;
  const errorCodes = [];

  if (override?.schemaVersion !== DRIFT_OVERRIDE_SCHEMA_VERSION) {
    errorCodes.push("override_schema_invalid");
  }

  const ticket = normalizeOptionalString(override?.ticket);
  const reason = normalizeOptionalString(override?.reason);
  const approvedBy = normalizeOptionalString(override?.approvedBy);
  const approvedAtRaw = normalizeOptionalString(override?.approvedAt);
  const expiresAtRaw = normalizeOptionalString(override?.expiresAt);

  if (!ticket) errorCodes.push("override_ticket_missing");
  if (!reason) errorCodes.push("override_reason_missing");
  if (!approvedBy) errorCodes.push("override_approved_by_missing");
  if (!approvedAtRaw) errorCodes.push("override_approved_at_missing");
  if (!expiresAtRaw) errorCodes.push("override_expires_at_missing");

  let approvedAtIso = null;
  let expiresAtIso = null;
  let approvedAtEpochMs = null;
  let expiresAtEpochMs = null;

  if (approvedAtRaw) {
    approvedAtEpochMs = Date.parse(approvedAtRaw);
    if (!Number.isFinite(approvedAtEpochMs)) {
      errorCodes.push("override_approved_at_invalid");
    } else {
      approvedAtIso = new Date(approvedAtEpochMs).toISOString();
    }
  }

  if (expiresAtRaw) {
    expiresAtEpochMs = Date.parse(expiresAtRaw);
    if (!Number.isFinite(expiresAtEpochMs)) {
      errorCodes.push("override_expires_at_invalid");
    } else {
      expiresAtIso = new Date(expiresAtEpochMs).toISOString();
    }
  }

  const nowEpochMs = Date.parse(nowIso);
  if (Number.isFinite(expiresAtEpochMs) && Number.isFinite(nowEpochMs) && expiresAtEpochMs <= nowEpochMs) {
    errorCodes.push("override_expired");
  }

  if (Number.isFinite(approvedAtEpochMs) && Number.isFinite(expiresAtEpochMs) && expiresAtEpochMs <= approvedAtEpochMs) {
    errorCodes.push("override_expiry_not_after_approved_at");
  }

  errorCodes.sort(cmpString);

  return {
    provided: true,
    path: overridePath,
    accepted: errorCodes.length === 0,
    sourceSha256: loaded.sourceSha256,
    schemaVersion: typeof override?.schemaVersion === "string" ? override.schemaVersion : null,
    ticket,
    reason,
    approvedBy,
    approvedAt: approvedAtIso,
    expiresAt: expiresAtIso,
    errorCodes
  };
}

function buildDeterministicCore(report) {
  const checks = Array.isArray(report?.checks) ? report.checks : [];

  const normalizedChecks = checks
    .map((row) => ({
      operationId: normalizeOptionalString(row?.operationId),
      route: normalizeOptionalString(row?.route),
      method: normalizeOptionalString(row?.method),
      strictCoverageOk: row?.strictCoverageOk === true,
      expectedReasonCodes: uniqueSortedStrings(Array.isArray(row?.expectedReasonCodes) ? row.expectedReasonCodes : []),
      dimensions: {
        runtime: {
          ok: row?.dimensions?.runtime?.ok === true,
          missingReasonCodes: uniqueSortedStrings(Array.isArray(row?.dimensions?.runtime?.missingReasonCodes) ? row.dimensions.runtime.missingReasonCodes : [])
        },
        openapi: {
          ok: row?.dimensions?.openapi?.ok === true,
          source: {
            ok: row?.dimensions?.openapi?.source?.ok === true,
            routePresent: row?.dimensions?.openapi?.source?.routePresent === true,
            missingReasonCodes: uniqueSortedStrings(
              Array.isArray(row?.dimensions?.openapi?.source?.missingReasonCodes) ? row.dimensions.openapi.source.missingReasonCodes : []
            )
          },
          built: {
            ok: row?.dimensions?.openapi?.built?.ok === true,
            routePresent: row?.dimensions?.openapi?.built?.routePresent === true,
            methodPresent: row?.dimensions?.openapi?.built?.methodPresent === true,
            operationId: normalizeOptionalString(row?.dimensions?.openapi?.built?.operationId),
            operationIdMatch: row?.dimensions?.openapi?.built?.operationIdMatch === null ? null : row?.dimensions?.openapi?.built?.operationIdMatch === true,
            missingReasonCodes: uniqueSortedStrings(
              Array.isArray(row?.dimensions?.openapi?.built?.missingReasonCodes) ? row.dimensions.openapi.built.missingReasonCodes : []
            )
          }
        },
        docsCatalog: {
          ok: row?.dimensions?.docsCatalog?.ok === true,
          missingReasonCodes: uniqueSortedStrings(Array.isArray(row?.dimensions?.docsCatalog?.missingReasonCodes) ? row.dimensions.docsCatalog.missingReasonCodes : [])
        }
      }
    }))
    .sort((a, b) => cmpString(a.operationId, b.operationId) || cmpString(a.route, b.route) || cmpString(a.method, b.method));

  const blockingIssueIds = Array.isArray(report?.blockingIssues)
    ? report.blockingIssues.map((issue) => normalizeIssue(issue).id).sort(cmpString)
    : [];

  return normalizeForCanonicalJson({
    schemaVersion: REPORT_SCHEMA_VERSION,
    policy: {
      schemaVersion: normalizeOptionalString(report?.policy?.schemaVersion),
      policyId: normalizeOptionalString(report?.policy?.policyId),
      operations: Array.isArray(report?.policy?.operations)
        ? report.policy.operations
            .map((op) => ({
              operationId: normalizeOptionalString(op?.operationId),
              route: normalizeOptionalString(op?.route),
              method: normalizeOptionalString(op?.method),
              requiredReasonCodes: uniqueSortedStrings(Array.isArray(op?.requiredReasonCodes) ? op.requiredReasonCodes : []),
              mismatchReasonCodes: uniqueSortedStrings(Array.isArray(op?.mismatchReasonCodes) ? op.mismatchReasonCodes : [])
            }))
            .sort((a, b) => cmpString(a.operationId, b.operationId) || cmpString(a.route, b.route) || cmpString(a.method, b.method))
        : []
    },
    checks: normalizedChecks,
    driftGate: {
      schemaVersion: DRIFT_GATE_SCHEMA_VERSION,
      strictOk: report?.strictOk === true,
      okWithOverride: report?.okWithOverride === true,
      overrideApplied: report?.driftGate?.overrideApplied === true,
      blockingIssueIds
    }
  });
}

export async function runNs3EvidenceBindingCoverageMatrix(args, env = process.env, cwd = process.cwd()) {
  const nowIso =
    args.nowIso ??
    parseIso8601(normalizeOptionalString(env.NS3_EVIDENCE_BINDING_COVERAGE_MATRIX_NOW), "NS3_EVIDENCE_BINDING_COVERAGE_MATRIX_NOW") ??
    new Date().toISOString();

  const policyLoad = await loadPolicy(args.policyPath);
  const policy = policyLoad.policy;

  const runtimeSource = await loadTextArtifact(path.resolve(cwd, RUNTIME_SOURCE_PATH));
  const openapiSource = await loadTextArtifact(path.resolve(cwd, OPENAPI_SOURCE_PATH));
  const openapiBuilt = await loadJsonArtifact(path.resolve(cwd, OPENAPI_BUILT_PATH));
  const docsCatalog = await loadTextArtifact(path.resolve(cwd, DOCS_CATALOG_PATH));

  const issues = [];
  if (!policyLoad.ok) {
    issues.push({
      id: "policy:invalid",
      category: "gate",
      code: policyLoad.errorCode,
      message: policyLoad.errorMessage,
      dimension: "policy"
    });
  }

  const checks = [];
  if (policy) {
    for (const operation of policy.operations) {
      const evaluated = evaluateOperationCoverage({
        operation,
        runtimeSource,
        openapiSource,
        openapiBuilt,
        docsCatalog
      });
      checks.push(evaluated.check);
      issues.push(...evaluated.issues);
    }

    const policyRouteMethodSet = new Set(policy.operations.map((operation) => `${operation.method} ${operation.route}`));
    const openapiBindingCoverageOperations = collectOpenApiBindingCoverageOperations(openapiBuilt);
    for (const operation of openapiBindingCoverageOperations) {
      const routeMethodKey = `${operation.method} ${operation.route}`;
      if (policyRouteMethodSet.has(routeMethodKey)) continue;
      const suffix = sanitizeIssueSuffix(routeMethodKey);
      issues.push({
        id: `policy:openapi_binding_surface_missing:${suffix}`,
        category: "coverage",
        code: "policy_operation_missing_for_openapi_binding_surface",
        message: `policy is missing ${routeMethodKey} required by openapi binding surface`,
        operationId: operation.operationId,
        route: operation.route,
        method: operation.method,
        dimension: "policy"
      });
    }
  }

  checks.sort((a, b) => cmpString(a.operationId, b.operationId) || cmpString(a.route, b.route) || cmpString(a.method, b.method));

  const override = await evaluateDriftOverride({
    overridePath: args.driftOverridePath,
    nowIso
  });

  const blockingIssues = sortIssues(issues);
  const strictOk = blockingIssues.length === 0;
  const onlyCoverageIssues = !strictOk && blockingIssues.every((issue) => issue.category === "coverage");
  const overrideApplied = !strictOk && override.accepted === true && onlyCoverageIssues;
  const okWithOverride = strictOk || overrideApplied;

  const driftGate = {
    schemaVersion: DRIFT_GATE_SCHEMA_VERSION,
    strictOk,
    okWithOverride,
    overrideApplied,
    override,
    blockingIssues
  };

  const report = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: nowIso,
    ok: okWithOverride,
    strictOk,
    okWithOverride,
    policy: policy
      ? {
          schemaVersion: policy.schemaVersion,
          policyId: policy.policyId,
          updatedAt: policy.updatedAt,
          policyPath: policy.policyPath,
          sourceSha256: policyLoad.sourceSha256,
          operations: policy.operations
        }
      : {
          schemaVersion: POLICY_SCHEMA_VERSION,
          policyId: null,
          updatedAt: null,
          policyPath: args.policyPath,
          sourceSha256: policyLoad.sourceSha256,
          operations: []
        },
    sources: {
      runtime: summarizeSource(runtimeSource),
      openapiSource: summarizeSource(openapiSource),
      openapiBuilt: summarizeSource(openapiBuilt, { includeParseState: true }),
      docsCatalog: summarizeSource(docsCatalog)
    },
    checks,
    blockingIssues,
    driftGate
  };

  const deterministicCore = buildDeterministicCore(report);
  report.artifactHashScope = DETERMINISTIC_CORE_SCHEMA_VERSION;
  report.artifactHash = sha256Hex(canonicalJsonStringify(deterministicCore));
  report.deterministicCore = {
    schemaVersion: DETERMINISTIC_CORE_SCHEMA_VERSION,
    sha256: report.artifactHash,
    core: deterministicCore
  };

  const reportPath = path.resolve(cwd, args.reportPath);
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  return {
    report,
    reportPath
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const { report, reportPath } = await runNs3EvidenceBindingCoverageMatrix(args, process.env, process.cwd());
  process.stdout.write(
    `${JSON.stringify(
      {
        schemaVersion: report.schemaVersion,
        strictOk: report.strictOk,
        okWithOverride: report.okWithOverride,
        checkCount: Array.isArray(report.checks) ? report.checks.length : 0,
        blockingIssueCount: Array.isArray(report.blockingIssues) ? report.blockingIssues.length : 0,
        reportPath
      },
      null,
      2
    )}\n`
  );
  if (!report.strictOk && !report.okWithOverride) process.exitCode = 1;
}

const isDirectExecution = (() => {
  try {
    return import.meta.url === new URL(`file://${process.argv[1]}`).href;
  } catch {
    return false;
  }
})();

if (isDirectExecution) {
  main().catch((err) => {
    process.stderr.write(`${err?.stack ?? err?.message ?? String(err)}\n`);
    process.exit(1);
  });
}
