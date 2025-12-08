# NIP-002: Webhook Delivery Guarantees

| Field | Value |
|-------|-------|
| NIP | 002 |
| Title | Webhook Delivery Guarantees |
| Author | Nooterra Team |
| Status | Draft |
| Created | 2025-12-07 |
| Updated | 2025-12-07 |

## Abstract

Webhooks should have at-least-once delivery semantics with exponential backoff retry logic. This NIP defines the delivery mechanism, event format, and retry policy.

## Motivation

Currently, Nooterra does not have a robust webhook system. When workflows complete, fail, or require human approval, there's no reliable way to notify external systems. Polling is inefficient and adds latency.

Key use cases:
1. **CI/CD Integration** - Trigger deployments when workflows complete
2. **Alerting** - Send to Slack/PagerDuty on failures
3. **Analytics** - Stream events to data warehouses
4. **Human-in-the-loop** - Notify operators when approval needed

## Specification

### Webhook Registration

```http
POST /v1/webhooks
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "url": "https://example.com/nooterra-webhook",
  "events": ["workflow.completed", "workflow.failed", "node.requires_approval"],
  "secret": "optional-user-provided-secret",
  "headers": {
    "X-Custom-Header": "value"
  },
  "enabled": true
}
```

Response:
```json
{
  "id": "wh_abc123",
  "url": "https://example.com/nooterra-webhook",
  "events": ["workflow.completed", "workflow.failed"],
  "enabled": true,
  "createdAt": "2025-12-07T00:00:00Z",
  "secret": "whsec_xxxxxxxxxxxxxxxx"
}
```

### Event Types

| Event | Description | Payload |
|-------|-------------|---------|
| `workflow.created` | Workflow definition created | `{workflow}` |
| `workflow.started` | Execution began | `{workflowRun}` |
| `workflow.completed` | Execution succeeded | `{workflowRun, results}` |
| `workflow.failed` | Execution failed | `{workflowRun, error}` |
| `node.started` | Node execution began | `{workflowRun, node}` |
| `node.completed` | Node execution succeeded | `{workflowRun, node, result}` |
| `node.failed` | Node execution failed | `{workflowRun, node, error}` |
| `node.requires_approval` | Human approval needed | `{workflowRun, node}` |
| `agent.registered` | New agent joined | `{agent}` |
| `agent.offline` | Agent went offline | `{agent}` |
| `ledger.low_balance` | Balance below threshold | `{account, balance}` |

### Delivery Format

```http
POST https://example.com/nooterra-webhook
Content-Type: application/json
X-Nooterra-Event: workflow.completed
X-Nooterra-Delivery: dlv_xyz789
X-Nooterra-Timestamp: 2025-12-07T12:00:00Z
X-Nooterra-Signature: sha256=xxxxxx

{
  "id": "evt_abc123",
  "type": "workflow.completed",
  "timestamp": "2025-12-07T12:00:00Z",
  "data": {
    "workflowId": "wf_123",
    "workflowRunId": "run_456",
    "status": "completed",
    "duration_ms": 1523,
    "cost_cents": 25
  }
}
```

### Signature Verification

Webhooks are signed with HMAC-SHA256 using the webhook secret:

```typescript
const crypto = require('crypto');

function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  
  const providedHex = signature.replace('sha256=', '');
  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(providedHex)
  );
}
```

### Retry Policy

| Attempt | Delay | Total Wait |
|---------|-------|------------|
| 1 | Immediate | 0s |
| 2 | 10s | 10s |
| 3 | 30s | 40s |
| 4 | 1min | 1m40s |
| 5 | 5min | 6m40s |
| 6 | 15min | 21m40s |
| 7 | 1hr | 1h21m40s |

After 7 attempts:
- Mark delivery as `failed`
- Send to dead letter queue
- Optionally notify webhook owner via email

### Success Criteria

A delivery is considered successful if:
- HTTP status code is 2xx (200-299)
- Response is received within 30 seconds

### Database Schema

```sql
CREATE TABLE webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  events TEXT[] NOT NULL,
  secret TEXT NOT NULL,
  headers JSONB DEFAULT '{}',
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id UUID REFERENCES webhooks(id) ON DELETE CASCADE,
  event_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  attempts INT DEFAULT 0,
  max_attempts INT DEFAULT 7,
  last_attempt_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  status TEXT DEFAULT 'pending', -- pending, delivered, failed
  last_response_code INT,
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX ix_webhook_deliveries_pending 
ON webhook_deliveries(next_attempt_at) 
WHERE status = 'pending';
```

### Delivery Worker

```typescript
async function processWebhookDeliveries() {
  const pending = await pool.query(`
    SELECT * FROM webhook_deliveries
    WHERE status = 'pending' 
      AND next_attempt_at <= NOW()
    ORDER BY next_attempt_at
    LIMIT 100
    FOR UPDATE SKIP LOCKED
  `);

  for (const delivery of pending.rows) {
    await attemptDelivery(delivery);
  }
}

async function attemptDelivery(delivery: WebhookDelivery) {
  const webhook = await getWebhook(delivery.webhook_id);
  
  try {
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Nooterra-Event': delivery.event_type,
        'X-Nooterra-Delivery': delivery.id,
        'X-Nooterra-Timestamp': new Date().toISOString(),
        'X-Nooterra-Signature': sign(delivery.payload, webhook.secret),
        ...webhook.headers,
      },
      body: JSON.stringify(delivery.payload),
      signal: AbortSignal.timeout(30000),
    });

    if (response.ok) {
      await markDelivered(delivery.id);
    } else {
      await schedulerRetry(delivery, response.status);
    }
  } catch (error) {
    await scheduleRetry(delivery, error.message);
  }
}
```

## Rationale

### Why at-least-once instead of exactly-once?

At-least-once is standard practice for webhooks because:
- Exactly-once requires distributed transactions
- Receivers should be idempotent anyway (use `event_id`)
- Simpler to implement reliably

### Why 7 retries over ~1.5 hours?

- Brief outages (network blip): caught by early retries
- Maintenance windows (15min): caught by later retries
- Longer outages: dead letter allows manual intervention

### Why separate delivery records?

- Enables replay of failed deliveries
- Provides audit trail
- Supports debugging without re-triggering events

## Backwards Compatibility

This is a new feature with no backwards compatibility concerns.

## Security Considerations

1. **Secret Generation** - Secrets are generated with `crypto.randomBytes(32)`
2. **Timing Attacks** - Use `crypto.timingSafeEqual` for signature comparison
3. **URL Validation** - Reject `localhost`, `127.0.0.1`, and private IPs
4. **Rate Limiting** - Max 1000 deliveries per minute per project
5. **Payload Size** - Max 64KB per event payload

## Reference Implementation

See PR: `#XXX` (to be created)

Key files:
- `apps/coordinator/src/routes/webhooks.ts`
- `apps/coordinator/src/services/webhook-delivery.ts`
- `apps/coordinator/src/workers/webhook-worker.ts`

## Copyright

This document is placed in the public domain.
