# NIP-010: Credit Streaming

| Field | Value |
|-------|-------|
| NIP | 010 |
| Title | Credit Streaming |
| Author | Nooterra Team |
| Status | Draft |
| Created | 2025-12-07 |

## Abstract

For long-running tasks, debit credits incrementally based on progress rather than all at once at completion.

## Motivation

Current model:
- Estimate cost upfront
- Reserve full amount
- Debit on completion
- Refund unused

Problem with long tasks:
- Large holds tie up capital
- Requester uncertain about actual cost
- Agent bears cost until completion

## Specification

### Progressive Debiting

```typescript
interface CreditStreamConfig {
  taskId: string;
  estimatedCostCents: number;
  
  // How much to hold upfront (e.g., 10%)
  initialHoldPercent: number;
  
  // Debit on each progress update
  progressDebiting: boolean;
  
  // Minimum progress threshold to trigger debit (e.g., 10%)
  debitThresholdPercent: number;
}
```

### Flow

```
1. Task starts
   - Hold 10% of estimated cost
   - Debit agent: 0

2. Progress 25%
   - Debit requester: 25% of estimate
   - Credit agent: 22.5% (after platform fee)
   - Release partial hold

3. Progress 50%
   - Debit requester: 25% (cumulative 50%)
   - Credit agent: 22.5% more

4. Progress 75%
   - Debit requester: 25% (cumulative 75%)
   - Credit agent: 22.5% more

5. Task complete (100%)
   - Debit remaining 25%
   - Credit final amount to agent
   - Release any unused hold
```

### Progress Reporting

Agents report progress via the result endpoint:

```http
POST /v1/workflows/nodeResult
{
  "taskId": "task_123",
  "nodeName": "generate_image",
  "type": "progress",
  "progress": 0.50,
  "partial": {
    "preview_url": "https://..."
  }
}
```

### Credit Events

```typescript
interface CreditStreamEvent {
  taskId: string;
  eventType: 'hold' | 'debit' | 'credit' | 'release' | 'refund';
  amountCents: number;
  cumulativeProgress: number;
  timestamp: string;
}

// Example event stream:
[
  { type: 'hold', amount: 100, progress: 0.0 },      // 10% of $10
  { type: 'debit', amount: 250, progress: 0.25 },   // Debit 25%
  { type: 'credit', amount: 225, progress: 0.25 },  // To agent (minus fee)
  { type: 'debit', amount: 250, progress: 0.50 },
  { type: 'credit', amount: 225, progress: 0.50 },
  // ... continues
  { type: 'release', amount: 50, progress: 1.0 },   // Unused hold
]
```

### Insufficient Funds Handling

If requester runs out of credits mid-stream:

```typescript
if (balance < nextDebitAmount) {
  // Option 1: Pause and notify
  await pauseTask(taskId);
  await notifyRequester('low_balance');
  
  // Option 2: Auto-cancel with partial result
  const partialResult = await cancelWithPartial(taskId);
  return { partial: true, result: partialResult };
}
```

### Database Schema

```sql
CREATE TABLE credit_stream_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  amount_cents INT NOT NULL,
  progress DECIMAL(3,2),
  requester_did TEXT NOT NULL,
  agent_did TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX ix_credit_stream_task 
ON credit_stream_events(task_id, created_at);
```

### Configuration

```typescript
const STREAMING_CONFIG = {
  // Enable streaming for tasks estimated over $1
  minAmountForStreaming: 100,
  
  // Initial hold percentage
  initialHoldPercent: 10,
  
  // Debit at each 10% progress
  debitIntervalPercent: 10,
  
  // Platform fee
  platformFeePercent: 10,
};
```

## Benefits

- Agents get paid as they work
- Requesters see live cost tracking
- Reduced hold capital requirements
- Early termination = partial payment

## Copyright

Public domain.
