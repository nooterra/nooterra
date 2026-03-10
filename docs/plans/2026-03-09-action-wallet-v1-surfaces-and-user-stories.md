# Action Wallet V1 Product Surfaces and User Stories

Date: March 9, 2026  
Source PRD: [docs/PRD.md](/Users/aidenlippert/nooterra/docs/PRD.md)  
Companion freeze: [docs/spec/ACTION_WALLET_V1_FREEZE.md](/Users/aidenlippert/nooterra/docs/spec/ACTION_WALLET_V1_FREEZE.md)

## Purpose

Define the concrete product surfaces and user stories for the first release of the Nooterra Action Wallet.

## Surface Inventory

| Surface | Primary user | Launch purpose | Launch must-haves |
| --- | --- | --- | --- |
| Public API | host builders | create and progress Action Wallet runs | action intents, approval requests, grants, evidence submit, finalize, receipts, disputes |
| Hosted approval pages | end user | approve or deny a bounded action | host, action, vendor/domain, spend cap, expiry, proof required, dispute path |
| Hosted receipt pages | end user | show verified outcome and money state | receipt summary, evidence links, verification result, settlement state, dispute entry |
| Dispute flow | end user + operator | handle recourse | dispute creation, dispute status, evidence collection, operator notes and resolution |
| Dashboard | end user | persistent trust surfaces | `/wallet`, `/approvals`, `/receipts`, `/disputes`, `/integrations` |
| Operator console | support, ops, admin | rescue and support | queues, run detail, request evidence, pause, revoke, refund, resolve dispute, quarantine host |
| Host integration pack | builders | fast real-world adoption | Claude MCP, OpenClaw, SDKs, CLI, setup docs, sample integrations |

## Surface Boundaries

Launch surfaces do not include:

- a first-party assistant shell
- an open marketplace
- Nooterra-owned execution adapters
- generalized browser automation promises
- booking or rebooking flows

## Product Surfaces

### 1. Public API

Purpose:

Give hosts one canonical integration surface for Action Wallet flows.

Launch endpoints:

- `POST /v1/action-intents`
- `GET /v1/action-intents/{id}`
- `POST /v1/action-intents/{id}/approval-requests`
- `GET /v1/approval-requests/{id}`
- `POST /v1/approval-requests/{id}/decisions`
- `GET /v1/execution-grants/{id}`
- `POST /v1/execution-grants/{id}/evidence`
- `POST /v1/execution-grants/{id}/finalize`
- `GET /v1/receipts/{id}`
- `POST /v1/disputes`
- `GET /v1/disputes/{id}`

### 2. Hosted Approval Pages

Purpose:

Show one legible approval boundary before the host acts.

Must show:

- host identity
- action summary
- vendor or domain
- spend cap
- expiry
- proof required
- what happens next
- dispute path after completion

### 3. Dashboard

Purpose:

Give the end user one place to inspect trust state across hosts.

Launch sections:

- `/wallet` for payment methods, standing rules, trusted hosts, default caps
- `/approvals` for pending and recent approvals
- `/receipts` for material-action receipts
- `/disputes` for dispute creation and tracking
- `/integrations` for connected hosts and revocation

### 4. Hosted Receipt Pages

Purpose:

Make the action provable after completion.

Must show:

- original approval summary
- scoped grant summary
- evidence bundle or artifacts
- verifier result
- settlement state
- dispute entry point

### 5. Dispute Flow

Purpose:

Make a bad action disputable without leaving the product.

Must support:

- open dispute from receipt context
- collect evidence
- show lifecycle state
- reflect resolution or refund state back into the receipt

### 6. Operator Console

Purpose:

Support recovery when a host run fails, evidence is incomplete, or settlement/dispute intervention is needed.

Must support:

- run inspection from intent to receipt
- verification backlog
- payment failures
- dispute queue
- host quarantine
- audit trail on every intervention

### 7. Host Integration Pack

Purpose:

Make the first real integrations usable.

Launch package:

- Claude MCP integration
- OpenClaw integration
- TypeScript SDK
- Python SDK
- CLI for testing
- install docs and quickstarts

## User Stories

### Builder and Host Stories

1. As a host builder, I want to create an action intent through one API so my product can request approval without inventing a custom trust model.

2. As a host builder, I want to request a hosted approval URL so the user can approve in Nooterra instead of inside a brittle host-specific prompt.

3. As a host builder, I want to poll or subscribe to approval status so my host can resume only after the user has approved or denied.

4. As a host builder, I want to fetch a scoped execution grant so my host receives only the exact authority the user approved.

5. As a host builder, I want the grant to enforce host, action, vendor or domain, cap, expiry, and evidence requirements so my integration fails closed when scope is wrong.

6. As a host builder, I want to submit evidence and request finalize so the host can prove what happened instead of self-reporting success.

7. As a host builder, I want to fetch the resulting receipt so I can show the user a durable proof object and not just a transient host message.

8. As a host builder, I want to open a dispute from the same run context when something fails so support and recourse stay tied to the original action.

### End User Stories

9. As an end user, I want an approval page that shows host, action, vendor or domain, max spend, expiry, and required proof so I can understand exactly what I am authorizing.

10. As an end user, I want to approve once or deny so I can control risky actions without being forced into a host-specific UX.

11. As an end user, I want to inspect trusted hosts, standing rules, and payment methods from a wallet surface so I can manage ongoing authority safely.

12. As an end user, I want to read a receipt that binds approval, evidence, verification, and settlement state so I can trust what happened after the fact.

13. As an end user, I want to open a dispute directly from the receipt so recourse starts from the same source of truth as the completed action.

### Operator Stories

14. As an operator, I want to inspect the full run from intent to receipt so I can recover failures without reconstructing state across multiple systems.

15. As an operator, I want to request more evidence, retry finalize, pause, revoke, refund, or resolve a dispute so the launch can survive expected failure modes.

16. As an operator, I want to quarantine a host quickly so a bad integration cannot keep creating risky actions while we investigate.

## Launch Order by Surface

1. Public API contract
2. Hosted approval pages
3. Grant issuance and validation
4. Evidence submit and finalize loop
5. Hosted receipt and dispute pages
6. Dashboard trust surfaces
7. Operator rescue
8. Claude MCP and OpenClaw integration pack
