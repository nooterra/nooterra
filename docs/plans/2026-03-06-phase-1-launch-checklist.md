# Nooterra Phase 1 Launch Checklist

Date: March 6, 2026  
Parent PRD: [docs/PRD.md](/Users/aidenlippert/nooterra/docs/PRD.md)  
Implementation program: [docs/plans/2026-03-06-launch-implementation-program.md](/Users/aidenlippert/nooterra/docs/plans/2026-03-06-launch-implementation-program.md)  
Execution board: [docs/plans/2026-03-06-phase-1-execution-board.md](/Users/aidenlippert/nooterra/docs/plans/2026-03-06-phase-1-execution-board.md)

## Purpose

Define the go/no-go checklist for Action Wallet v1.

Phase 1 is complete only when an external host can create a supported action, the user can approve it through Nooterra, the host can execute inside a scoped grant, and Nooterra can issue a receipt and support dispute or operator recovery without ad hoc repair.

This is the launch gate. It is not a product vision memo.

## March 9 Scope Correction

Launch v1 is the host-first Action Wallet control plane, not a Nooterra-owned execution network.

For launch:

- external hosts execute
- Nooterra owns approval, grant, evidence, receipt, dispute, and operator recovery
- certified execution adapters and browser fallback are `Phase 1.5+`

## Scope Lock

- `[ ] P0` Supported actions are locked to `buy` and `cancel/recover`.
- `[ ] P0` Supported channels are locked to `Claude MCP` and `OpenClaw`.
- `[ ] P0` Hosted approvals, scoped grants, receipts, disputes, and operator rescue are the only launch-critical trust surfaces.
- `[ ] P0` Booking/rebooking, ChatGPT app packaging, enterprise connectors, BYO payment rails, open marketplace publication, first-party assistant shell, and Nooterra-owned last-mile execution are blocked from launch scope.
- `[ ] P0` No launch doc, board, demo, or UI implies that Nooterra itself performs the last-mile action.

## 1. Host Pack

- `[ ] P0` A host can create an action intent through the public API.
- `[ ] P0` A host can request a hosted approval page and receive a stable `approvalUrl`.
- `[ ] P0` A host can poll or receive webhook updates for approval state.
- `[ ] P0` A host can fetch a scoped execution grant only after approval or standing-policy auto-approval.
- `[ ] P0` TypeScript and Python SDKs wrap the launch API without inventing host-specific semantics.
- `[ ] P0` Claude MCP and OpenClaw reference integrations reach first approval in under 5 minutes.
- `[ ] P1` CLI flows cover intent creation, approval waiting, evidence submission, finalize, and receipt fetch for debugging.

## 2. Approval and Wallet

- `[ ] P0` Users can sign in with a launch-approved auth path and recover access safely.
- `[ ] P0` Approval links are short-lived, single-session bound, and non-reusable after decision.
- `[ ] P0` Hosted approval pages show host, action, vendor or domain, spend cap, time window, evidence requirements, and recourse path in plain language.
- `[ ] P0` Users can approve once, deny, or create bounded standing rules where allowed.
- `[ ] P0` Users can inspect and revoke trusted hosts, standing rules, and not-yet-executed grants.
- `[ ] P0` Policy evaluation fails closed on expired grants, scope mismatch, or revoked authority.
- `[ ] P1` Users can review payment methods, standing rules, and trusted hosts from one wallet surface.

## 3. Evidence, Receipt, and Dispute Loop

- `[ ] P0` Every completed material action binds the originating approval, execution grant, evidence bundle, verifier verdict, settlement state, and dispute state.
- `[ ] P0` `buy` evidence requirements are explicit and enforced.
- `[ ] P0` `cancel/recover` evidence requirements are explicit and enforced.
- `[ ] P0` Missing or mismatched required evidence fails closed before completion.
- `[ ] P0` A receipt is generated for every completed material action.
- `[ ] P0` Receipt coverage is 100% for completed material actions in staging and partner pilot.
- `[ ] P0` A user can open a dispute directly from the receipt or run context.
- `[ ] P0` Dispute state is visible to both the user and operator surfaces without manual DB inspection.

## 4. Payments and Settlement

