# Action Wallet V1 Freeze

Status: Sprint 0 launch freeze  
Machine-readable source of truth: [`action-wallet-v1-freeze.json`](./action-wallet-v1-freeze.json)

## Scope lock

**V1 lets external agent hosts create action intents for buy and cancel/recover flows, send users to Nooterra-hosted approval pages, receive scoped execution grants, submit evidence, finalize runs, issue receipts, and open disputes.**

Launch actions:

- `buy`
- `cancel/recover`

Launch channels:

- `Claude MCP`
- `OpenClaw`

Explicitly out of scope:

- booking/rebooking
- Nooterra-owned last-mile execution
- certified execution adapters and strict-domain browser fallback
- ChatGPT app
- enterprise connectors and packaging
- A2A
- BYO payment rails
- open specialist publication and marketplace
- general consumer ask box and first-party assistant shell
- physical-world actions

Everything outside approval, grant, evidence, receipt, dispute, or operator recovery is `Phase 1.5+`.
External hosts remain responsible for last-mile execution in v1.

## Object map

| V1 object | Current runtime binding | Alias/API surface | Current anchors |
| --- | --- | --- | --- |
| Action Intent | Public alias over `AuthorityEnvelope.v1` plus host launch metadata | `POST /v1/action-intents` | [`src/core/authority-envelope.js`](../../src/core/authority-envelope.js), [`src/api/openapi.js`](../../src/api/openapi.js), [`test/api-e2e-action-wallet-v1.test.js`](../../test/api-e2e-action-wallet-v1.test.js) |
| Approval Request | `ApprovalRequest.v1` boundary tied to hosted approval pages | `POST /v1/action-intents/{actionIntentId}/approval-requests`, `GET /v1/approval-requests/{requestId}` | [`src/core/authority-envelope.js`](../../src/core/authority-envelope.js), [`docs/spec/schemas/ApprovalRequest.v1.schema.json`](./schemas/ApprovalRequest.v1.schema.json), [`test/api-e2e-action-wallet-v1.test.js`](../../test/api-e2e-action-wallet-v1.test.js) |
| Approval Decision | `ApprovalDecision.v1` approve/deny artifact bound to one request | `POST /v1/approval-requests/{requestId}/decisions` | [`src/core/authority-envelope.js`](../../src/core/authority-envelope.js), [`docs/spec/schemas/ApprovalDecision.v1.schema.json`](./schemas/ApprovalDecision.v1.schema.json), [`test/api-e2e-action-wallet-v1.test.js`](../../test/api-e2e-action-wallet-v1.test.js) |
| Execution Grant | Launch alias over materialized work-order authority plus approval lineage, with grant semantics anchored by `AuthorityGrant.v1` | `GET /v1/execution-grants/{executionGrantId}`, `POST /v1/execution-grants/{executionGrantId}/evidence`, `POST /v1/execution-grants/{executionGrantId}/finalize` | [`src/core/authority-grant.js`](../../src/core/authority-grant.js), [`src/api/openapi.js`](../../src/api/openapi.js), [`test/mcp-action-wallet-aliases.test.js`](../../test/mcp-action-wallet-aliases.test.js) |
| Evidence Bundle | Ordered evidence refs and hosted artifacts submitted before finalize | `POST /v1/execution-grants/{executionGrantId}/evidence`, `POST /v1/execution-grants/{executionGrantId}/finalize` | [`docs/spec/public/SubAgentCompletionReceipt.v1.md`](./public/SubAgentCompletionReceipt.v1.md), [`docs/spec/public/ExecutionAttestation.v1.md`](./public/ExecutionAttestation.v1.md), [`test/api-e2e-action-wallet-v1.test.js`](../../test/api-e2e-action-wallet-v1.test.js) |
| Receipt | Public action-receipt alias over `SubAgentCompletionReceipt.v1` plus settlement state | `GET /v1/receipts/{receiptId}` | [`docs/spec/public/SubAgentCompletionReceipt.v1.md`](./public/SubAgentCompletionReceipt.v1.md), [`docs/spec/SettlementReceipt.v1.md`](./SettlementReceipt.v1.md), [`test/api-e2e-action-wallet-v1.test.js`](../../test/api-e2e-action-wallet-v1.test.js) |
| Dispute Case | Public dispute alias with `DisputeOpenEnvelope.v1` opener proof and operator-visible dispute detail | `POST /v1/disputes` | [`src/core/dispute-open-envelope.js`](../../src/core/dispute-open-envelope.js), [`docs/spec/examples/dispute_open_envelope_v1.example.json`](./examples/dispute_open_envelope_v1.example.json), [`test/dispute-open-envelope-schemas.test.js`](../../test/dispute-open-envelope-schemas.test.js) |
| Standing Rule | `ApprovalStandingPolicy.v1` reusable user rule for host/action thresholds | operator + approval surfaces | [`src/core/approval-standing-policy.js`](../../src/core/approval-standing-policy.js), [`docs/spec/schemas/ApprovalStandingPolicy.v1.schema.json`](./schemas/ApprovalStandingPolicy.v1.schema.json), [`test/approval-standing-policy.test.js`](../../test/approval-standing-policy.test.js) |
| Settlement Event | Finalization money-state projection bound to capture, refund, and dispute-hold outcomes | `POST /v1/execution-grants/{executionGrantId}/finalize` | [`docs/spec/SettlementReceipt.v1.md`](./SettlementReceipt.v1.md), [`test/api-e2e-action-wallet-v1.test.js`](../../test/api-e2e-action-wallet-v1.test.js), [`test/api-e2e-idempotency-settlement-disputes.test.js`](../../test/api-e2e-idempotency-settlement-disputes.test.js) |

