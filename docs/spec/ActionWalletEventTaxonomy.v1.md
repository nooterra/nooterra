# ActionWalletEventTaxonomy.v1

This document freezes the launch Action Wallet lifecycle event vocabulary.

It exists so:

- product analytics,
- ops dashboards,
- dispute/receipt timelines, and
- transition audit logs

all speak the same event language from Sprint 0 onward.

Undocumented Action Wallet lifecycle event names are invalid. Intent transition audit entries fail closed instead of silently emitting a new lifecycle event string.

## Scope

This taxonomy covers the nine launch events frozen in [`ACTION_WALLET_V1_FREEZE.md`](./ACTION_WALLET_V1_FREEZE.md):

- `intent created`
- `approval opened`
- `approval decided`
- `grant issued`
- `evidence submitted`
- `finalize requested`
- `receipt issued`
- `dispute opened`
- `dispute resolved`

The wire event types are the dotted lowercase forms used in logs, audits, and timelines:

- `intent.created`
- `approval.opened`
- `approval.decided`
- `grant.issued`
- `evidence.submitted`
- `finalize.requested`
- `receipt.issued`
- `dispute.opened`
- `dispute.resolved`

## Canonical event table

| Wire event type | Freeze label | Emit point | Payload keys | Launch metrics |
| --- | --- | --- | --- | --- |
| `intent.created` | `intent created` | `POST /v1/action-intents` | `actionIntentId`, `previousState`, `nextState`, `at` | `active hosts`, `action volume` |
| `approval.opened` | `approval opened` | `POST /v1/action-intents/{actionIntentId}/approval-requests` | `actionIntentId`, `approvalRequestId`, `previousState`, `nextState`, `at` | `install-to-first-approval time`, `approval completion rate` |
| `approval.decided` | `approval decided` | `POST /v1/approval-requests/{requestId}/decisions` | `actionIntentId`, `approvalRequestId`, `approvalDecisionId`, `previousState`, `nextState`, `at` | `approval completion rate`, `approval-to-completion conversion` |
| `grant.issued` | `grant issued` | `POST /work-orders` materialization after an approved continuation | `actionIntentId`, `approvalRequestId`, `approvalDecisionId`, `workOrderId`, `previousState`, `nextState`, `at` | `grant validation failures`, `out-of-scope execution attempts` |
| `evidence.submitted` | `evidence submitted` | `POST /v1/execution-grants/{executionGrantId}/evidence` | `actionIntentId`, `approvalRequestId`, `workOrderId`, `previousState`, `nextState`, `at` | `evidence insufficiency rate`, `receipt coverage` |
| `finalize.requested` | `finalize requested` | `POST /v1/execution-grants/{executionGrantId}/finalize` | `actionIntentId`, `approvalRequestId`, `workOrderId`, `receiptId`, `previousState`, `nextState`, `at` | `finalize latency`, `queue delay` |
| `receipt.issued` | `receipt issued` | `POST /v1/execution-grants/{executionGrantId}/finalize` | `actionIntentId`, `approvalRequestId`, `workOrderId`, `receiptId`, `previousState`, `nextState`, `at` | `receipt coverage`, `approval-to-completion conversion` |
| `dispute.opened` | `dispute opened` | `POST /runs/{runId}/dispute/open` | `disputeId`, `openedByAgentId`, `priority`, `channel`, `escalationLevel`, `at` | `dispute rate`, `refund exposure` |
| `dispute.resolved` | `dispute resolved` | `POST /runs/{runId}/dispute/close` | `disputeId`, `outcome`, `closedByAgentId`, `settlementStatus`, `at` | `dispute loss`, `refund exposure` |

## Runtime binding

### Intent transition audit log

Action Wallet intent lifecycle transitions are emitted via:

- ops audit action: `ACTION_WALLET_INTENT_TRANSITION`
- logger event: `action_wallet_intent_transition`

Each transition row includes:

- `previousState`
- `nextState`
- `lifecycleEvent`
- `at`

`lifecycleEvent` MUST be one of the nine wire event types above.

### Dispute projection timeline

The public dispute detail timeline can contain richer substrate events such as arbitration milestones, but Action Wallet launch semantics MUST project at least:

- `dispute.opened`
- `dispute.resolved`

`POST /v1/disputes` is a projection route in v1. It reads the dispute state and timeline from the run-settlement substrate; it does not create a new write path.

## Notes

- `grant.issued` is emitted when an approved continuation materializes into a real work order. A pure approval decision does not imply execution has started yet.
- `receipt.issued` is emitted only after finalization has completed and a receipt is available to read back from `GET /v1/receipts/{receiptId}`.
- The launch taxonomy is intentionally small. New lifecycle events require an explicit spec update, tests, and metrics mapping before they are allowed.
