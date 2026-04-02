import { canonicalJsonStringify, normalizeForCanonicalJson } from "./canonical-json.js";
import { sha256Hex } from "./crypto.js";
import {
  AGENT_INBOX_CURSOR_ERROR_CODE,
  AGENT_INBOX_CURSOR_SCHEMA_VERSION,
  buildAgentInboxCursorV1,
  cursorFromAgentInboxMessage,
  decodeAgentInboxCursorV1,
  encodeAgentInboxCursorV1,
  normalizeAgentInboxCursorV1
} from "./agent-inbox-cursor.js";

export const AGENT_INBOX_MESSAGE_SCHEMA_VERSION = "AgentInboxMessage.v1";
export const AGENT_INBOX_STATE_SCHEMA_VERSION = "AgentInboxState.v1";

export const AGENT_INBOX_REASON_CODE = Object.freeze({
  STATE_INVALID: "AGENT_INBOX_STATE_INVALID",
  CHANNEL_INVALID: "AGENT_INBOX_CHANNEL_INVALID",
  CONSUMER_INVALID: "AGENT_INBOX_CONSUMER_INVALID",
  IDEMPOTENCY_KEY_INVALID: "AGENT_INBOX_IDEMPOTENCY_KEY_INVALID",
  IDEMPOTENCY_CONFLICT: "AGENT_INBOX_IDEMPOTENCY_CONFLICT",
  PAYLOAD_INVALID: "AGENT_INBOX_PAYLOAD_INVALID",
  LIMIT_INVALID: "AGENT_INBOX_LIMIT_INVALID",
  CURSOR_INVALID: "AGENT_INBOX_CURSOR_INVALID",
  CURSOR_CHANNEL_MISMATCH: "AGENT_INBOX_CURSOR_CHANNEL_MISMATCH",
  CURSOR_NOT_FOUND: "AGENT_INBOX_CURSOR_NOT_FOUND",
  ACK_CURSOR_REQUIRED: "AGENT_INBOX_ACK_CURSOR_REQUIRED",
  ACK_CURSOR_NOT_FOUND: "AGENT_INBOX_ACK_CURSOR_NOT_FOUND",
  ACK_CURSOR_REGRESSION: "AGENT_INBOX_ACK_CURSOR_REGRESSION",
  ACK_OUT_OF_ORDER: "AGENT_INBOX_ACK_OUT_OF_ORDER"
});

const CHANNEL_PATTERN = /^[A-Za-z0-9:_./-]+$/;
const CONSUMER_ID_PATTERN = /^[A-Za-z0-9:_./-]+$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9:_./-]+$/;

function nowIso() {
  return new Date().toISOString();
}

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new TypeError(`${name} must be a plain object`);
  }
}

function normalizeNonEmptyString(value, name, { max = 200, pattern = null } = {}) {
  if (typeof value !== "string") throw new TypeError(`${name} must be a string`);
  const out = value.trim();
  if (!out) throw new TypeError(`${name} must be a non-empty string`);
  if (out.length > max) throw new TypeError(`${name} must be <= ${max} characters`);
  if (pattern && !pattern.test(out)) throw new TypeError(`${name} must match ${pattern}`);
  return out;
}

function normalizeDateTime(value, name, { defaultNow = true } = {}) {
  if (value === null || value === undefined) {
    if (!defaultNow) throw new TypeError(`${name} is required`);
    return nowIso();
  }
  const raw = normalizeNonEmptyString(value, name, { max: 64 });
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw new TypeError(`${name} must be an ISO date-time`);
  return date.toISOString();
}

function normalizePayload(value) {
  if (value === undefined) return null;
  return normalizeForCanonicalJson(value, { path: "$.payload" });
}

function normalizeChannel(channel) {
  return normalizeNonEmptyString(channel, "channel", { max: 200, pattern: CHANNEL_PATTERN });
}

function normalizeConsumerId(consumerId) {
  return normalizeNonEmptyString(consumerId, "consumerId", { max: 200, pattern: CONSUMER_ID_PATTERN });
}

function normalizeIdempotencyKey(idempotencyKey) {
  return normalizeNonEmptyString(idempotencyKey, "idempotencyKey", { max: 200, pattern: IDEMPOTENCY_KEY_PATTERN });
}

function normalizeLimit(limit) {
  const value = limit === undefined || limit === null ? 50 : limit;
  if (!Number.isSafeInteger(value) || value <= 0 || value > 1000) {
    throw new TypeError("limit must be an integer between 1 and 1000");
  }
  return value;
}

