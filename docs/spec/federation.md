# Federation Spec (v0.1)

This document describes the initial coordinator–to–coordinator federation layer in Nooterra.

The goal of v0.1 is to support **trusted multi‑coordinator execution** while reusing the existing
Invocation, Mandate, Envelope, Receipt, and Ledger primitives.

Federation is currently **permissioned and honest‑but‑buggy**: coordinators are explicitly
configured as peers and are expected to behave correctly. Byzantine behavior and
permissionless admission are out of scope for this version.

---

## Coordinator Identity

- Each coordinator has a stable DID:
  - `COORDINATOR_DID` (string, e.g. `did:noot:coord:A`).
- A coordinating process logs its DID at startup and uses it when emitting federation envelopes.
- Known peers are stored in `coordinator_peers` with:
  - `id` (peer coordinator DID),
  - `endpoint` (base URL for that coordinator),
  - `region`,
  - `public_key` (reserved for future signature verification),
  - `status` (`active` / `inactive`),
  - `capabilities` (array of strings),
  - `last_seen_at`, `agent_count`, `workflow_count`, `cpu_usage`, `memory_usage`.

The helper `isTrustedCoordinator(originId)` checks `FEDERATION_TRUST_ALL` or the
`coordinator_peers` table to gate inbound federation traffic.

---

## Envelopes

Federation relies on two envelope types defined in `@nooterra/types`:

### `CoordinatorInvokeEnvelope`

```ts
interface CoordinatorInvokeEnvelope {
  version: "1.0";
  type: "coordinatorInvoke";
  originDid: string;
  targetDid: string;
  traceId: string;
  invocation: Invocation;
  mandateId?: string | null;
  signature?: string;
  signatureAlgorithm?: string;
}
```

Semantics:

- `originDid` is the coordinator that initiated the request.
- `targetDid` must equal the receiving coordinator's `COORDINATOR_DID`.
- `invocation` is the canonical Invocation payload (see `docs/spec/invocation.md`).
- `traceId` ties the remote execution back into the origin coordinator's trace.
- `signature*` are reserved for future coordinator‑level signing; in v0.1
  they are logged if present but not enforced.

### `CoordinatorResultEnvelope`

```ts
interface CoordinatorResultEnvelope {
  version: "1.0";
  type: "coordinatorResult";
  originDid: string;
  targetDid: string;
  traceId: string;
  invocationId: string;
  resultEnvelope: AgentResultEnvelope;
  signature?: string;
  signatureAlgorithm?: string;
}
```

Semantics:

- `originDid` is the coordinator executing the remote work.
- `targetDid` is the origin coordinator that requested the work.
- `resultEnvelope` is the agent result envelope (including optional agent signature) that
  would have been returned in a local execution.

---

## Routes

### `/v1/federation/invoke` (Coordinator → Coordinator)

Handler lives in `apps/coordinator/src/routes/federation.ts`.

Flow:

1. Validate envelope `version`/`type` and `targetDid === COORDINATOR_DID`.
2. Reject if `originDid` is not trusted via `isTrustedCoordinator`.
3. Optionally log the presence of a coordinator signature.
4. Insert an `invocations` row (idempotent on `invocation_id`).
5. Enqueue a normal `node.dispatch` entry in `dispatch_queue` with payload:
   - `invocation`,
   - `traceId`,
   - `agentDid`,
   - `capabilityId`,
   - `viaFederation: true`,
   - `originCoordinatorDid`.
6. Log `routing: "federation_invoke_received"` and return `202 { status: "queued" }`.

From the dispatcher’s perspective, a federated invocation is just another Invocation
to execute locally.

### `/v1/federation/result` (Coordinator → Coordinator)

Flow:

1. Validate envelope `version`/`type` and `targetDid === COORDINATOR_DID`.
2. Reject if `originDid` is not trusted.
3. Locate the corresponding `invocations` row by `invocationId`.
4. Resolve `workflow_id`, `node_name`, `capability_id`, `agent_did`, `trace_id`, `input`.
5. Soft‑verify the agent result envelope signature using `verifyResultEnvelopeSignature`.
6. Call `storeReceipt` with:
   - `workflowId`, `nodeName`, `agentDid`, `capabilityId`,
   - `output` (from `resultEnvelope.result`),
   - `input`,
   - `traceId`,
   - `invocationId`,
   - `resultEnvelope`,
   - `envelopeSignatureValid`.
7. Log `routing: "federation_result_received"` and return `{ status: "ok" }`.

Settlement uses the existing receipt + ledger pipeline. Federated results are
written into `task_receipts` just like local results.

---

## Routing via `executionCoordinatorDid`

The router decides between local HTTP dispatch and federated coordinator dispatch
based on the `executionCoordinatorDid` field on the canonical AgentCard:

- `AgentRoutingProfile.executionCoordinatorDid` is derived from:
  - `agent_card.executionCoordinatorDid`, or
  - `agent_card.metadata.executionCoordinatorDid` (if present).

In `enqueueNode`:

- If `executionCoordinatorDid` is unset or equal to this coordinator's DID:
  - dispatch locally via the agent endpoint as before.
- If `executionCoordinatorDid` differs from this coordinator's DID:
  - look up the peer in `coordinator_peers`,
  - build a `CoordinatorInvokeEnvelope`,
  - POST to `/v1/federation/invoke` on that peer,
  - log `routing: "federation_dispatch"` on success,
  - fall back to local dispatch if the federation call fails.

This makes AgentCard the single place that decides where an agent actually runs.

---

## Federation Stats

For operator introspection there is a lightweight internal endpoint:

```http
GET /internal/federation/stats
```

It returns:

```json
{
  "coordinatorDid": "did:noot:coord:A",
  "totalPeers": 2,
  "peersByStatus": {
    "active": 2
  },
  "activePeersLast5m": 2
}
```

Counts are derived from `coordinator_peers` and are intended for quick health checks.

---

## Threat Model (v0.1)

- Federation is currently **permissioned**:
  - coordinators must be added to `coordinator_peers` (or `FEDERATION_TRUST_ALL=true`)
    before their envelopes are accepted.
- Coordinator signatures on federation envelopes are **logged but not enforced**.
- Agents are still authenticated/authorized via the existing coordinator → agent
  envelope and signature path.

Handling malicious/Byzantine coordinators, dynamic trust, and on‑chain proofs are
left for future protocol versions.

