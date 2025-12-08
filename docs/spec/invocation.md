# Invocation (Canonical Unit of Work)

The `Invocation` object is the canonical "unit of work" in the Nooterra protocol.
Every capability execution **must** be representable as a single `Invocation`,
regardless of how it is transported (HTTP, MCP, A2A, P2P).

## Shape

TypeScript (from `@nooterra/types`):

```ts
export interface InvocationConstraints {
  timeoutMs?: number;
  maxPriceCents?: number;
  budgetCapCents?: number;
  policyIds?: string[];
  regionsAllow?: string[];
  regionsDeny?: string[];
  deadlineAt?: string;        // ISO8601
}

export interface InvocationContext {
  workflowId?: string;
  nodeName?: string;
  payerDid?: string;
  projectId?: string;
  tags?: string[];
}

export interface Invocation {
  invocationId: string;       // UUID
  traceId: string;            // trace/workflow correlation
  capabilityId: string;       // e.g. "cap.text.generate.v1"
  agentDid?: string;          // optional pre-selected agent
  input: unknown;             // capability input payload
  constraints?: InvocationConstraints;
  context?: InvocationContext;
}
```

## Invariants

- `invocationId` is globally unique (UUID).
- `traceId` is stable for the lifetime of the workflow / request and is
  reused across:
  - `workflows.trace_id`
  - `task_nodes.trace_id`
  - `dispatch_queue.trace_id`
  - `task_receipts.trace_id`
  - `ledger_events.trace_id`
- `capabilityId` MUST be a valid capability known to the registry.
- `input` MUST be serializable to JSON and hashable.
- `constraints` and `context` are optional but, if present, MUST be
  well-formed per the types above.

## Lifecycle

1. **Build**
   - The coordinator builds an `Invocation` when a DAG node is enqueued
     (see `buildInvocation` in `apps/coordinator/src/services/invocation.ts`).
   - Inputs:
     - workflow/node identifiers
     - node payload + parent outputs
     - budget/timeout/policy/region hints
     - traceId (from request hooks or workflow)

2. **Persist**
   - The `invocationId` is stored on:
     - `dispatch_queue.payload.invocation.invocationId`
     - `task_receipts.invocation_id`
   - A future migration will introduce an `invocations` table keyed by
     `invocationId` for durable lookup.

3. **Transport**
   - The dispatcher sends the `Invocation` to agents inside the JSON payload
     for HTTP POST bodies (and headers `x-nooterra-trace-id` /
     `x-nooterra-invocation-id`).
   - Future transports (MCP/A2A/P2P) will carry the same `Invocation` inside
     a standard envelope.

4. **Receipt**
   - When a node succeeds, `storeReceipt` records:
     - `task_receipts.invocation_id`
     - `task_receipts.trace_id`
     - input/output hashes derived from the same input used in the Invocation.

## Compatibility Notes

- Older agents that do not understand `Invocation` can continue to consume
  legacy fields (`workflowId`, `nodeId`, `inputs`) while newer agents
  read `payload.invocation`.
- Any future mandate / payment / policy encoding MUST be derivable from
  a given `Invocation` and its associated Mandate and AgentCard, not
  from ad-hoc fields on HTTP routes.

