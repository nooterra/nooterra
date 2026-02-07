import { PRODUCE_ERROR_CODE, PRODUCE_ERROR_CODES_V1 } from "./produce-error-codes.js";

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim() !== "";
}

const CAUSE_KIND = Object.freeze({
  SIGNER: "signer",
  PLUGIN: "plugin",
  VERIFY: "verify",
  INPUT: "input",
  IO: "io",
  INTERNAL: "internal"
});

const CAUSE_CODE = Object.freeze({
  UNCLASSIFIED: "UNCLASSIFIED",

  INVALID_ARGS: "INVALID_ARGS",
  INVALID_SIGNER_AUTH_MODE: "INVALID_SIGNER_AUTH_MODE",
  KEYPAIRS_MISSING_KEY: "KEYPAIRS_MISSING_KEY",

  REMOTE_SIGNER_AUTH_MISSING: "REMOTE_SIGNER_AUTH_MISSING",
  REMOTE_SIGNER_AUTH_FAILED: "REMOTE_SIGNER_AUTH_FAILED",
  REMOTE_SIGNER_TIMEOUT: "REMOTE_SIGNER_TIMEOUT",
  REMOTE_SIGNER_UNREACHABLE: "REMOTE_SIGNER_UNREACHABLE",
  REMOTE_SIGNER_HTTP_ERROR: "REMOTE_SIGNER_HTTP_ERROR",
  REMOTE_SIGNER_BAD_JSON: "REMOTE_SIGNER_BAD_JSON",
  REMOTE_SIGNER_KEY_MISMATCH: "REMOTE_SIGNER_KEY_MISMATCH",
  REMOTE_SIGNER_BAD_PUBLIC_KEY: "REMOTE_SIGNER_BAD_PUBLIC_KEY",
  REMOTE_SIGNER_BAD_SIGNATURE: "REMOTE_SIGNER_BAD_SIGNATURE",
  REMOTE_SIGNER_MESSAGE_TOO_LARGE: "REMOTE_SIGNER_MESSAGE_TOO_LARGE",
  REMOTE_SIGNER_RESPONSE_TOO_LARGE: "REMOTE_SIGNER_RESPONSE_TOO_LARGE",

  SIGNER_COMMAND_TIMEOUT: "SIGNER_COMMAND_TIMEOUT",
  SIGNER_COMMAND_SPAWN_FAILED: "SIGNER_COMMAND_SPAWN_FAILED",
  SIGNER_COMMAND_FAILED: "SIGNER_COMMAND_FAILED",
  SIGNER_COMMAND_BAD_JSON: "SIGNER_COMMAND_BAD_JSON",

  SIGNER_PLUGIN_LOAD_FAILED: "SIGNER_PLUGIN_LOAD_FAILED",
  SIGNER_PLUGIN_MISSING_EXPORT: "SIGNER_PLUGIN_MISSING_EXPORT",
  SIGNER_PLUGIN_INIT_FAILED: "SIGNER_PLUGIN_INIT_FAILED",
  SIGNER_PLUGIN_INVALID_PROVIDER: "SIGNER_PLUGIN_INVALID_PROVIDER"
});

function normalizeCauseCode(raw) {
  const code = isNonEmptyString(raw) ? raw.trim() : null;
  if (!code) return CAUSE_CODE.UNCLASSIFIED;
  if (Object.prototype.hasOwnProperty.call(CAUSE_CODE, code)) return CAUSE_CODE[code];
  // allow internal code to pass through only if it matches one of the values above
  if (Object.values(CAUSE_CODE).includes(code)) return code;
  return CAUSE_CODE.UNCLASSIFIED;
}

