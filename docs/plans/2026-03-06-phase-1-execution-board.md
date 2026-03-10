# Nooterra Phase 1 Execution Board

Date: March 6, 2026  
Parent PRD: [docs/PRD.md](/Users/aidenlippert/nooterra/docs/PRD.md)  
Implementation program: [docs/plans/2026-03-06-launch-implementation-program.md](/Users/aidenlippert/nooterra/docs/plans/2026-03-06-launch-implementation-program.md)  
Launch checklist: [docs/plans/2026-03-06-phase-1-launch-checklist.md](/Users/aidenlippert/nooterra/docs/plans/2026-03-06-phase-1-launch-checklist.md)  
Founder decision memo: [docs/plans/2026-03-07-founder-product-decision-memo.md](/Users/aidenlippert/nooterra/docs/plans/2026-03-07-founder-product-decision-memo.md)  
Launch-critical build list: [docs/plans/2026-03-07-phase-1-launch-critical-build-list.md](/Users/aidenlippert/nooterra/docs/plans/2026-03-07-phase-1-launch-critical-build-list.md)

## Purpose

Map the launch-critical Action Wallet scope to owner lanes, current repo surfaces, and the next gate required for launch.

This board tracks the host-first wallet product. It is not a consumer-shell roadmap or a managed-specialist program.

Operator metrics are launch-critical only when they are scoped to `buy` and `cancel/recover` on `Claude MCP` and `OpenClaw`.
If a dashboard includes broader Phase 1 task families, those rows are informational and non-gating.

## Lane Legend

- `Lane A` — control plane, domain objects, API, grants, settlement, receipts, disputes
- `Lane B` — hosted approvals, wallet, receipts, disputes, integrations, operator UI
- `Lane C` — MCP server, OpenClaw packaging, SDKs, CLI, host samples
- `Lane D` — observability, security, smoke tests, alerts, metrics board, runbooks

## Status Legend

- `Shipped` — present in the repo and wired into the launch path
- `Refine` — present but still needs launch-grade tightening or QA
- `Build` — materially missing
- `Validate` — built enough to test, but not yet proven against launch gates

## Board

### 1. Scope and Contract Freeze

| Ref | Item | Owner | Current repo surface | Status | Next gate |
| --- | --- | --- | --- | --- | --- |
| 1.1 | Lock Action Wallet scope, objects, and state machines | Lane A | [ACTION_WALLET_V1_FREEZE.md](/Users/aidenlippert/nooterra/docs/spec/ACTION_WALLET_V1_FREEZE.md), schema anchors, freeze tests | `Shipped` | keep docs, OpenAPI, and board aligned with the freeze |
| 1.2 | Keep idempotency, hashing, and events deterministic | Lane A | core objects, API tests, freeze test coverage | `Validate` | complete Sprint 0 acceptance against launch aliases |
| 1.3 | Prevent launch drift into owned execution | Founder + Lane D | planning docs, GitHub board, launch metrics review | `Validate` | no launch artifact implies Nooterra-owned execution |

### 2. Hosted Approval and Wallet Surfaces

| Ref | Item | Owner | Current repo surface | Status | Next gate |
| --- | --- | --- | --- | --- | --- |
| 2.1 | Hosted approval request and decision flow | Lane B | `/approvals`, approval request and decision routes, continuation flows | `Refine` | prove host-created intent to hosted approval to decision in staging |
| 2.2 | Wallet visibility for hosts, rules, grants, and payment methods | Lane B | `/wallet`, standing-policy and integration surfaces | `Refine` | unify trusted hosts, rules, and revocation into one launch-grade view |
| 2.3 | Receipt and dispute user surfaces | Lane B | `/receipts`, `/disputes`, receipt/dispute detail flows | `Refine` | prove open-dispute-from-receipt path end to end |
| 2.4 | Operator run detail and rescue controls | Lane B | operator dashboard, rescue queue, run detail views | `Build` | reach one-screen intent to receipt to dispute inspection with rescue actions |

### 3. Control Plane and Public API

| Ref | Item | Owner | Current repo surface | Status | Next gate |
| --- | --- | --- | --- | --- | --- |
| 3.1 | Action-intent, approval, grant, evidence, receipt, and dispute aliases | Lane A | public `/v1/*` aliases, OpenAPI, API tests | `Refine` | complete CRUD and idempotency coverage for launch endpoints |
| 3.2 | Grant minting, revocation, and scope mismatch blocking | Lane A | authority and approval primitives, policy evaluation, finalize path | `Validate` | prove vendor, spend, action-type, and expiry mismatch all fail closed |
| 3.3 | Settlement state bound to receipt and dispute | Lane A | settlement, receipts, disputes, finalize flows | `Validate` | prove authorize/capture/refund behavior for `buy` and close-state behavior for `cancel/recover` |

