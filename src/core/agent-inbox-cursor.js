import { canonicalJsonStringify, normalizeForCanonicalJson } from "./canonical-json.js";

export const AGENT_INBOX_CURSOR_SCHEMA_VERSION = "AgentInboxCursor.v1";

export const AGENT_INBOX_CURSOR_ERROR_CODE = Object.freeze({
  INVALID: "AGENT_INBOX_CURSOR_INVALID",
  TOKEN_INVALID: "AGENT_INBOX_CURSOR_TOKEN_INVALID",
  VERSION_UNSUPPORTED: "AGENT_INBOX_CURSOR_VERSION_UNSUPPORTED",
  CHANNEL_MISMATCH: "AGENT_INBOX_CURSOR_CHANNEL_MISMATCH"
});

const CURSOR_TOKEN_VERSION = 1;
const CHANNEL_PATTERN = /^[A-Za-z0-9:_./-]+$/;
const MESSAGE_ID_PATTERN = /^[A-Za-z0-9:_./-]+$/;

function createCursorError(message, code) {
  const err = new TypeError(String(message ?? "invalid agent inbox cursor"));
  err.code = code;
  return err;
}

function normalizeString(value, name, { max = 200, pattern = null } = {}) {
  if (typeof value !== "string") throw createCursorError(`${name} must be a string`, AGENT_INBOX_CURSOR_ERROR_CODE.INVALID);
  const out = value.trim();
  if (!out) throw createCursorError(`${name} must be a non-empty string`, AGENT_INBOX_CURSOR_ERROR_CODE.INVALID);
  if (out.length > max) throw createCursorError(`${name} must be <= ${max} characters`, AGENT_INBOX_CURSOR_ERROR_CODE.INVALID);
  if (pattern && !pattern.test(out)) {
    throw createCursorError(`${name} must match ${pattern}`, AGENT_INBOX_CURSOR_ERROR_CODE.INVALID);
  }
  return out;
}

function normalizeSeq(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw createCursorError(`${name} must be a positive safe integer`, AGENT_INBOX_CURSOR_ERROR_CODE.INVALID);
  }
  return value;
}

function normalizeDateTime(value, name) {
  const raw = normalizeString(value, name, { max: 64 });
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw createCursorError(`${name} must be an ISO date-time`, AGENT_INBOX_CURSOR_ERROR_CODE.INVALID);
  }
  return date.toISOString();
}

export function normalizeAgentInboxCursorV1(value, { allowNull = false, name = "cursor" } = {}) {
  if (value === null || value === undefined) {
    if (allowNull) return null;
    throw createCursorError(`${name} is required`, AGENT_INBOX_CURSOR_ERROR_CODE.INVALID);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw createCursorError(`${name} must be an object`, AGENT_INBOX_CURSOR_ERROR_CODE.INVALID);
  }
  const schemaVersion = normalizeString(value.schemaVersion, `${name}.schemaVersion`, { max: 128 });
  if (schemaVersion !== AGENT_INBOX_CURSOR_SCHEMA_VERSION) {
    throw createCursorError(
      `${name}.schemaVersion must be ${AGENT_INBOX_CURSOR_SCHEMA_VERSION}`,
      AGENT_INBOX_CURSOR_ERROR_CODE.VERSION_UNSUPPORTED
    );
  }
  return normalizeForCanonicalJson(
    {
      schemaVersion: AGENT_INBOX_CURSOR_SCHEMA_VERSION,
      channel: normalizeString(value.channel, `${name}.channel`, { max: 200, pattern: CHANNEL_PATTERN }),
      seq: normalizeSeq(value.seq, `${name}.seq`),
      messageId: normalizeString(value.messageId, `${name}.messageId`, { max: 200, pattern: MESSAGE_ID_PATTERN }),
      publishedAt: normalizeDateTime(value.publishedAt, `${name}.publishedAt`)
    },
    { path: "$.agentInboxCursor" }
  );
}

export function buildAgentInboxCursorV1({ channel, seq, messageId, publishedAt } = {}) {
  return normalizeAgentInboxCursorV1(
    {
      schemaVersion: AGENT_INBOX_CURSOR_SCHEMA_VERSION,
      channel,
      seq,
      messageId,
      publishedAt
    },
    { name: "cursor" }
  );
}

export function encodeAgentInboxCursorV1(cursor) {
  const normalized = normalizeAgentInboxCursorV1(cursor);
  const encoded = Buffer.from(
    canonicalJsonStringify(
      normalizeForCanonicalJson(
        {
          v: CURSOR_TOKEN_VERSION,
          cursor: normalized
        },
        { path: "$.cursorToken" }
      )
    ),
    "utf8"
  ).toString("base64url");
  return encoded;
}

export function decodeAgentInboxCursorV1(raw, { allowNull = false } = {}) {
  if (raw === null || raw === undefined || String(raw).trim() === "") {
    if (allowNull) return null;
    throw createCursorError("cursor is required", AGENT_INBOX_CURSOR_ERROR_CODE.INVALID);
  }
  const token = String(raw).trim();
  let decodedText;
  try {
    decodedText = Buffer.from(token, "base64url").toString("utf8");
  } catch (err) {
    throw createCursorError(`cursor token is not valid base64url: ${err?.message ?? String(err ?? "")}`, AGENT_INBOX_CURSOR_ERROR_CODE.TOKEN_INVALID);
  }
  let parsed;
  try {
    parsed = JSON.parse(decodedText);
  } catch (err) {
    throw createCursorError(`cursor token JSON is invalid: ${err?.message ?? String(err ?? "")}`, AGENT_INBOX_CURSOR_ERROR_CODE.TOKEN_INVALID);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw createCursorError("cursor token payload must be an object", AGENT_INBOX_CURSOR_ERROR_CODE.TOKEN_INVALID);
  }
  if (parsed.v !== CURSOR_TOKEN_VERSION) {
    throw createCursorError(
      `cursor token version must be ${CURSOR_TOKEN_VERSION}`,
      AGENT_INBOX_CURSOR_ERROR_CODE.VERSION_UNSUPPORTED
    );
  }
  return normalizeAgentInboxCursorV1(parsed.cursor, { name: "cursorToken.cursor" });
}

export function cursorFromAgentInboxMessage(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    throw createCursorError("message must be an object", AGENT_INBOX_CURSOR_ERROR_CODE.INVALID);
  }
  return buildAgentInboxCursorV1({
    channel: message.channel,
    seq: message.seq,
    messageId: message.messageId,
    publishedAt: message.publishedAt
  });
}

export function compareAgentInboxCursorV1(left, right) {
  const a = normalizeAgentInboxCursorV1(left, { name: "leftCursor" });
  const b = normalizeAgentInboxCursorV1(right, { name: "rightCursor" });
  if (a.channel !== b.channel) {
    throw createCursorError("cursor channel mismatch", AGENT_INBOX_CURSOR_ERROR_CODE.CHANNEL_MISMATCH);
  }
  if (a.seq !== b.seq) return a.seq < b.seq ? -1 : 1;
  if (a.messageId === b.messageId) return 0;
  return a.messageId < b.messageId ? -1 : 1;
}
