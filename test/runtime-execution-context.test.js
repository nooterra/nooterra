import test from 'node:test';
import assert from 'node:assert/strict';

import { buildExecutionContextMessages } from '../services/runtime/execution-context.js';

test('scheduler execution context: builds a prompt message for inbound webhook executions', () => {
  const messages = buildExecutionContextMessages({
    triggerType: 'webhook',
    metadata: {
      webhookEvent: {
        provider: 'twilio',
        channel: 'sms',
        eventType: 'sms_received',
        id: 'SM123',
        from: { address: '+15551234567' },
        to: [{ address: '+15557654321' }],
        text: 'Need to reschedule my appointment',
      },
    },
  });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, 'user');
  assert.match(messages[0].content, /Provider: twilio/);
  assert.match(messages[0].content, /Channel: sms/);
  assert.match(messages[0].content, /Event ID: SM123/);
  assert.match(messages[0].content, /Need to reschedule my appointment/);
});

test('scheduler execution context: skips non-webhook executions', () => {
  const messages = buildExecutionContextMessages({
    triggerType: 'cron',
    metadata: {
      webhookEvent: {
        provider: 'twilio',
      },
    },
  });

  assert.deepEqual(messages, []);
});
