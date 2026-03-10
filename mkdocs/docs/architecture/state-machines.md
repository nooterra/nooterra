# State Machines

Nooterra launch v1 uses a host-first Action Wallet lifecycle.
External hosts originate the action, and Nooterra owns approval, grant issuance, evidence verification, receipts, disputes, and rescue.

Launch scope is locked to:

- actions: `buy`, `cancel/recover`
- channels: `Claude MCP`, `OpenClaw`

## 1) Action intent lifecycle

`draft -> approval_required -> approved -> executing -> evidence_submitted -> verifying -> completed`

Alternate outcomes:

- `approval_required -> failed`
- `approval_required -> cancelled`
- `executing -> failed`
- `executing -> cancelled`
- `verifying -> failed`
- `verifying -> disputed`
- `verifying -> refunded`
- `completed -> disputed`
- `completed -> refunded`

Rules:

- invalid transitions fail closed
- every transition is logged with stable event names
- finalize is blocked unless the execution grant is still in scope and unexpired

## 2) Approval request lifecycle

`pending -> approved|denied|expired`

Follow-up:

- `approved -> revoked` before execution completes

Rules:

- approval links are short-lived and single-session bound
- one approval request yields at most one terminal decision path
- revoked or expired approvals cannot be reused to mint fresh execution scope

## 3) Dispute lifecycle

`opened -> triaged -> awaiting_evidence -> resolved|denied|refunded`

Fast paths:

- `opened -> refunded`
- `triaged -> denied`
- `triaged -> refunded`

Rules:

- disputes bind back to receipt, grant, and settlement context
- refund and resolution actions remain auditable operator moves
- dispute handling does not repair state by hidden manual mutation

## 4) Settlement and rescue guards

- capture happens only after verification pass
- grant mismatch, vendor mismatch, expiry, or spend overrun fail closed
- operator rescue can pause, revoke, refund, or request more evidence, but does not bypass evidence requirements
- create and finalize paths remain replay-safe through idempotency keys
