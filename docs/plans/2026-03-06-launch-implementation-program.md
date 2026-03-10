# Nooterra Launch Implementation Program

Date: March 6, 2026  
Parent PRD: [docs/PRD.md](/Users/aidenlippert/nooterra/docs/PRD.md)  
Launch checklist: [docs/plans/2026-03-06-phase-1-launch-checklist.md](/Users/aidenlippert/nooterra/docs/plans/2026-03-06-phase-1-launch-checklist.md)  
Execution board: [docs/plans/2026-03-06-phase-1-execution-board.md](/Users/aidenlippert/nooterra/docs/plans/2026-03-06-phase-1-execution-board.md)

## Purpose

Turn the launch PRD into an execution program that engineering, design, and operations can build against without product ambiguity.

This document defines:

- the launch goal
- the launch-critical surfaces
- the object and API acceptance criteria
- the sprint-by-sprint build order
- the launch gates

## March 9 Scope Correction

Launch v1 is the host-first Action Wallet and run-contract layer.

- external hosts create intents and execute
- Nooterra owns hosted approvals, scoped grants, evidence, receipts, disputes, and operator recovery
- Nooterra does not own last-mile execution at launch

Moved to `Phase 1.5+`:

- certified execution adapters
- strict-domain browser fallback
- managed specialist network ownership
- first-party assistant shell

## March 9 Launch-Surface Override

Older route maps later in this document still reflect the broader consumer-shell plan.
For launch execution, treat these as the only in-scope user and host surfaces:

- `/approvals`
- `/wallet`
- `/receipts`
- `/disputes`
- `/integrations`
- public API, SDKs, CLI, Claude MCP packaging, and OpenClaw packaging

Treat `/network`, `/launch/:launchId`, `/agents`, and builder publication surfaces as `Phase 1.5+` unless they are explicitly restated under the host-first Action Wallet scope.

## Launch Goal

Ship an invite-only beta where:

1. a connected host can create a real `buy` or `cancel/recover` action intent
2. Nooterra can turn that into a hosted approval and scoped execution grant
3. the host can execute only inside that boundary
4. the host can submit evidence and request finalize
5. Nooterra can issue a receipt, bind settlement state, and support disputes
6. operators can recover the top failure modes without engineering-only repair

## Launch Surfaces

### 1. Hosted User Surfaces

These are the trust-critical pages users touch during launch:

| Route | Purpose | Launch status |
| --- | --- | --- |
| `/approvals` | show pending approvals and decision controls | refine |
| `/wallet` | show payment methods, standing rules, trusted hosts, and revocation | refine |
| `/receipts` | show material-action receipts and settlement state | build |
| `/disputes` | let users open and track disputes | build |
| `/integrations` | show connected hosts and revoke access | build |

### 2. Operator Surfaces

| Route | Purpose | Launch status |
| --- | --- | --- |
| `/operator` | rescue queues, verification backlog, payment failures, disputes | build |
| `/operator/runs/:runId` | inspect intent, approval, grant, evidence, receipt, settlement, and audit trail | build |
| `/operator/disputes/:caseId` | resolve dispute lifecycle and record notes | build |

### 3. Host and Developer Surfaces

| Surface | Purpose | Launch status |
| --- | --- | --- |
| Public API | host-created intents, approvals, grants, evidence, finalize, receipts, disputes | refine |
| Claude MCP | reference host integration | refine |
| OpenClaw | reference host integration | refine |
| TypeScript/Python SDKs | thin wrappers over the launch API | build |
| CLI + install docs | design-partner testing and first approval in under 5 minutes | build |

## Launch Objects and Acceptance Criteria

### 1. Action Intent

Acceptance criteria:

- host can create it through a stable public API
- it binds host identity, action type, scope hints, and approval requirements
- intent identity survives approval, finalize, receipt, and dispute
- invalid state transitions are blocked and logged

### 2. Approval Request and Decision

Acceptance criteria:

- approval requests are hosted and one-time usable
- decisions are bound to request, user session, and decision time
- standing-rule evaluation is explicit and auditable
- approval history is visible to users and operators

### 3. Execution Grant

Acceptance criteria:

- grant binds principal, action type, host id, allowlist, spend cap, expiry, evidence requirements, nonce, and lineage placeholder
- grant is fetchable only after approval or policy-driven auto-approval
- grant mismatches fail closed before finalize
- revocation is respected immediately for not-yet-executed flows

### 4. Evidence Bundle

Acceptance criteria:

- `buy` evidence requirements are explicit
- `cancel/recover` evidence requirements are explicit
- artifact uploads are signed and auditable
- missing required evidence fails closed

