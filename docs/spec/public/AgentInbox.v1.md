# AgentInbox.v1

`AgentInbox.v1` defines the deterministic durable inbox core semantics used for channel-ordered publish, replay, and ack progression.

Runtime status: core semantics implemented (`src/core/agent-inbox.js`, `src/core/agent-inbox-cursor.js`).

## Purpose

Provide a fail-closed, deterministic inbox primitive for:

- per-channel ordered delivery
- idempotent publish retry handling
- reconnect-safe resume from cursor
- monotonic ack progression

## Core objects

- `AgentInboxMessage.v1` (published timeline row)
- `AgentInboxCursor.v1` (resume/ack cursor pointing at a concrete message)

## Deterministic ordering

- messages are ordered by `seq` ascending within each channel.
- `seq` is assigned exactly once on first publish and never reused.
- duplicate publish retries with the same idempotency key return the original message as a no-op replay.

## Cursor and replay

- cursor tokens are canonical JSON encoded as base64url.
- resume starts strictly after the referenced cursor message.
- replay is deterministic for the same `(channel, cursor, limit)` inputs.
- missing/invalid cursor references fail closed.

## Ack invariants

- ack requires a valid cursor for the same channel.
- ack is monotonic and contiguous: only `currentSeq + 1` is accepted.
- duplicate ack of the current checkpoint is a no-op.
- regressing ack fails closed with `AGENT_INBOX_ACK_CURSOR_REGRESSION`.
- out-of-order ack fails closed with `AGENT_INBOX_ACK_OUT_OF_ORDER`.

## Reason codes (core)

- `AGENT_INBOX_IDEMPOTENCY_CONFLICT`
- `AGENT_INBOX_CURSOR_INVALID`
- `AGENT_INBOX_CURSOR_CHANNEL_MISMATCH`
- `AGENT_INBOX_CURSOR_NOT_FOUND`
- `AGENT_INBOX_ACK_CURSOR_REQUIRED`
- `AGENT_INBOX_ACK_CURSOR_NOT_FOUND`
- `AGENT_INBOX_ACK_CURSOR_REGRESSION`
- `AGENT_INBOX_ACK_OUT_OF_ORDER`

## API integration status

Transport/API/OpenAPI/store integration is intentionally out of scope for this issue. This spec covers core runtime semantics only.

## Implementation references

- `src/core/agent-inbox.js`
- `src/core/agent-inbox-cursor.js`
