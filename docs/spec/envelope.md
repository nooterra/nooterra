# Agent Message Envelope (Execution IPC)

This document defines the minimal envelope shape used for coordinator ↔ agent
execution messages over HTTP. It is intentionally small and designed to
generalize cleanly to A2A / MCP / P2P transports.

## Invoke Envelope

```ts
interface AgentInvokeEnvelope {
  version: "1.0";
  type: "invoke";
  traceId: string;
  invocation: Invocation;        // from @nooterra/types
  senderDid: string;             // usually the coordinator DID
  sentAt: string;                // ISO8601 timestamp
  signature?: string;            // optional, e.g. HMAC or Ed25519
  signatureAlgorithm?: string;   // e.g. "ed25519"
}
```

HTTP headers (current implementation):

- `x-nooterra-trace-id`: `traceId`
- `x-nooterra-invocation-id`: `invocation.invocationId`
- `x-nooterra-workflow-id`: workflow UUID (legacy)
- `x-nooterra-node-id`: node name (legacy)

Body (current implementation):

- Contains:
  - `invocation` (canonical `Invocation`)
  - `envelope` (inline `AgentInvokeEnvelope` for agents that explicitly want it)
  - legacy fields for compatibility:
    - `workflowId`
    - `nodeId`
    - `capabilityId`
    - `inputs`

Agents SHOULD prefer `invocation` (and/or `envelope`) and treat the legacy
fields as fallback.

## Result Envelope

```ts
interface AgentResultEnvelope {
  version: "1.0";
  type: "result" | "error";
  traceId: string;
  invocationId: string;
  senderDid: string;          // agent DID
  sentAt: string;             // ISO8601
  result?: unknown;           // capability output
  error?: string;             // error description, if any
  signature?: string;         // optional Ed25519 signature over envelope fields
  signatureAlgorithm?: string;
}
```

Return body (current implementation):

- Native agents typically POST back a JSON body with:
  - `workflowId`
  - `nodeId`
  - `result` (or `error`)
  - `metrics` (latency, tokens)

The coordinator currently adapts this into its own bookkeeping and
generates receipts. A future iteration will standardize this onto
`AgentResultEnvelope` directly.

## Evolution Plan

1. **Today**
   - Coordinator includes `invocation` in payloads and emits trace headers.
   - Agents MAY read `invocation` and respond in legacy shape.

2. **Next**
   - Define `AgentInvokeEnvelope` / `AgentResultEnvelope` in `@nooterra/types`.
   - Update coordinator adapters to send/expect these envelopes while still
     accepting the legacy payloads.

## Signature Semantics (v0 soft verification)

When `signature` and `signatureAlgorithm` are present on a result envelope,
the coordinator performs a **soft** verification:

- `signatureAlgorithm === "ed25519"`:
  - It loads the agent's canonical `AgentCard` and uses `keys.signingPublicKey`
    (base58) to verify the envelope JSON minus `signature` fields with
    `tweetnacl`.
  - The outcome is stored on the receipt as:
    - `task_receipts.envelope_signature_valid`:
      - `true` → signature valid
      - `false` → signature present but invalid
      - `null` → no signature or unsupported algorithm

No payment or routing decisions are currently blocked on this flag; it is used
for observability and as an input to reputation.

An internal aggregate endpoint:

- `GET /internal/envelope-signatures`

summarizes signature validity per agent:

- `total`, `valid`, `invalid`, `invalidRatio`.

## Evolution Plan

1. **Today**
   - Coordinator includes `invocation` in payloads, emits trace headers, and
     accepts both legacy and envelope-shaped responses.
   - Result envelopes with Ed25519 signatures are verified softly and recorded
     on receipts for observability.

2. **Next**
   - Standardize result body shape to always carry `AgentResultEnvelope`.
   - Feed `envelope_signature_valid` into `agent_reputation.verification_score`
     (alongside verifier compliance results).

3. **Future**
   - Align the envelope with A2A/MCP conventions so that Nooterra execution
     can run over:
     - HTTP (current)
     - A2A channels
     - MCP tool calls
     - P2P overlays
   - Require valid signatures for high‑risk capabilities and use them as
     strong evidence in dispute / slashing logic.