### 5. Receipt

Acceptance criteria:

- receipt binds approval, grant, evidence, settlement, verifier verdict, dispute state, and deterministic hash
- receipt exists for every completed material action
- receipt is visible through a hosted page and API alias
- receipt state remains coherent through refund and dispute outcomes

### 6. Dispute Case

Acceptance criteria:

- dispute can be opened from receipt context
- dispute state progresses through triage, evidence wait, and resolution without DB repair
- operator notes and actions are auditable
- dispute outcomes feed the receipt and support flow

### 7. Settlement Event

Acceptance criteria:

- one payment path is integrated for launch
- `buy` supports authorize, capture-after-verify, and refund
- `cancel/recover` supports non-capture close state plus recovered-amount metadata
- provider webhooks reconcile into the settlement ledger

## Sprint Program

### Sprint 0: Scope and Architecture Freeze

Goal: freeze the contract and eliminate launch ambiguity.

Ship:

- object model, state machines, grant semantics, receipts, disputes, idempotency, hashing, event taxonomy
- narrative reset docs
- launch checklist and board alignment

Exit gate:

- schemas locked
- state machines locked
- non-goals locked
- design-partner list committed

### Sprint 1: Control Plane Skeleton

Goal: create and approve an intent end to end in staging.

Ship:

- account setup, session management, approval-link security, host auth, revocation
- action intent and approval APIs
- wallet envelope, standing rules, policy evaluation, grant minting/revocation
- hosted approval and wallet surfaces
- structured logging, analytics, Sentry, and baseline dashboard hooks

Exit gate:

- host can create intent
- user can approve
- execution grant can be fetched
- all transitions are logged

### Sprint 2: Evidence, Receipt, and Dispute Core

Goal: complete the proof loop.

Ship:

- grant fetch, evidence submit, finalize, receipt fetch, dispute open/read
- evidence schemas, verifier states, receipt generation, insufficiency UX
- receipts, disputes, integrations, and operator queue/detail surfaces

Exit gate:

- evidence can be submitted
- verifier can pass, fail, or request more evidence
- receipt is generated
- dispute can be opened from receipt context

### Sprint 3: Payments and Settlement

Goal: make the money path safe and real.

Ship:

- payment method vault integration and wallet surfaces
- auth, capture-after-verify, refund, settlement ledger, webhooks, failure states
- operator health panel, audit feed, notes
- alerting, security review, kill switches

Exit gate:

- `buy` can authorize, capture after verification, and refund
- `cancel/recover` closes with the right receipt money state
- uncapped spend is impossible in staging

### Sprint 4: Host Pack

Goal: get the first external host running cleanly.

Ship:

- MCP server and launch tools
- hosted approval deep links
- poll and webhook continuation model
- SDKs, CLI, setup helper, OpenClaw packaging, reference apps, install docs
- synthetic smoke tests and design-partner onboarding kit

Exit gate:

- install to first approval is under 5 minutes on a reference host
- sample integrations work in staging
- hosted approval deep links are stable

### Sprint 5: Design-Partner Pilots and Launch-Risk Cuts

Goal: remove the remaining narrative and operational launch risks.

Ship:

- API docs and launch copy polish
- support macros and incident runbooks
- design-partner validation on supported flows
- board, docs, and demo cleanup so nothing implies owned execution

Exit gate:

- first partner completes approval to receipt with host-owned execution
- operators can recover top failure modes from runbooks
- no launch doc, board, or demo implies Nooterra-owned execution

### Sprint 6: Burn-In and Hardening

Goal: launch only after measurable reliability.

Ship:

- abuse controls
- backup and restore drill
- post-launch review template
- bug bash, incident simulation, kill-switch drills, final metrics board

Exit gate:

- receipt coverage is 100% for completed material actions
- zero successful out-of-scope executions in staging or partner pilot
- dispute flow works end to end without DB repair
- launch metrics board is live

## Launch Gates

Do not launch because the code feels done. Launch only if these are true:

- first host install to first approval is under 5 minutes
- approval-to-completion conversion is above 60% on supported actions
- receipt coverage is 100% for completed material actions
- no successful out-of-scope execution occurs in staging or partner pilot
- dispute resolution works end to end
- operator can quarantine a host in under 2 minutes
- payment capture never occurs before verification pass
- support can resolve the top five failure modes from a runbook

## Phase 1.5

These are explicitly not part of launch:

- certified execution adapters
- strict-domain browser fallback
- Nooterra-owned last-mile execution
- booking or rebooking
- ChatGPT app packaging
- enterprise connectors
- open marketplace publication
- generalized browser automation as a launch promise