function parseCursorInput(cursor) {
  if (cursor === null || cursor === undefined || String(cursor).trim() === "") return null;
  if (typeof cursor === "string") return decodeAgentInboxCursorV1(cursor, { allowNull: false });
  return normalizeAgentInboxCursorV1(cursor, { allowNull: false, name: "cursor" });
}

function deriveMessageId({ channel, seq }) {
  const channelHash = sha256Hex(channel).slice(0, 16);
  const seqPart = String(seq).padStart(12, "0");
  return `aimsg_${channelHash}_${seqPart}`;
}

function emptyChannelState(channel) {
  return normalizeForCanonicalJson(
    {
      schemaVersion: "AgentInboxChannelState.v1",
      channel,
      nextSeq: 1,
      messages: [],
      idempotency: {}
    },
    { path: "$.channelState" }
  );
}

function ensureInboxState(inbox) {
  assertPlainObject(inbox, "inbox");
  if (inbox.schemaVersion !== AGENT_INBOX_STATE_SCHEMA_VERSION) {
    throw new TypeError(`inbox.schemaVersion must be ${AGENT_INBOX_STATE_SCHEMA_VERSION}`);
  }
  assertPlainObject(inbox.channels, "inbox.channels");
  assertPlainObject(inbox.checkpoints, "inbox.checkpoints");
  return inbox;
}

function ensureChannelState(inbox, channel) {
  let state = inbox.channels[channel];
  if (!state) {
    state = emptyChannelState(channel);
    inbox.channels[channel] = state;
  }
  assertPlainObject(state, "channelState");
  if (!Array.isArray(state.messages)) throw new TypeError("channelState.messages must be an array");
  assertPlainObject(state.idempotency, "channelState.idempotency");
  if (!Number.isSafeInteger(state.nextSeq) || state.nextSeq <= 0) throw new TypeError("channelState.nextSeq must be a positive integer");
  return state;
}

function ensureChannelCheckpoints(inbox, channel) {
  const current = inbox.checkpoints[channel];
  if (!current) {
    inbox.checkpoints[channel] = {};
    return inbox.checkpoints[channel];
  }
  assertPlainObject(current, "inbox.checkpoints[channel]");
  return current;
}

function findMessageIndex(channelState, cursor) {
  const bySeq = channelState.messages[cursor.seq - 1];
  if (!bySeq) return -1;
  if (bySeq.messageId !== cursor.messageId) return -1;
  if (bySeq.channel !== cursor.channel) return -1;
  return cursor.seq - 1;
}

function encodeCursorFromMessage(message) {
  return encodeAgentInboxCursorV1(cursorFromAgentInboxMessage(message));
}

function buildPublishMessage({ channel, seq, idempotencyKey, publishedAt, payload, payloadHash }) {
  return normalizeForCanonicalJson(
    {
      schemaVersion: AGENT_INBOX_MESSAGE_SCHEMA_VERSION,
      channel,
      seq,
      messageId: deriveMessageId({ channel, seq }),
      idempotencyKey,
      publishedAt,
      payload,
      payloadHash
    },
    { path: "$.message" }
  );
}

function safeHeadCursor(channelState) {
  if (!channelState.messages.length) return null;
  return encodeCursorFromMessage(channelState.messages[channelState.messages.length - 1]);
}

function cursorErrorCodeToInboxReason(code) {
  if (code === AGENT_INBOX_CURSOR_ERROR_CODE.CHANNEL_MISMATCH) return AGENT_INBOX_REASON_CODE.CURSOR_CHANNEL_MISMATCH;
  return AGENT_INBOX_REASON_CODE.CURSOR_INVALID;
}

function normalizeCheckpointCursor(value) {
  if (value === null || value === undefined) return null;
  return buildAgentInboxCursorV1(value);
}

export function createAgentInboxState() {
  return normalizeForCanonicalJson(
    {
      schemaVersion: AGENT_INBOX_STATE_SCHEMA_VERSION,
      channels: {},
      checkpoints: {}
    },
    { path: "$.agentInboxState" }
  );
}