### 4. Host Pack and Launch Channels

| Ref | Item | Owner | Current repo surface | Status | Next gate |
| --- | --- | --- | --- | --- | --- |
| 4.1 | Claude MCP integration path | Lane C | MCP server, tool aliases, quickstart docs | `Refine` | first approval in under 5 minutes from a clean install |
| 4.2 | OpenClaw integration path | Lane C | OpenClaw packaging, quickstart docs, sample integration | `Refine` | stable hosted approval deep links plus receipt fetch path |
| 4.3 | SDKs, CLI, and install docs | Lane C | TypeScript SDK, Python SDK, CLI, `nooterra setup`, docs | `Build` | design partner can integrate without inventing their own approval or receipt grammar |

### 5. Evidence, Payments, and Verification

| Ref | Item | Owner | Current repo surface | Status | Next gate |
| --- | --- | --- | --- | --- | --- |
| 5.1 | Evidence schemas and artifact storage | Lane A | evidence routes, artifact handling, receipt bindings | `Build` | prove required evidence per action type before finalize succeeds |
| 5.2 | Verifier and insufficiency handling | Lane A + Lane B | verifier states, receipt generation, insufficiency UX | `Build` | pass/fail/insufficient/operator-review flow works in staging |
| 5.3 | One payment path with settlement binding | Lane A | payment method vault hooks, settlement records, webhook ingestion | `Build` | capture only after verification pass and reflect final money state in receipt |

### 6. Ops, Security, and Launch Readiness

| Ref | Item | Owner | Current repo surface | Status | Next gate |
| --- | --- | --- | --- | --- | --- |
| 6.1 | Structured logging, analytics, and dashboards | Lane D | logging hooks, analytics instrumentation, ops dashboard | `Build` | launch metrics board visible from staging onward and explicitly filtered to `buy` + `cancel/recover` on `Claude MCP` and `OpenClaw`, with approval conversion, receipt coverage, out-of-scope attempts, dispute flow, and operator quarantine or recovery signals called out |
| 6.2 | Alerts, smoke tests, and incident runbooks | Lane D | Sentry, alerting hooks, smoke tests, runbook docs | `Build` | top-five failures have alert plus written response path |
| 6.3 | Security review and kill switches | Lane D | auth, approval links, host auth, replay protections, kill-switch surfaces | `Validate` | launch review complete and quarantine works in under 2 minutes |
| 6.4 | Design-partner pilot and burn-in | Founder + Lane D | launch docs, samples, support kit, metrics board | `Build` | partner pilot hits approval-to-receipt without scope breaches |

## Immediate Gaps

1. `Evidence and finalize loop`
Current state: the host-first nouns and aliases are frozen, but the evidence-to-verifier-to-receipt path still needs launch-grade completion.

2. `Operator rescue`
Current state: there is enough substrate for rescue, but the operator console still needs to become the real intervention surface.

3. `Host pack hardening`
Current state: channel scaffolding exists, but the install-to-first-approval path still needs to be proven and documented.

4. `Payments and settlement`
Current state: the architecture is clear, but one concrete provider path and settlement reconciliation still need to be nailed down.

5. `Metrics and launch ops`
Current state: the board, alerts, smoke tests, and runbooks need to move from partial to launch-operational, and operator metrics still need to foreground approval conversion, receipt coverage, out-of-scope attempts, dispute-linked recovery, and quarantine readiness while treating broader Phase 1 categories as non-gating.

## Recommended Sequence

1. Finish Sprint 0 freeze and board/doc alignment.
2. Prove host-created intent to hosted approval to grant in staging.
3. Finish evidence, receipt, dispute, and operator rescue as one loop.
4. Add one managed payment path and bind settlement into receipts.
5. Harden the host pack, launch-scoped metrics board, and burn-in runbooks.

## Bottom Line

The shortest path to launch is no longer “build a specialist network.”

It is:

- keep the host-first scope rigid
- prove approvals and grants
- prove evidence, receipts, and disputes
- make operator rescue real
- harden the two launch channels
