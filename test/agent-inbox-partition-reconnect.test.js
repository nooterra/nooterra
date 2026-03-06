import test from "node:test";
import assert from "node:assert/strict";

import {
  AGENT_INBOX_REASON_CODE,
  ackAgentInboxCursor,
  createAgentInboxState,
  publishAgentInboxMessage,
  readAgentInboxForConsumer
} from "../src/core/agent-inbox.js";
import { cursorFromAgentInboxMessage, encodeAgentInboxCursorV1 } from "../src/core/agent-inbox-cursor.js";

function cursorFor(message) {
  return encodeAgentInboxCursorV1(cursorFromAgentInboxMessage(message));
}

test("agent inbox core: partition/reconnect simulation keeps resume + ack deterministic", () => {
  const inbox = createAgentInboxState();
  const channel = "chan.partition";
  const consumerId = "worker_partition_1";

  for (let index = 1; index <= 6; index += 1) {
    const publish = publishAgentInboxMessage({
      inbox,
      channel,
      idempotencyKey: `partition_${index}`,
      publishedAt: `2026-03-01T04:00:0${index}.000Z`,
      payload: { index }
    });
    assert.equal(publish.ok, true);
  }

  const poll1 = readAgentInboxForConsumer({ inbox, channel, consumerId, limit: 2 });
  assert.equal(poll1.ok, true);
  assert.deepEqual(poll1.messages.map((row) => row.seq), [1, 2]);

  const ack1 = ackAgentInboxCursor({
    inbox,
    channel,
    consumerId,
    cursor: cursorFor(poll1.messages[0])
  });
  assert.equal(ack1.ok, true);

  const partitionDelivery = readAgentInboxForConsumer({ inbox, channel, consumerId, limit: 3 });
  assert.equal(partitionDelivery.ok, true);
  assert.deepEqual(partitionDelivery.messages.map((row) => row.seq), [2, 3, 4]);

  // During partition, a newer ack arrives before the missing contiguous ack.
  const delayedOutOfOrderAck = ackAgentInboxCursor({
    inbox,
    channel,
    consumerId,
    cursor: cursorFor(partitionDelivery.messages[2])
  });
  assert.equal(delayedOutOfOrderAck.ok, false);
  assert.equal(delayedOutOfOrderAck.reasonCode, AGENT_INBOX_REASON_CODE.ACK_OUT_OF_ORDER);
  assert.equal(delayedOutOfOrderAck.expectedNextSeq, 2);

  // Reconnect with no ack progress yields the same deterministic continuation.
  const reconnectBeforeAck2 = readAgentInboxForConsumer({ inbox, channel, consumerId, limit: 3 });
  assert.equal(reconnectBeforeAck2.ok, true);
  assert.deepEqual(reconnectBeforeAck2.messages.map((row) => row.seq), [2, 3, 4]);

  const ack2 = ackAgentInboxCursor({
    inbox,
    channel,
    consumerId,
    cursor: cursorFor(reconnectBeforeAck2.messages[0])
  });
  assert.equal(ack2.ok, true);
  assert.equal(ack2.checkpoint.seq, 2);

  const reconnectAfterAck2 = readAgentInboxForConsumer({ inbox, channel, consumerId, limit: 3 });
  assert.equal(reconnectAfterAck2.ok, true);
  assert.deepEqual(reconnectAfterAck2.messages.map((row) => row.seq), [3, 4, 5]);

  const ack3 = ackAgentInboxCursor({
    inbox,
    channel,
    consumerId,
    cursor: cursorFor(reconnectAfterAck2.messages[0])
  });
  const ack4 = ackAgentInboxCursor({
    inbox,
    channel,
    consumerId,
    cursor: cursorFor(reconnectAfterAck2.messages[1])
  });
  const ack5 = ackAgentInboxCursor({
    inbox,
    channel,
    consumerId,
    cursor: cursorFor(reconnectAfterAck2.messages[2])
  });
  assert.equal(ack3.ok, true);
  assert.equal(ack4.ok, true);
  assert.equal(ack5.ok, true);

  const reconnectTail = readAgentInboxForConsumer({ inbox, channel, consumerId, limit: 3 });
  assert.equal(reconnectTail.ok, true);
  assert.deepEqual(reconnectTail.messages.map((row) => row.seq), [6]);

  const ack6 = ackAgentInboxCursor({
    inbox,
    channel,
    consumerId,
    cursor: cursorFor(reconnectTail.messages[0])
  });
  assert.equal(ack6.ok, true);
  assert.equal(ack6.checkpoint.seq, 6);

  const emptyAfterCheckpoint = readAgentInboxForConsumer({ inbox, channel, consumerId, limit: 3 });
  assert.equal(emptyAfterCheckpoint.ok, true);
  assert.deepEqual(emptyAfterCheckpoint.messages, []);
  assert.equal(emptyAfterCheckpoint.hasMore, false);

  const publish7 = publishAgentInboxMessage({
    inbox,
    channel,
    idempotencyKey: "partition_7",
    publishedAt: "2026-03-01T04:00:07.000Z",
    payload: { index: 7 }
  });
  assert.equal(publish7.ok, true);

  const reconnectWithNewData = readAgentInboxForConsumer({ inbox, channel, consumerId, limit: 3 });
  assert.equal(reconnectWithNewData.ok, true);
  assert.deepEqual(reconnectWithNewData.messages.map((row) => row.seq), [7]);
});