The current repo does not need a second execution model for launch. Sprint 0 freezes the host-first names and semantics on top of the existing deterministic authority, approval, completion-receipt, and settlement substrate.

## State machines

### Intent

`draft -> approval_required -> approved -> executing -> evidence_submitted -> verifying -> completed`

Alternate outcomes:

- `draft -> cancelled`
- `approval_required -> failed`
- `approval_required -> cancelled`
- `approved -> cancelled`
- `executing -> failed`
- `executing -> cancelled`
- `evidence_submitted -> failed`
- `verifying -> failed`
- `verifying -> disputed`
- `verifying -> refunded`
- `completed -> disputed`
- `completed -> refunded`
- `failed -> disputed`
- `disputed -> completed`
- `disputed -> refunded`

### Approval

`pending -> approved|denied|expired`

Follow-up:

- `approved -> revoked`

### Dispute

`opened -> triaged -> awaiting_evidence -> resolved|denied|refunded`

Fast paths:

- `opened -> refunded`
- `triaged -> denied`
- `triaged -> refunded`

## Determinism rules

- Create and finalize paths are replay-safe through `x-idempotency-key`.
- Hashing uses canonical JSON (`RFC 8785`) plus `sha256`.
- Sprint 0 hash subjects are `intent`, `grant`, `evidence_bundle`, and `receipt`.
- Current runtime hash anchors live in [`src/core/authority-envelope.js`](../../src/core/authority-envelope.js), [`src/core/authority-grant.js`](../../src/core/authority-grant.js), [`src/core/approval-standing-policy.js`](../../src/core/approval-standing-policy.js), and receipt/settlement artifacts.

## Event taxonomy

- `intent created`
- `approval opened`
- `approval decided`
- `grant issued`
- `evidence submitted`
- `finalize requested`
- `receipt issued`
- `dispute opened`
- `dispute resolved`

Exact wire event names, emit points, payload keys, and metric bindings live in [`ActionWalletEventTaxonomy.v1.md`](./ActionWalletEventTaxonomy.v1.md).