- `[ ] P0` Launch uses one managed payment provider.
- `[ ] P0` `buy` actions can authorize, capture after verification pass, and refund.
- `[ ] P0` `cancel/recover` actions close with a correct receipt state even when no capture occurs.
- `[ ] P0` Payment capture never occurs before verification passes.
- `[ ] P0` Spend caps and vendor or domain bounds are enforced at finalize.
- `[ ] P0` Failed payment states are visible with user-readable retry or recourse paths.
- `[ ] P1` Settlement ledger entries can be reconciled against provider webhook events without manual inference.

## 5. Operator Recovery

- `[ ] P0` Operators can inspect intent, approval, grant, evidence, receipt, settlement, and dispute state from one run detail view.
- `[ ] P0` Operators can retry finalize, request more evidence, pause, revoke, refund, resolve dispute, and quarantine a host.
- `[ ] P0` Every operator action is auditable and tied to an actor plus note.
- `[ ] P0` Rescue actions do not bypass grant or evidence policy.
- `[ ] P0` The top five expected launch failures have a runbook-backed rescue path.
- `[ ] P1` Queue views exist for pending verification, insufficient evidence, payment failures, disputes, and host-runtime failures.

## 6. Trust, Safety, and Reliability

- `[ ] P0` Invalid state transitions are blocked and logged.
- `[ ] P0` Create and finalize endpoints support idempotency keys.
- `[ ] P0` Stable hashes exist for intent, grant, evidence bundle, and receipt.
- `[ ] P0` Host auth, user auth, operator auth, CSRF/session protections, and replay protections have a launch review.
- `[ ] P0` Kill switches exist per host, per channel, and per action type.
- `[ ] P0` Approval, finalize, webhook, and queue failures are observable through logs, analytics, and alerts.
- `[ ] P0` Synthetic smoke tests cover hourly staging and daily production launch flows.
- `[ ] P1` Backup and restore drill covers DB plus artifact metadata.

## 7. Metrics and Launch Ops

- `[ ] P0` Sprint review opens with the launch metrics board.
- `[ ] P0` The operator dashboard defaults to launch-scoped metrics for `buy` and `cancel/recover`, with any broader category clearly marked as follow-on and non-gating.
- `[ ] P0` The launch board shows actions, channels, trust surfaces, approval conversion, receipt coverage, out-of-scope execution attempts, dispute-linked rescue load, and quarantine or recovery readiness first.
- `[ ] P0` Managed supply, marketplace, specialist-network, or Nooterra-owned execution signals do not appear as launch-critical operator claims unless scope is explicitly widened.
- `[ ] P0` Product metrics include install-to-first-approval time, approval completion rate, approval-to-completion conversion, receipt coverage, dispute rate, and repeat host usage.
- `[ ] P0` Trust metrics include out-of-scope execution attempts, grant validation failures, evidence insufficiency rate, verifier fail rate, refund required rate, and operator override rate.
- `[ ] P0` Ops metrics include p95 approval page load, finalize latency, webhook failure rate, host runtime failure rate, queue delay, and incident count.
- `[ ] P0` Business metrics include active hosts, action volume, GMV, take-rate revenue, dispute loss, and refund exposure.
- `[ ] P0` Support can resolve the top five failure modes from written runbooks during launch hours.

## 8. Hard Launch Gates

- `[ ] P0` First host install to first approval is under 5 minutes.
- `[ ] P0` Approval-to-completion conversion is above 60% on supported actions.
- `[ ] P0` Receipt coverage is 100% for completed material actions.
- `[ ] P0` No successful out-of-scope execution occurs in staging or partner pilot.
- `[ ] P0` Dispute resolution works end to end without DB repair.
- `[ ] P0` Operator can quarantine a host in under 2 minutes.
- `[ ] P0` Payment capture never occurs before verification pass.
- `[ ] P0` Operator-facing launch metrics ignore out-of-scope categories even if the raw endpoint still exposes broader Phase 1 rows.
- `[ ] P0` The launch board, demo, docs, and GitHub issues all reflect the host-first Action Wallet scope with no managed-specialist or owned-execution claim.

## Phase 1.5, Not Launch

- certified execution adapters
- strict-domain browser fallback
- Nooterra-owned last-mile execution
- first-party assistant shell
- booking or rebooking
- ChatGPT app packaging
- enterprise connectors
- open marketplace publication
- multi-agent downstream delegation beyond lineage placeholder