export function publishAgentInboxMessage({ inbox, channel, idempotencyKey, payload = null, publishedAt = null } = {}) {
  try {
    const state = ensureInboxState(inbox);
    const normalizedChannel = normalizeChannel(channel);
    const normalizedIdempotencyKey = normalizeIdempotencyKey(idempotencyKey);
    const normalizedPayload = normalizePayload(payload);
    const payloadHash = sha256Hex(canonicalJsonStringify(normalizedPayload));
    const channelState = ensureChannelState(state, normalizedChannel);
    const existing = channelState.idempotency[normalizedIdempotencyKey] ?? null;

    if (existing) {
      if (existing.payloadHash !== payloadHash) {
        return {
          ok: false,
          reasonCode: AGENT_INBOX_REASON_CODE.IDEMPOTENCY_CONFLICT,
          error: "idempotencyKey was previously published with a different payload",
          message: null,
          cursor: null,
          deduped: false
        };
      }
      const replayed = channelState.messages[existing.index];
      if (!replayed) {
        return {
          ok: false,
          reasonCode: AGENT_INBOX_REASON_CODE.STATE_INVALID,
          error: "idempotency index points to a missing message",
          message: null,
          cursor: null,
          deduped: false
        };
      }
      return {
        ok: true,
        reasonCode: null,
        error: null,
        message: replayed,
        cursor: encodeCursorFromMessage(replayed),
        deduped: true,
        headCursor: safeHeadCursor(channelState)
      };
    }

    const seq = channelState.nextSeq;
    const normalizedPublishedAt = normalizeDateTime(publishedAt, "publishedAt", { defaultNow: true });
    const message = buildPublishMessage({
      channel: normalizedChannel,
      seq,
      idempotencyKey: normalizedIdempotencyKey,
      publishedAt: normalizedPublishedAt,
      payload: normalizedPayload,
      payloadHash
    });

    channelState.messages.push(message);
    channelState.nextSeq = seq + 1;
    channelState.idempotency[normalizedIdempotencyKey] = normalizeForCanonicalJson(
      {
        index: channelState.messages.length - 1,
        seq: message.seq,
        messageId: message.messageId,
        payloadHash
      },
      { path: "$.idempotencyEntry" }
    );

    return {
      ok: true,
      reasonCode: null,
      error: null,
      message,
      cursor: encodeCursorFromMessage(message),
      deduped: false,
      headCursor: safeHeadCursor(channelState)
    };
  } catch (err) {
    const messageText = err?.message ?? "publish failed";
    if (messageText.includes("idempotencyKey")) {
      return { ok: false, reasonCode: AGENT_INBOX_REASON_CODE.IDEMPOTENCY_KEY_INVALID, error: messageText, message: null, cursor: null, deduped: false };
    }
    if (messageText.includes("payload")) {
      return { ok: false, reasonCode: AGENT_INBOX_REASON_CODE.PAYLOAD_INVALID, error: messageText, message: null, cursor: null, deduped: false };
    }
    if (messageText.includes("channel")) {
      return { ok: false, reasonCode: AGENT_INBOX_REASON_CODE.CHANNEL_INVALID, error: messageText, message: null, cursor: null, deduped: false };
    }
    if (messageText.includes("inbox")) {
      return { ok: false, reasonCode: AGENT_INBOX_REASON_CODE.STATE_INVALID, error: messageText, message: null, cursor: null, deduped: false };
    }
    return { ok: false, reasonCode: AGENT_INBOX_REASON_CODE.STATE_INVALID, error: messageText, message: null, cursor: null, deduped: false };
  }
}

