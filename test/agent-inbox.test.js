import test from "node:test";
import assert from "node:assert/strict";

import {
  AGENT_INBOX_REASON_CODE,
  ackAgentInboxCursor,
  createAgentInboxState,
  getAgentInboxCheckpoint,
  listAgentInboxMessages,
  publishAgentInboxMessage
} from "../src/core/agent-inbox.js";
import {
  cursorFromAgentInboxMessage,
  decodeAgentInboxCursorV1,
  encodeAgentInboxCursorV1
} from "../src/core/agent-inbox-cursor.js";

function cursorFor(message) {
  return encodeAgentInboxCursorV1(cursorFromAgentInboxMessage(message));
}

test("agent inbox core: deterministic per-channel ordering", () => {
  const inbox = createAgentInboxState();

  const alpha1 = publishAgentInboxMessage({
    inbox,
    channel: "chan.alpha",
    idempotencyKey: "pub_alpha_1",
    publishedAt: "2026-03-01T00:00:00.000Z",
    payload: { order: 1 }
  });
  const beta1 = publishAgentInboxMessage({
    inbox,
    channel: "chan.beta",
    idempotencyKey: "pub_beta_1",
    publishedAt: "2026-03-01T00:00:01.000Z",
    payload: { order: 1 }
  });
  const alpha2 = publishAgentInboxMessage({
    inbox,
    channel: "chan.alpha",
    idempotencyKey: "pub_alpha_2",
    publishedAt: "2026-03-01T00:00:02.000Z",
    payload: { order: 2 }
  });

  assert.equal(alpha1.ok, true);
  assert.equal(beta1.ok, true);
  assert.equal(alpha2.ok, true);
  assert.equal(alpha1.message.seq, 1);
  assert.equal(alpha2.message.seq, 2);
  assert.equal(beta1.message.seq, 1);

  const alphaList = listAgentInboxMessages({ inbox, channel: "chan.alpha", limit: 10 });
  assert.equal(alphaList.ok, true);
  assert.deepEqual(
    alphaList.messages.map((row) => ({ seq: row.seq, idempotencyKey: row.idempotencyKey })),
    [
      { seq: 1, idempotencyKey: "pub_alpha_1" },
      { seq: 2, idempotencyKey: "pub_alpha_2" }
    ]
  );

  const alphaListRepeat = listAgentInboxMessages({ inbox, channel: "chan.alpha", limit: 10 });
  assert.equal(alphaListRepeat.ok, true);
  assert.deepEqual(alphaListRepeat.messages, alphaList.messages);
  assert.equal(alphaListRepeat.nextCursor, alphaList.nextCursor);
});

test("agent inbox core: idempotency duplicate publish is no-op and payload mismatch fails closed", () => {
  const inbox = createAgentInboxState();

  const first = publishAgentInboxMessage({
    inbox,
    channel: "chan.idempotency",
    idempotencyKey: "idem_1",
    publishedAt: "2026-03-01T01:00:00.000Z",
    payload: { x: 1, y: "ok" }
  });
  const replay = publishAgentInboxMessage({
    inbox,
    channel: "chan.idempotency",
    idempotencyKey: "idem_1",
    publishedAt: "2026-03-01T01:00:05.000Z",
    payload: { y: "ok", x: 1 }
  });
  const conflict = publishAgentInboxMessage({
    inbox,
    channel: "chan.idempotency",
    idempotencyKey: "idem_1",
    publishedAt: "2026-03-01T01:00:06.000Z",
    payload: { x: 2 }
  });

  assert.equal(first.ok, true);
  assert.equal(replay.ok, true);
  assert.equal(replay.deduped, true);
  assert.equal(replay.message.messageId, first.message.messageId);
  assert.equal(replay.message.seq, first.message.seq);

  const listed = listAgentInboxMessages({ inbox, channel: "chan.idempotency", limit: 10 });
  assert.equal(listed.ok, true);
  assert.equal(listed.messages.length, 1);

  assert.equal(conflict.ok, false);
  assert.equal(conflict.reasonCode, AGENT_INBOX_REASON_CODE.IDEMPOTENCY_CONFLICT);
});