function normalizeErrorCode(rawCode) {
  const code = isNonEmptyString(rawCode) ? rawCode.trim() : null;
  if (code && PRODUCE_ERROR_CODES_V1.includes(code)) return code;

  switch (code) {
    // Remote signer (HTTP)
    case "REMOTE_SIGNER_AUTH_MISSING":
      return PRODUCE_ERROR_CODE.SIGNER_AUTH_MISSING;
    case "REMOTE_SIGNER_AUTH_FAILED":
      return PRODUCE_ERROR_CODE.SIGNER_AUTH_FAILED;
    case "REMOTE_SIGNER_TIMEOUT":
      return PRODUCE_ERROR_CODE.SIGNER_TIMEOUT;
    case "REMOTE_SIGNER_UNREACHABLE":
      return PRODUCE_ERROR_CODE.SIGNER_UNREACHABLE;
    case "REMOTE_SIGNER_HTTP_ERROR":
    case "REMOTE_SIGNER_BAD_JSON":
    case "REMOTE_SIGNER_KEY_MISMATCH":
    case "REMOTE_SIGNER_BAD_PUBLIC_KEY":
    case "REMOTE_SIGNER_BAD_SIGNATURE":
      return PRODUCE_ERROR_CODE.SIGNER_BAD_RESPONSE;
    case "REMOTE_SIGNER_MESSAGE_TOO_LARGE":
      return PRODUCE_ERROR_CODE.SIGNER_MESSAGE_TOO_LARGE;
    case "REMOTE_SIGNER_RESPONSE_TOO_LARGE":
      return PRODUCE_ERROR_CODE.SIGNER_RESPONSE_TOO_LARGE;

    // Remote signer (process/stdio)
    case "SIGNER_COMMAND_TIMEOUT":
      return PRODUCE_ERROR_CODE.SIGNER_TIMEOUT;
    case "SIGNER_COMMAND_SPAWN_FAILED":
      return PRODUCE_ERROR_CODE.SIGNER_UNREACHABLE;
    case "SIGNER_COMMAND_FAILED":
    case "SIGNER_COMMAND_BAD_JSON":
      return PRODUCE_ERROR_CODE.SIGNER_BAD_RESPONSE;

    // Usage/inputs
    case "INVALID_ARGS":
    case "INVALID_SIGNER_AUTH_MODE":
    case "KEYPAIRS_MISSING_KEY":
      return PRODUCE_ERROR_CODE.PRODUCE_FAILED;

    default:
      return PRODUCE_ERROR_CODE.PRODUCE_FAILED;
  }
}

function causeKindFor({ stableCode, rawCauseCode }) {
  if (stableCode === PRODUCE_ERROR_CODE.VERIFY_AFTER_FAILED) return CAUSE_KIND.VERIFY;
  if (stableCode.startsWith("SIGNER_PLUGIN_")) return CAUSE_KIND.PLUGIN;
  if (stableCode.startsWith("SIGNER_")) return CAUSE_KIND.SIGNER;
  if (rawCauseCode === "INVALID_ARGS" || rawCauseCode === "INVALID_SIGNER_AUTH_MODE") return CAUSE_KIND.INPUT;
  if (rawCauseCode === "KEYPAIRS_MISSING_KEY") return CAUSE_KIND.INPUT;
  return CAUSE_KIND.INTERNAL;
}

function defaultMessageForCode(code) {
  switch (code) {
    case PRODUCE_ERROR_CODE.SIGNER_AUTH_MISSING:
      return "remote signer auth configured but token missing";
    case PRODUCE_ERROR_CODE.SIGNER_AUTH_FAILED:
      return "remote signer auth failed";
    case PRODUCE_ERROR_CODE.SIGNER_TIMEOUT:
      return "signer call timed out";
    case PRODUCE_ERROR_CODE.SIGNER_UNREACHABLE:
      return "signer could not be reached";
    case PRODUCE_ERROR_CODE.SIGNER_BAD_RESPONSE:
      return "signer returned an invalid response";
    case PRODUCE_ERROR_CODE.SIGNER_MESSAGE_TOO_LARGE:
      return "signing request message exceeds max size";
    case PRODUCE_ERROR_CODE.SIGNER_RESPONSE_TOO_LARGE:
      return "signer response exceeds max size";
    case PRODUCE_ERROR_CODE.SIGNER_PLUGIN_LOAD_FAILED:
      return "failed to load signer plugin";
    case PRODUCE_ERROR_CODE.SIGNER_PLUGIN_MISSING_EXPORT:
      return "signer plugin missing export";
    case PRODUCE_ERROR_CODE.SIGNER_PLUGIN_INIT_FAILED:
      return "signer plugin init failed";
    case PRODUCE_ERROR_CODE.SIGNER_PLUGIN_INVALID_PROVIDER:
      return "signer plugin returned invalid provider";
    case PRODUCE_ERROR_CODE.VERIFY_AFTER_FAILED:
      return "verify-after failed";
    case PRODUCE_ERROR_CODE.PRODUCE_FAILED:
    default:
      return "produce failed";
  }
}

export function issueFromError(err) {
  const rawCauseCode = isNonEmptyString(err?.code) ? String(err.code).trim() : null;
  const stableCode = normalizeErrorCode(rawCauseCode);
  const message = defaultMessageForCode(stableCode);
  const causeCode = normalizeCauseCode(rawCauseCode);
  const causeKind = causeKindFor({ stableCode, rawCauseCode: causeCode });

  return {
    code: stableCode,
    path: null,
    message,
    causeKind,
    causeCode,
    detail: null
  };
}
