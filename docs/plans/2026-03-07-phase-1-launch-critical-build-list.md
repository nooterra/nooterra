# Nooterra Phase 1 Launch-Critical Build List

Date: March 7, 2026  
Status: Locked for Phase 1 execution  
Parent PRD: [docs/PRD.md](/Users/aidenlippert/nooterra/docs/PRD.md)  
Execution board: [docs/plans/2026-03-06-phase-1-execution-board.md](/Users/aidenlippert/nooterra/docs/plans/2026-03-06-phase-1-execution-board.md)  
Founder decision memo: [docs/plans/2026-03-07-founder-product-decision-memo.md](/Users/aidenlippert/nooterra/docs/plans/2026-03-07-founder-product-decision-memo.md)

## Purpose

Define the exact launch-critical build list so the team can reject anything that does not strengthen the host-first Action Wallet.

## March 9 Scope Correction

Launch v1 is the host-first Action Wallet control plane.

- external hosts execute
- Nooterra owns approval, grant, evidence, receipt, dispute, and operator recovery
- certified execution adapters, browser fallback, and Nooterra-owned last-mile execution are `Phase 1.5+`

## Scope Rule

A new subsystem only enters Phase 1 if it makes one of these stronger:

- approval
- grant
- evidence
- receipt
- dispute
- operator recovery

If it does not, it is not launch-critical.

## Launch-Critical

### 1. Scope Lock and Contract Freeze

Owner: `Lane A + Founder`

Acceptance criteria:

- object model is frozen
- state machines are frozen
- idempotency and hashing rules are frozen
- every launch doc and board matches the freeze

### 2. Hosted Approvals and Wallet

Owner: `Lane B`

Acceptance criteria:

- hosted approval pages are launch-grade
- wallet shows payment methods, trusted hosts, standing rules, and revocation paths
- scope mismatch and revocation fail closed
- users can see recourse before they approve

### 3. Public API and Grants

Owner: `Lane A`

Acceptance criteria:

- host can create intent, request approval, fetch grant, submit evidence, finalize, fetch receipt, and open dispute
- host auth, user auth, and operator auth are enforced
- grants remain bounded by action type, host, spend, expiry, and evidence requirements
- create and finalize endpoints are idempotent

### 4. Evidence, Verification, and Receipts

Owner: `Lane A`

Acceptance criteria:

- `buy` and `cancel/recover` have explicit evidence contracts
- verifier can pass, fail, or request more evidence
- every completed material action gets a receipt
- receipts bind approval, grant, evidence, settlement, and dispute state

### 5. Disputes and Recourse

Owner: `Lane A + Lane B`

Acceptance criteria:

- user can open a dispute from receipt context
- dispute state is visible to user and operator views
- refund and resolution outcomes remain tied to the same run
- no dispute flow requires DB repair

### 6. One Payment Path and Settlement Binding

Owner: `Lane A`

Acceptance criteria:

- one managed payment provider is integrated
- `buy` supports authorize, capture after verification, and refund
- `cancel/recover` closes with the right receipt money state
- payment capture never occurs before verification passes

### 7. Operator Rescue

Owner: `Lane B + Lane D`

Acceptance criteria:

- operator run detail shows intent, approval, grant, evidence, settlement, and dispute
- rescue controls include retry finalize, request evidence, pause, revoke, refund, resolve dispute, and quarantine host
- audit trail is complete
- operators can recover the top failure modes from runbooks

### 8. Host Pack

Owner: `Lane C`

Acceptance criteria:

- Claude MCP and OpenClaw integrations work in staging
- SDKs and CLI cover launch API flows
- hosted approval deep links are stable
- install to first approval is under 5 minutes on a reference host

### 9. Observability, Security, and Launch Ops

Owner: `Lane D`

Acceptance criteria:

- launch metrics board is live
- Sentry, logging, alerts, and smoke tests cover launch flows
- security review covers auth, approval links, replay, and scope mismatch
- kill switches work per host, per channel, and per action type

### 10. Design-Partner Readiness

Owner: `Founder + Lane C + Lane D`

Acceptance criteria:

- first design-partner hosts are named
- support path is written
- launch demo matches host-run execution reality
- no partner-facing artifact implies Nooterra-owned execution

## Hard Cuts

These are not part of Phase 1:

- certified execution adapters
- strict-domain browser fallback
- Nooterra-owned last-mile execution
- managed specialist network ownership
- first-party assistant shell
- booking or rebooking
- open marketplace publication
- enterprise connectors

## Bottom Line

The launch build is not a consumer assistant and not an execution marketplace.

It is the minimum trustworthy control plane for host-run material actions.