test("agent inbox core: resume from cursor is deterministic", () => {
  const inbox = createAgentInboxState();
  for (let index = 1; index <= 5; index += 1) {
    const published = publishAgentInboxMessage({
      inbox,
      channel: "chan.resume",
      idempotencyKey: `resume_${index}`,
      publishedAt: `2026-03-01T02:00:0${index}.000Z`,
      payload: { index }
    });
    assert.equal(published.ok, true);
  }

  const page1 = listAgentInboxMessages({ inbox, channel: "chan.resume", limit: 2 });
  assert.equal(page1.ok, true);
  assert.deepEqual(page1.messages.map((row) => row.seq), [1, 2]);

  const page2 = listAgentInboxMessages({ inbox, channel: "chan.resume", cursor: page1.nextCursor, limit: 2 });
  const page2Repeat = listAgentInboxMessages({ inbox, channel: "chan.resume", cursor: page1.nextCursor, limit: 2 });
  assert.equal(page2.ok, true);
  assert.equal(page2Repeat.ok, true);
  assert.deepEqual(page2.messages.map((row) => row.seq), [3, 4]);
  assert.deepEqual(page2Repeat.messages, page2.messages);
  assert.equal(page2Repeat.nextCursor, page2.nextCursor);

  const page3 = listAgentInboxMessages({ inbox, channel: "chan.resume", cursor: page2.nextCursor, limit: 2 });
  assert.equal(page3.ok, true);
  assert.deepEqual(page3.messages.map((row) => row.seq), [5]);
  assert.equal(page3.hasMore, false);

  const page2Cursor = decodeAgentInboxCursorV1(page2.nextCursor);
  assert.equal(page2Cursor.channel, "chan.resume");
  assert.equal(page2Cursor.seq, 4);
});

test("agent inbox core: out-of-order ack fails closed with explicit reason codes", () => {
  const inbox = createAgentInboxState();
  for (let index = 1; index <= 3; index += 1) {
    const published = publishAgentInboxMessage({
      inbox,
      channel: "chan.ack",
      idempotencyKey: `ack_${index}`,
      publishedAt: `2026-03-01T03:00:0${index}.000Z`,
      payload: { index }
    });
    assert.equal(published.ok, true);
  }

  const listed = listAgentInboxMessages({ inbox, channel: "chan.ack", limit: 10 });
  assert.equal(listed.ok, true);
  const [m1, m2, m3] = listed.messages;

  const ackOutOfOrder = ackAgentInboxCursor({
    inbox,
    channel: "chan.ack",
    consumerId: "worker_ack_1",
    cursor: cursorFor(m2)
  });
  assert.equal(ackOutOfOrder.ok, false);
  assert.equal(ackOutOfOrder.reasonCode, AGENT_INBOX_REASON_CODE.ACK_OUT_OF_ORDER);
  assert.equal(ackOutOfOrder.expectedNextSeq, 1);

  const ack1 = ackAgentInboxCursor({
    inbox,
    channel: "chan.ack",
    consumerId: "worker_ack_1",
    cursor: cursorFor(m1)
  });
  assert.equal(ack1.ok, true);
  assert.equal(ack1.noop, false);
  assert.equal(ack1.checkpoint.seq, 1);

  const ack1Replay = ackAgentInboxCursor({
    inbox,
    channel: "chan.ack",
    consumerId: "worker_ack_1",
    cursor: cursorFor(m1)
  });
  assert.equal(ack1Replay.ok, true);
  assert.equal(ack1Replay.noop, true);

  const ack3TooSoon = ackAgentInboxCursor({
    inbox,
    channel: "chan.ack",
    consumerId: "worker_ack_1",
    cursor: cursorFor(m3)
  });
  assert.equal(ack3TooSoon.ok, false);
  assert.equal(ack3TooSoon.reasonCode, AGENT_INBOX_REASON_CODE.ACK_OUT_OF_ORDER);
  assert.equal(ack3TooSoon.expectedNextSeq, 2);

  const ack2 = ackAgentInboxCursor({
    inbox,
    channel: "chan.ack",
    consumerId: "worker_ack_1",
    cursor: cursorFor(m2)
  });
  assert.equal(ack2.ok, true);
  assert.equal(ack2.noop, false);
  assert.equal(ack2.checkpoint.seq, 2);

  const ackRegression = ackAgentInboxCursor({
    inbox,
    channel: "chan.ack",
    consumerId: "worker_ack_1",
    cursor: cursorFor(m1)
  });
  assert.equal(ackRegression.ok, false);
  assert.equal(ackRegression.reasonCode, AGENT_INBOX_REASON_CODE.ACK_CURSOR_REGRESSION);

  const checkpoint = getAgentInboxCheckpoint({ inbox, channel: "chan.ack", consumerId: "worker_ack_1" });
  assert.equal(checkpoint.ok, true);
  assert.equal(checkpoint.checkpoint.seq, 2);
});