export function listAgentInboxMessages({ inbox, channel, cursor = null, limit = 50 } = {}) {
  let state;
  let normalizedChannel;
  let normalizedLimit;
  let normalizedCursor = null;
  try {
    state = ensureInboxState(inbox);
    normalizedChannel = normalizeChannel(channel);
    normalizedLimit = normalizeLimit(limit);
  } catch (err) {
    const text = err?.message ?? "list failed";
    if (text.includes("channel")) {
      return { ok: false, reasonCode: AGENT_INBOX_REASON_CODE.CHANNEL_INVALID, error: text, messages: [], nextCursor: null, hasMore: false };
    }
    if (text.includes("limit")) {
      return { ok: false, reasonCode: AGENT_INBOX_REASON_CODE.LIMIT_INVALID, error: text, messages: [], nextCursor: null, hasMore: false };
    }
    return { ok: false, reasonCode: AGENT_INBOX_REASON_CODE.STATE_INVALID, error: text, messages: [], nextCursor: null, hasMore: false };
  }

  try {
    normalizedCursor = parseCursorInput(cursor);
  } catch (err) {
    return {
      ok: false,
      reasonCode: cursorErrorCodeToInboxReason(err?.code),
      error: err?.message ?? "cursor is invalid",
      messages: [],
      nextCursor: null,
      hasMore: false
    };
  }

  if (normalizedCursor && normalizedCursor.channel !== normalizedChannel) {
    return {
      ok: false,
      reasonCode: AGENT_INBOX_REASON_CODE.CURSOR_CHANNEL_MISMATCH,
      error: "cursor channel does not match requested channel",
      messages: [],
      nextCursor: null,
      hasMore: false
    };
  }

  const channelState = ensureChannelState(state, normalizedChannel);
  let startIndex = 0;
  if (normalizedCursor) {
    const cursorIndex = findMessageIndex(channelState, normalizedCursor);
    if (cursorIndex < 0) {
      return {
        ok: false,
        reasonCode: AGENT_INBOX_REASON_CODE.CURSOR_NOT_FOUND,
        error: "cursor was not found in channel timeline",
        messages: [],
        nextCursor: null,
        hasMore: false
      };
    }
    startIndex = cursorIndex + 1;
  }

  const messages = channelState.messages.slice(startIndex, startIndex + normalizedLimit);
  const hasMore = startIndex + messages.length < channelState.messages.length;
  const nextCursorObject = messages.length ? cursorFromAgentInboxMessage(messages[messages.length - 1]) : normalizedCursor;

  return {
    ok: true,
    reasonCode: null,
    error: null,
    messages,
    nextCursor: nextCursorObject ? encodeAgentInboxCursorV1(nextCursorObject) : null,
    hasMore,
    headCursor: safeHeadCursor(channelState)
  };
}

export function getAgentInboxCheckpoint({ inbox, channel, consumerId } = {}) {
  try {
    const state = ensureInboxState(inbox);
    const normalizedChannel = normalizeChannel(channel);
    const normalizedConsumerId = normalizeConsumerId(consumerId);
    const channelCheckpoints = ensureChannelCheckpoints(state, normalizedChannel);
    const checkpoint = normalizeCheckpointCursor(channelCheckpoints[normalizedConsumerId] ?? null);
    return {
      ok: true,
      reasonCode: null,
      error: null,
      channel: normalizedChannel,
      consumerId: normalizedConsumerId,
      checkpoint,
      checkpointCursor: checkpoint ? encodeAgentInboxCursorV1(checkpoint) : null
    };
  } catch (err) {
    const text = err?.message ?? "checkpoint lookup failed";
    if (text.includes("consumerId")) {
      return { ok: false, reasonCode: AGENT_INBOX_REASON_CODE.CONSUMER_INVALID, error: text, checkpoint: null, checkpointCursor: null };
    }
    if (text.includes("channel")) {
      return { ok: false, reasonCode: AGENT_INBOX_REASON_CODE.CHANNEL_INVALID, error: text, checkpoint: null, checkpointCursor: null };
    }
    return { ok: false, reasonCode: AGENT_INBOX_REASON_CODE.STATE_INVALID, error: text, checkpoint: null, checkpointCursor: null };
  }
}

export function readAgentInboxForConsumer({ inbox, channel, consumerId, limit = 50 } = {}) {
  const checkpoint = getAgentInboxCheckpoint({ inbox, channel, consumerId });
  if (!checkpoint.ok) {
    return { ...checkpoint, messages: [], nextCursor: null, hasMore: false };
  }
  const listed = listAgentInboxMessages({
    inbox,
    channel,
    cursor: checkpoint.checkpointCursor,
    limit
  });
  return {
    ...listed,
    channel: checkpoint.channel,
    consumerId: checkpoint.consumerId,
    checkpoint: checkpoint.checkpoint,
    checkpointCursor: checkpoint.checkpointCursor
  };
}

export function ackAgentInboxCursor({ inbox, channel, consumerId, cursor, ackedAt = null } = {}) {
  if (cursor === null || cursor === undefined || String(cursor).trim() === "") {
    return {
      ok: false,
      reasonCode: AGENT_INBOX_REASON_CODE.ACK_CURSOR_REQUIRED,
      error: "cursor is required for ack",
      checkpoint: null,
      checkpointCursor: null,
      noop: false
    };
  }

  let state;
  let normalizedChannel;
  let normalizedConsumerId;
  let normalizedCursor;
  let normalizedAckedAt;
  try {
    state = ensureInboxState(inbox);
    normalizedChannel = normalizeChannel(channel);
    normalizedConsumerId = normalizeConsumerId(consumerId);
    normalizedCursor = parseCursorInput(cursor);
    normalizedAckedAt = normalizeDateTime(ackedAt, "ackedAt", { defaultNow: true });
  } catch (err) {
    const code = err?.code;
    const text = err?.message ?? "ack failed";
    if (text.includes("consumerId")) {
      return { ok: false, reasonCode: AGENT_INBOX_REASON_CODE.CONSUMER_INVALID, error: text, checkpoint: null, checkpointCursor: null, noop: false };
    }
    if (text.includes("channel")) {
      return { ok: false, reasonCode: AGENT_INBOX_REASON_CODE.CHANNEL_INVALID, error: text, checkpoint: null, checkpointCursor: null, noop: false };
    }
    if (code) {
      return {
        ok: false,
        reasonCode: cursorErrorCodeToInboxReason(code),
        error: text,
        checkpoint: null,
        checkpointCursor: null,
        noop: false
      };
    }
    return { ok: false, reasonCode: AGENT_INBOX_REASON_CODE.STATE_INVALID, error: text, checkpoint: null, checkpointCursor: null, noop: false };
  }

  if (normalizedCursor.channel !== normalizedChannel) {
    return {
      ok: false,
      reasonCode: AGENT_INBOX_REASON_CODE.CURSOR_CHANNEL_MISMATCH,
      error: "cursor channel does not match ack channel",
      checkpoint: null,
      checkpointCursor: null,
      noop: false
    };
  }

  const channelState = ensureChannelState(state, normalizedChannel);
  const targetIndex = findMessageIndex(channelState, normalizedCursor);
  if (targetIndex < 0) {
    return {
      ok: false,
      reasonCode: AGENT_INBOX_REASON_CODE.ACK_CURSOR_NOT_FOUND,
      error: "ack cursor was not found in channel timeline",
      checkpoint: null,
      checkpointCursor: null,
      noop: false
    };
  }

  const channelCheckpoints = ensureChannelCheckpoints(state, normalizedChannel);
  const existing = normalizeCheckpointCursor(channelCheckpoints[normalizedConsumerId] ?? null);
  const existingSeq = existing?.seq ?? 0;

  if (normalizedCursor.seq < existingSeq) {
    return {
      ok: false,
      reasonCode: AGENT_INBOX_REASON_CODE.ACK_CURSOR_REGRESSION,
      error: "ack cursor regression is not allowed",
      expectedNextSeq: existingSeq + 1,
      checkpoint: existing,
      checkpointCursor: existing ? encodeAgentInboxCursorV1(existing) : null,
      noop: false
    };
  }

  if (normalizedCursor.seq === existingSeq) {
    return {
      ok: true,
      reasonCode: null,
      error: null,
      expectedNextSeq: existingSeq + 1,
      checkpoint: existing,
      checkpointCursor: existing ? encodeAgentInboxCursorV1(existing) : null,
      noop: true
    };
  }

  if (normalizedCursor.seq !== existingSeq + 1) {
    return {
      ok: false,
      reasonCode: AGENT_INBOX_REASON_CODE.ACK_OUT_OF_ORDER,
      error: "ack cursor must advance exactly one message at a time",
      expectedNextSeq: existingSeq + 1,
      gotSeq: normalizedCursor.seq,
      checkpoint: existing,
      checkpointCursor: existing ? encodeAgentInboxCursorV1(existing) : null,
      noop: false
    };
  }

  const updated = normalizeForCanonicalJson(
    {
      schemaVersion: AGENT_INBOX_CURSOR_SCHEMA_VERSION,
      channel: normalizedCursor.channel,
      seq: normalizedCursor.seq,
      messageId: normalizedCursor.messageId,
      publishedAt: normalizedCursor.publishedAt,
      ackedAt: normalizedAckedAt
    },
    { path: "$.checkpoint" }
  );

  channelCheckpoints[normalizedConsumerId] = updated;
  const checkpoint = buildAgentInboxCursorV1(updated);
  return {
    ok: true,
    reasonCode: null,
    error: null,
    expectedNextSeq: checkpoint.seq + 1,
    checkpoint,
    checkpointCursor: encodeAgentInboxCursorV1(checkpoint),
    noop: false
  };
}
